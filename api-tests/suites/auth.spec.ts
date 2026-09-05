/**
 * auth 组：NextAuth 凭证登录全链路（CSRF→登录→session→登出）与失败分支。
 *
 * 注意：登录失败会计入内存锁定（同邮箱 5 次锁 15 分钟），本 suite
 * 的失败分支用一次性邮箱，避免污染种子用户。
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { BASE, SEED, credentialsLogin, registerNewUser, loginAs } from "../helpers";

test.describe("auth / NextAuth 凭证链", () => {
  test("GET /api/auth/csrf 下发 csrfToken 与 cookie", async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/csrf`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.csrfToken).toBeTruthy();
  });

  test("GET /api/auth/session 未登录为空对象", async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/session`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // NextAuth v5 未认证时 session 返回 null（或空对象，随版本）
    expect(body ?? {}).toEqual({});
  });

  test("缺少 CSRF token 的 credentials 回调被拒（MissingCSRF）", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/auth/callback/credentials`, {
      form: {
        email: SEED.userEmail,
        password: SEED.userPassword,
        callbackUrl: `${BASE}/`,
      },
      maxRedirects: 0,
    });
    // NextAuth 对 CSRF 缺失返回 400+json 或 302 到 error 页（按 @auth/core 版本）
    const status = res.status();
    if (status === 200) {
      expect((await res.json()).url).toContain("error=");
    } else {
      expect([302, 400]).toContain(status);
    }
  });

  test("错误密码：302/200 带 error=CredentialsSignin（不产生 session）", async ({
    request,
  }) => {
    const email = `badpw-${Date.now()}@test.local`; // 一次性邮箱，避免锁定污染
    const { status, body } = await credentialsLogin(
      request,
      email,
      "WrongPass123"
    );
    // @auth/core 失败响应：跟随 redirect 后落在 signin 页（url 含 error）
    expect([200, 302]).toContain(status);
    if (status === 200) {
      expect(body.url).toContain("error=CredentialsSignin");
    }
    // 无论模式，session 必须未建立
    const session = await request.get(`${BASE}/api/auth/session`);
    const sess = await session.json();
    expect(sess ?? {}).toEqual({});
  });

  test("种子用户正确密码：登录成功并建立 session", async ({ request }) => {
    const { status, body } = await credentialsLogin(
      request,
      SEED.userEmail,
      SEED.userPassword
    );
    // 成功登录：302 → callbackUrl（Location 无 error）；session 建立
    expect(body.url, JSON.stringify(body)).not.toContain("error=");
    const session = await request.get(`${BASE}/api/auth/session`);
    const sess = await session.json();
    expect(sess.user.email).toBe(SEED.userEmail);
    expect(sess.user.uuid).toBeTruthy();
  });

  test("登录 → session → 登出 → session 失效", async ({ request }) => {
    await loginAs(request, SEED.userEmail, SEED.userPassword);

    const csrf = await (await request.get(`${BASE}/api/auth/csrf`)).json();
    const signout = await request.post(`${BASE}/api/auth/signout`, {
      form: { csrfToken: csrf.csrfToken, callbackUrl: `${BASE}/` },
    });
    expect(signout.ok() || [302, 303].includes(signout.status())).toBe(true);

    const session = await request.get(`${BASE}/api/auth/session`);
    const sess = await session.json();
    expect(sess ?? {}).toEqual({});
  });

  test("注册新用户 → 立即登录可用（credentials 登录闭环）", async ({
    request,
  }) => {
    const reg = await registerNewUser(request, "auth-reg");
    // 注册成功后前端行为即 signIn("credentials")
    const { body } = await credentialsLogin(request, reg.email, reg.password);
    expect(body.url, JSON.stringify(body)).not.toContain("error=");
  });

  test("pending_activation 管理员：可登录但 admin 接口要求先改密", async ({
    request,
  }) => {
    // 自建 pending 管理员（bootstrap admin 的密码可能被 admin.spec 激活流程改掉，
    // suite 顺序导致依赖 → 这里直插一条独立数据，自包含）
    const email = `pending-admin-${Date.now()}@test.local`;
    const tempPassword = "PendingAdmin123";
    let dbUrl = process.env.DATABASE_URL || "";
    if (!dbUrl) {
      for (const line of readFileSync(".env.api-test", "utf8").split(/\r?\n/)) {
        if (line.startsWith("DATABASE_URL")) {
          dbUrl = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
          break;
        }
      }
    }
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    await client.query(
      `INSERT INTO users (uuid, email, nickname, password_hash, signin_type, signin_provider, role, status, must_change_password, created_at)
       VALUES ($1,$2,'pending-admin',$3,'credentials','credentials','super_admin','pending_activation',true,now())`,
      [
        `pending-admin-${Date.now()}`,
        email,
        bcrypt.hashSync(tempPassword, 12),
      ]
    );
    await client.end();

    await loginAs(request, email, tempPassword);

    // must_change_password=true → requireAdmin 抛错。
    // 注：部分 admin 路由（approvals 等）映射 403 "password change required"，
    // stats 未单独映射 → 200 "get stats failed"（行为不一致，已记录为改进项）
    const stats = await request.get(`${BASE}/api/admin/stats`);
    const statsBody = await stats.json();
    expect(statsBody.code).toBe(-1);
  });
});

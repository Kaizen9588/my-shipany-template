/**
 * API 测试链式助手：CSRF → 登录换 session → 后续请求自动携带（request fixture 内建 cookie 罐）。
 *
 * 事实依据（auth/config.ts + @auth/core 行为，均有源码可查）：
 * - GET /api/auth/csrf → { csrfToken } + Set-Cookie authjs.csrf-token
 * - POST /api/auth/callback/credentials（form: csrfToken/email/password/callbackUrl）
 *   成功 200 {url} + Set-Cookie authjs.session-token；失败 200 {url: ...error=CredentialsSignin}
 * - session 策略 JWT（无 adapter）；本地 http 环境 cookie 无 __Secure- 前缀
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const BASE = process.env.API_TEST_BASE_URL || "http://localhost:3100";

/** 种子用户（api-tests/db-lifecycle.ts 同源） */
export const SEED = {
  userEmail: "seed-user@test.local",
  userPassword: "SeedUser123456",
} as const;

/** NextAuth credentials 登录：返回响应（断言由调用方决定，便于测失败分支） */
export async function credentialsLogin(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<{ status: number; body: { url?: string } }> {
  const csrfRes = await request.get(`${BASE}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // @auth/core 对 credentials 回调固定走 redirect（302 + Location），成功与否
  // 看 Location 里的 error 参数；Set-Cookie 由 request fixture 的 cookie 罐保留
  const res = await request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      csrfToken,
      email,
      password,
      callbackUrl: `${BASE}/`,
    },
    maxRedirects: 0,
  });
  const location = res.headers()["location"] || "";
  return {
    status: res.status(),
    body: { url: location, ...(await res.json().catch(() => ({}))) },
  };
}

/** 登录并断言成功（多数 suite 的前置） */
export async function loginAs(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<void> {
  const res = await credentialsLogin(request, email, password);
  expect(res.body.url, `登录失败: ${JSON.stringify(res.body)}`).not.toContain(
    "error="
  );
  const session = await request.get(`${BASE}/api/auth/session`);
  const sess = await session.json();
  expect(sess?.user?.email, "session 应已建立").toBe(email.toLowerCase());
}

export const loginAsSeedUser = (request: APIRequestContext) =>
  loginAs(request, SEED.userEmail, SEED.userPassword);

/**
 * 生成管理员 session：
 * bootstrap admin（pnpm migrate 创建，pending_activation + must_change_password）
 * 先登录 → 改密激活 → 后续 admin 接口可访问（requireAdmin 放行）。
 */
export async function activatedAdmin(request: APIRequestContext): Promise<string> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || "api-admin@test.local";
  const tempPassword =
    process.env.ADMIN_BOOTSTRAP_PASSWORD || "ApiTestAdmin123";
  const newPassword = "ApiAdminNew123456";

  await loginAs(request, email, tempPassword);
  const res = await request.post(`${BASE}/api/user/change-password`, {
    data: { currentPassword: tempPassword, newPassword },
  });
  const body = await res.json().catch(() => ({}));
  expect(
    (body as { ok?: boolean }).ok,
    `改密激活失败: ${JSON.stringify(body)}`
  ).toBe(true);
  return newPassword;
}

/**
 * 走接口注册一个全新用户（send-verification 响应体降级通道拿验证码 → verify-code 注册）。
 * 每邮箱 60s 冷却 → 邮箱带时间戳。注册赠 10 积分。
 */
export async function registerNewUser(
  request: APIRequestContext,
  emailPrefix = "api-test"
): Promise<{ email: string; password: string }> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = "ApiTestPassw0rd123";

  const sendRes = await request.post(`${BASE}/api/send-verification`, {
    data: { email, purpose: "register" },
  });
  const sendBody = (await sendRes.json()) as {
    code: number;
    data?: { sent: boolean; code?: string };
    message?: string;
  };
  expect(
    sendBody.code,
    `send-verification 失败: ${JSON.stringify(sendBody)}`
  ).toBe(0);
  const verificationCode = sendBody.data?.code;
  expect(verificationCode, "dev 降级通道应返回验证码").toBeTruthy();

  const verifyRes = await request.post(`${BASE}/api/verify-code`, {
    data: { email, code: verificationCode, password, mode: "register" },
  });
  const verifyBody = (await verifyRes.json()) as {
    code: number;
    data?: { registered?: boolean };
  };
  expect(
    verifyBody.code,
    `verify-code 注册失败: ${JSON.stringify(verifyBody)}`
  ).toBe(0);
  expect(verifyBody.data?.registered).toBe(true);

  return { email, password };
}

/** 便捷断言：项目响应约定 {code, message, data} */
export async function expectJson(
  res: Awaited<ReturnType<APIRequestContext["get"]>>
): Promise<{ code: number; message: string; data: unknown; status: number }> {
  const status = res.status();
  const body = await res.json();
  return { status, ...(body as object) } as never;
}

/** 浏览器级登录（E2E 复用） */
export async function loginViaPage(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/auth/signin`);
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/console|my-credits/, { timeout: 15_000 });
}

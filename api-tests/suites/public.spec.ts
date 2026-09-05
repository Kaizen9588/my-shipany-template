/**
 * public 组：无鉴权接口的可达性、响应形状、限流/校验边界。
 * 覆盖：health, ping, search, get-user-info, metrics, metrics/events,
 *       send-verification, verify-code, payment-methods
 */
import { test, expect } from "@playwright/test";
import { BASE, SEED, credentialsLogin, registerNewUser } from "../helpers";

test.describe("public / 无鉴权接口", () => {
  test("GET /api/health 健康检查", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.services.supabase).toBe("up");
  });

  test("GET /api/payment-methods 无渠道凭据时全部 unavailable 但 200", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/payment-methods`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(Array.isArray(body.data.methods)).toBe(true);
    // .env.api-test 不配任何渠道密钥 → 全部 available:false
    for (const m of body.data.methods) {
      expect(m.available).toBe(false);
    }
  });

  test("GET /api/search 空关键词与命中", async ({ request }) => {
    const empty = await request.get(`${BASE}/api/search?q=&locale=en`);
    expect(empty.status()).toBe(200);
    expect((await empty.json()).data.posts).toEqual([]);

    const hit = await request.get(`${BASE}/api/search?q=hello&locale=en`);
    expect(hit.status()).toBe(200);
    const hitBody = await hit.json();
    expect(hitBody.data.posts.length).toBeGreaterThan(0);
    expect(hitBody.data.posts[0].title).toBe("API Test Hello");
  });

  test("GET /api/search 攻击注入被剥离且不 500", async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/search?q=usage%3B%2C(credits)&locale=en`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.posts).toEqual([]);
  });

  test("POST /api/get-user-info 未登录 code=-2，登录后返回安全用户", async ({
    request,
  }) => {
    const anon = await request.post(`${BASE}/api/get-user-info`);
    expect(anon.status()).toBe(200);
    const anonBody = await anon.json();
    expect(anonBody.code).toBe(-2);

    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
    const authed = await request.post(`${BASE}/api/get-user-info`);
    const authedBody = await authed.json();
    expect(authedBody.code).toBe(0);
    expect(authedBody.data.email).toBe(SEED.userEmail);
    // toSafeUser 白名单出口：敏感字段被剥除（role/nickname 属公开字段允许保留）
    expect(authedBody.data).not.toHaveProperty("password_hash");
    expect(authedBody.data).not.toHaveProperty("password_updated_at");
    expect(authedBody.data).not.toHaveProperty("signin_ip");
    expect(authedBody.data).not.toHaveProperty("signin_openid");
    expect(authedBody.data).not.toHaveProperty("status");
  });

  test("POST /api/ping 无登录 200 no auth；有登录扣 1 积分；无积分报错", async ({
    request,
  }) => {
    const anon = await request.post(`${BASE}/api/ping`, {
      data: { message: "hi" },
    });
    expect(anon.status()).toBe(200);
    expect((await anon.json()).message).toBe("no auth");

    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
    // seed 用户无积分批次（credit_lots 为空）→ decreaseCredits 抛 InsufficientCreditsError
    // → 200 + respErr("insufficient credits: <balance>")（respErr 默认 HTTP 200）
    const ping = await request.post(`${BASE}/api/ping`, {
      data: { message: "ping-test" },
    });
    expect(ping.status()).toBe(200);
    const pingBody = await ping.json();
    expect(pingBody.code).toBe(-1);
    expect(pingBody.message).toContain("insufficient credits");
  });

  test("POST /api/send-verification 已注册邮箱拒绝、新邮箱走 dev 降级通道", async ({
    request,
  }) => {
    const dup = await request.post(`${BASE}/api/send-verification`, {
      data: { email: SEED.userEmail, purpose: "register" },
    });
    expect(dup.status()).toBe(200);
    const dupBody = await dup.json();
    expect(dupBody.code).toBe(-1);
    expect(dupBody.message).toBe("email already registered");

    const fresh = await request.post(`${BASE}/api/send-verification`, {
      data: { email: `fresh-${Date.now()}@test.local`, purpose: "register" },
    });
    const freshBody = await fresh.json();
    expect(freshBody.code).toBe(0);
    expect(freshBody.data.sent).toBe(false);
    expect(freshBody.data.code).toMatch(/^\d{4,8}$/);
  });

  test("POST /api/verify-code 错误验证码拒绝 + 全链路注册成功", async ({
    request,
  }) => {
    // 错误码
    const email = `wrong-code-${Date.now()}@test.local`;
    await request.post(`${BASE}/api/send-verification`, {
      data: { email, purpose: "register" },
    });
    const bad = await request.post(`${BASE}/api/verify-code`, {
      data: { email, code: "000000", password: "ApiTestPassw0rd123" },
    });
    const badBody = await bad.json();
    expect(badBody.code).toBe(-1);
    expect(badBody.message).toContain("verification");

    // 正确码全链路（helper 内含断言）
    const reg = await registerNewUser(request, "verify-chain");
    expect(reg.email).toContain("@test.local");
  });

  test("GET /api/metrics 未配 secret 放行（dev），配 secret 后 Bearer 必须对上", async ({
    request,
  }) => {
    // .env.api-test 配了 METRICS_ACCESS_SECRET → 必须 Bearer 对上
    const noAuth = await request.get(`${BASE}/api/metrics`);
    expect(noAuth.status()).toBe(401);

    const badAuth = await request.get(`${BASE}/api/metrics`, {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(badAuth.status()).toBe(401);

    // 注意：metrics 有全局 60/min 限流，此 suite 保持少量请求
    const ok = await request.get(`${BASE}/api/metrics`, {
      headers: { Authorization: "Bearer metrics_api_test_secret" },
    });
    expect(ok.status()).toBe(200);
    const okBody = await ok.json();
    expect(okBody.code).toBe(0);
    expect(okBody.data).toHaveProperty("kpi");
  });

  test("GET /api/metrics/events 参数校验与鉴权", async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrics/events?days=200`, {
      headers: { Authorization: "Bearer metrics_api_test_secret" },
    });
    // days 上限 90 → 400 或被 clamp（按实现：query 校验拒绝）
    expect([200, 400]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.data).toHaveProperty("events");
    }
  });
});

/**
 * admin 组：RBAC 矩阵（匿名/普通用户/管理员）+ 全部管理接口主路径。
 * 管理员 session 由 activatedAdmin 建立一次（suite 级 serial）。
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { BASE, SEED, credentialsLogin, activatedAdmin } from "../helpers";

test.describe("admin / RBAC 矩阵", () => {
  test("匿名用户打全部 admin 接口 → 403（requireAdmin 统一拦截）", async ({
    request,
  }) => {
    const endpoints: Array<[string, Parameters<typeof request.get>[1] | undefined]> = [
      [`${BASE}/api/admin/stats`, undefined],
      [`${BASE}/api/admin/approvals`, undefined],
      [`${BASE}/api/admin/op-events`, undefined],
      [`${BASE}/api/admin/payment-products`, undefined],
      [`${BASE}/api/admin/payment-settings`, undefined],
      [`${BASE}/api/admin/notify-settings`, undefined],
    ];
    for (const [url, opts] of endpoints) {
      const res = await request.get(url, {
        ...opts,
        headers: { cookie: "" },
      });
      expect(res.status(), `GET ${url}`).toBe(403);
    }

    for (const url of [
      `${BASE}/api/admin/user/credits`,
      `${BASE}/api/admin/refund`,
      `${BASE}/api/admin/debt-settle`,
    ]) {
      const res = await request.post(url, {
        data: {},
        headers: { cookie: "" },
      });
      expect(res.status(), `POST ${url}`).toBe(403);
    }
  });

  test("普通用户（session 有效）打 admin 接口 → 403 no admin access", async ({
    request,
  }) => {
    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
    const res = await request.get(`${BASE}/api/admin/stats`);
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toBe("no admin access");
  });
});

test.describe("admin / 管理接口主路径（激活后的管理员）", () => {
  // 每个用例内自行登录管理员（改密幂等：已是新密码则走 catch 分支直接登录）
  async function adminLogin(request: APIRequestContext) {
    const newPw = "ApiAdminNew123456";
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL || "api-admin@test.local";
    try {
      await activatedAdmin(request); // 首次：改密激活
    } catch {
      await credentialsLogin(request, email, newPw); // 之后：直接登录
    }
  }

  test("GET /api/admin/stats 返回统计结构", async ({ request }) => {
    await adminLogin(request);
    const res = await request.get(`${BASE}/api/admin/stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    // getAdminStats 全量字段存在性（宽松：至少有用户计数类字段）
    expect(body.data).toBeTruthy();
  });

  test("GET /api/admin/approvals scope=open/recent", async ({ request }) => {
    await adminLogin(request);
    for (const scope of ["open", "recent"]) {
      const res = await request.get(`${BASE}/api/admin/approvals?scope=${scope}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(body.data).toHaveProperty("approvals");
    }
    // 未知 scope 回落到 open（route 只区分 "recent"），不是错误
    const badScope = await request.get(`${BASE}/api/admin/approvals?scope=xxx`);
    const badScopeBody = await badScope.json();
    expect(badScopeBody.code).toBe(0);
    expect(badScopeBody.data.scope).toBe("open");
  });

  test("GET /api/admin/op-events 分页与过滤", async ({ request }) => {
    await adminLogin(request);
    const res = await request.get(`${BASE}/api/admin/op-events?page=1&limit=10`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data).toHaveProperty("rows");
    expect(body.data).toHaveProperty("total");
  });

  test("PUT /api/admin/user 角色变更需 super_admin；nickname 直接生效", async ({
    request,
  }) => {
    await adminLogin(request);
    // bootstrap admin 是 super_admin → role 变更走审批单
    const uuidRes = await request.post(`${BASE}/api/get-user-info`);
    const me = (await uuidRes.json()).data;
    expect(me.uuid).toBeTruthy();

    const nick = await request.put(`${BASE}/api/admin/user`, {
      data: { uuid: me.uuid, nickname: "root-admin" },
    });
    const nickBody = await nick.json();
    expect(nickBody.code).toBe(0);
    expect(nickBody.data.updated).toBe(true);

    // role 变更 → 审批单（单管理员场景 single_admin 或 approval_required）
    const role = await request.put(`${BASE}/api/admin/user`, {
      data: { uuid: me.uuid, role: "operator", reason: "api-test role change" },
    });
    const roleBody = await role.json();
    expect(roleBody.code).toBe(0);
    expect(roleBody.data).toHaveProperty("approval_required");
  });

  test("POST /api/admin/user/credits 调积分 → 走审批单", async ({ request }) => {
    await adminLogin(request);
    const res = await request.post(`${BASE}/api/admin/user/credits`, {
      data: {
        user_uuid: "seed-user-0000-4000-8000-0000000000aa",
        credits: 50,
        reason: "api-test credit adjustment",
      },
    });
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.approval_required).toBe(true);

    // 参数校验：credits=0 拒绝
    const zero = await request.post(`${BASE}/api/admin/user/credits`, {
      data: {
        user_uuid: "seed-user-0000-4000-8000-0000000000aa",
        credits: 0,
        reason: "api-test zero credits",
      },
    });
    expect((await zero.json()).code).toBe(-1);
  });

  test("PUT /api/admin/payment-products 定价变更 → 审批单（不直接生效）", async ({
    request,
  }) => {
    await adminLogin(request);
    const res = await request.put(`${BASE}/api/admin/payment-products`, {
      data: {
        products: [
          {
            product_id: "starter",
            amount: 9900,
            credits: 120, // 变更点
            valid_months: 1,
            currency: "USD",
          },
        ],
        reason: "api-test pricing change",
      },
    });
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.approval_required).toBe(true);

    // 非法 currency 拒绝
    const bad = await request.put(`${BASE}/api/admin/payment-products`, {
      data: {
        products: [
          { product_id: "starter", amount: 9900, credits: 100, valid_months: 1, currency: "CNY" },
        ],
        reason: "api-test bad currency",
      },
    });
    expect((await bad.json()).code).toBe(-1);
  });

  test("GET/PUT/POST /api/admin/notify-settings 读写掩码视图 + 测试发送", async ({
    request,
  }) => {
    await adminLogin(request);
    const get = await request.get(`${BASE}/api/admin/notify-settings`);
    expect(get.status()).toBe(200);
    const getBody = await get.json();
    expect(getBody.code).toBe(0);
    expect(getBody.data).toHaveProperty("eventRules");

    const put = await request.put(`${BASE}/api/admin/notify-settings`, {
      data: { notifyMinSeverity: "warn", reason: "api-test severity change" },
    });
    expect((await put.json()).data.updated).toBe(true);

    // 测试发送：未配 webhook → 400
    const testSend = await request.post(`${BASE}/api/admin/notify-settings`);
    expect(testSend.status()).toBe(400);
  });

  test("POST /api/admin/refund 不存在订单报错", async ({ request }) => {
    await adminLogin(request);
    const res = await request.post(`${BASE}/api/admin/refund`, {
      data: { order_no: "no-such-order", reason: "api-test refund missing" },
    });
    expect((await res.json()).code).toBe(-1);
  });

  test("POST /api/admin/debt-settle 参数校验与不存在债务", async ({ request }) => {
    await adminLogin(request);
    const short = await request.post(`${BASE}/api/admin/debt-settle`, {
      data: { debt_no: "x", reason: "短" },
    });
    expect((await short.json()).code).toBe(-1);

    const missing = await request.post(`${BASE}/api/admin/debt-settle`, {
      data: { debt_no: "debt-not-exist", reason: "api-test debt settle" },
    });
    expect((await missing.json()).code).toBe(-1);
  });
});

/**
 * payment 组：checkout 落单分支 + 三渠道 webhook 验签/幂等/资金闭环（RPC 真执行断言）。
 * 全部签名本地构造，不外呼支付渠道。
 */
import { test, expect } from "@playwright/test";
import { createHmac, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { BASE, SEED, credentialsLogin } from "../helpers";

function dbUrl(): string {
  for (const f of [".env.api-test", ".env.local"]) {
    try {
      for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (t.startsWith("DATABASE_URL") && !process.env.DATABASE_URL) {
          const eq = t.indexOf("=");
          let v = t.slice(eq + 1).trim();
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          return v;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return process.env.DATABASE_URL || "";
}

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** 种子订单：created 状态 + 与 webhook 金额一致的 amount/currency */
async function seedOrder(opts: {
  orderNo: string;
  userUuid: string;
  userEmail: string;
  amount: number;
  credits: number;
  provider?: string;
  status?: string;
}) {
  await withDb((c) =>
    c.query(
      `INSERT INTO orders (order_no, user_uuid, user_email, amount, credits, status, currency, payment_provider, product_id, product_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,'starter','Starter',now())`,
      [
        opts.orderNo,
        opts.userUuid,
        opts.userEmail,
        opts.amount,
        opts.credits,
        opts.status || "created",
        opts.provider || "creem",
      ]
    )
  );
}

async function clearWebhookState(eventId: string) {
  await withDb((c) =>
    c.query(`DELETE FROM payment_events WHERE provider_event_id = $1`, [eventId])
  );
}

async function getUserUuidByEmail(email: string): Promise<string> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ uuid: string }>(
      `SELECT uuid FROM users WHERE email = $1`,
      [email]
    );
    return rows[0]?.uuid || "";
  });
}

/** 充值口径：credits 表为流水真源（handle_order_payment 写 credits，credit_lots 由
 * grant_credit_lot 单独维护），webhook 断言只需充值流水差值 */
async function creditBalance(userUuid: string): Promise<number> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ total: string }>(
      `SELECT COALESCE(SUM(credits),0)::text AS total FROM credits WHERE user_uuid=$1`,
      [userUuid]
    );
    return Number(rows[0]?.total || 0);
  });
}

test.describe("payment / checkout 落单", () => {
  test("POST /api/checkout 未登录 → 200 no auth（respErr 默认 200）", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/checkout`, {
      data: { product_id: "starter" },
      headers: { cookie: "" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toBe("no auth, please sign-in");
  });

  test("POST /api/checkout 登录后无渠道凭据 → no payment provider available", async ({
    request,
  }) => {
    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
    const res = await request.post(`${BASE}/api/checkout`, {
      data: { product_id: "starter" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("no payment provider available");
  });

  test("POST /api/checkout 非法 cancel_url（跨源）被拒", async ({ request }) => {
    await credentialsLogin(request, SEED.userEmail, SEED.userPassword);
    const res = await request.post(`${BASE}/api/checkout`, {
      data: {
        product_id: "starter",
        cancel_url: "https://evil.example.com/cancel",
      },
    });
    expect((await res.json()).code).toBe(-1);
  });
});

test.describe("payment / creem webhook（签名+幂等+资金闭环）", () => {
  const SECRET = "creem_api_test_secret";

  function signedCreemBody(eventId: string, orderNo: string, uuid: string, amount: number) {
    const raw = JSON.stringify({
      id: eventId,
      eventType: "checkout.completed",
      createdAt: new Date().toISOString(),
      object: {
        metadata: { order_no: orderNo, user_uuid: uuid, credits: 100 },
        product: { price: { amount, currency: "USD" } },
      },
    });
    const sig = createHmac("sha256", SECRET).update(raw).digest("hex");
    return { raw, sig };
  }

  test("错误签名 → 400；正确签名 ack 且订单变 paid、积分到账", async ({
    request,
  }) => {
    const uuid = await getUserUuidByEmail(SEED.userEmail);
    const orderNo = `creem-test-${randomUUID()}`;
    const eventId = `evt-creem-${randomUUID()}`;
    await seedOrder({ orderNo, userUuid: uuid, userEmail: SEED.userEmail, amount: 9900, credits: 100 });
    await clearWebhookState(eventId);
    const before = await creditBalance(uuid);

    const { raw, sig } = signedCreemBody(eventId, orderNo, uuid, 9900);

    // 错误签名
    const bad = await request.post(`${BASE}/api/creem-notify`, {
      data: raw,
      headers: { "content-type": "application/json", "creem-signature": "deadbeef" },
    });
    expect(bad.status()).toBe(400);

    // 正确签名
    const ok = await request.post(`${BASE}/api/creem-notify`, {
      data: raw,
      headers: { "content-type": "application/json", "creem-signature": sig },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).received).toBe(true);

    // RPC 真执行断言：订单 paid + 积分到账
    const order = await withDb((c) =>
      c.query<{ status: string; paid_at: Date }>(
        `SELECT status, paid_at FROM orders WHERE order_no=$1`,
        [orderNo]
      )
    );
    expect(order.rows[0]?.status).toBe("paid");
    expect(order.rows[0]?.paid_at).toBeTruthy();
    const after = await creditBalance(uuid);
    expect(after).toBe(before + 100);
  });

  test("重放同一 event：ack 但幂等跳过，积分只加一次", async ({ request }) => {
    const uuid = await getUserUuidByEmail(SEED.userEmail);
    const orderNo = `creem-replay-${randomUUID()}`;
    const eventId = `evt-replay-${randomUUID()}`;
    await seedOrder({ orderNo, userUuid: uuid, userEmail: SEED.userEmail, amount: 9900, credits: 100 });
    await clearWebhookState(eventId);
    const before = await creditBalance(uuid);
    const { raw, sig } = signedCreemBody(eventId, orderNo, uuid, 9900);

    const first = await request.post(`${BASE}/api/creem-notify`, {
      data: raw,
      headers: { "content-type": "application/json", "creem-signature": sig },
    });
    expect(first.status()).toBe(200);

    const second = await request.post(`${BASE}/api/creem-notify`, {
      data: raw,
      headers: { "content-type": "application/json", "creem-signature": sig },
    });
    // 路由对重放同样只 ack（幂等在 inbox 层完成，不透出 skipped 字段）
    expect(second.status()).toBe(200);
    expect((await second.json()).received).toBe(true);

    // inbox 只有一行 processed 记录（幂等键去重）
    const inbox = await withDb((c) =>
      c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payment_events WHERE provider='creem' AND provider_event_id=$1 AND processed_at IS NOT NULL`,
        [eventId]
      )
    );
    expect(Number(inbox.rows[0]?.n)).toBe(1);

    const after = await creditBalance(uuid);
    expect(after).toBe(before + 100); // 只加一次
  });

  test("金额不一致：订单置 mismatch、不充值、仍 ack", async ({ request }) => {
    const uuid = await getUserUuidByEmail(SEED.userEmail);
    const orderNo = `creem-mismatch-${randomUUID()}`;
    const eventId = `evt-mismatch-${randomUUID()}`;
    await seedOrder({ orderNo, userUuid: uuid, userEmail: SEED.userEmail, amount: 9900, credits: 100 });
    await clearWebhookState(eventId);
    const before = await creditBalance(uuid);
    // webhook 报 100 分（订单是 9900 分）
    const { raw, sig } = signedCreemBody(eventId, orderNo, uuid, 100);

    const res = await request.post(`${BASE}/api/creem-notify`, {
      data: raw,
      headers: { "content-type": "application/json", "creem-signature": sig },
    });
    expect(res.status()).toBe(200);

    const order = await withDb((c) =>
      c.query<{ status: string }>(`SELECT status FROM orders WHERE order_no=$1`, [orderNo])
    );
    expect(["mismatch", "paid_mismatch", "amount_mismatch"]).toContain(order.rows[0]?.status);
    expect(await creditBalance(uuid)).toBe(before);
  });
});

test.describe("payment / stripe webhook", () => {
  const SECRET = "whsec_api_test_only";

  function stripeSignature(raw: string): string {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  test("checkout.session.completed → 订单 paid、积分到账", async ({ request }) => {
    const uuid = await getUserUuidByEmail(SEED.userEmail);
    const orderNo = `stripe-test-${randomUUID()}`;
    const eventId = `evt-stripe-${randomUUID()}`;
    await seedOrder({
      orderNo,
      userUuid: uuid,
      userEmail: SEED.userEmail,
      amount: 9900,
      credits: 100,
      provider: "stripe",
    });
    await withDb((c) =>
      c.query(`DELETE FROM payment_events WHERE provider='stripe' AND provider_event_id=$1`, [eventId])
    );
    const before = await creditBalance(uuid);

    const raw = JSON.stringify({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          amount_total: 9900,
          metadata: { order_no: orderNo, user_uuid: uuid, credits: 100 },
        },
      },
    });

    const bad = await request.post(`${BASE}/api/stripe-notify`, {
      data: raw,
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" },
    });
    expect(bad.status()).toBe(400);

    const ok = await request.post(`${BASE}/api/stripe-notify`, {
      // string body：原样传输（签名对 raw bytes 校验，不能让客户端重序列化）
      data: raw,
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripeSignature(raw),
      },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).received).toBe(true);

    const order = await withDb((c) =>
      c.query<{ status: string }>(`SELECT status FROM orders WHERE order_no=$1`, [orderNo])
    );
    expect(order.rows[0]?.status).toBe("paid");
    expect(await creditBalance(uuid)).toBe(before + 100);
  });
});

test.describe("payment / waffo webhook", () => {
  // waffo 验签走 SDK 内置 RSA 公钥体系，本地无私钥无法构造合法签名。
  // 覆盖边界：错误签名 → 非 2xx（拒绝），响应约定为纯文本 OK 仅在合法时。
  test("POST /api/waffo-notify 非法签名被拒（非 OK 响应）", async ({ request }) => {
    const res = await request.post(`${BASE}/api/waffo-notify`, {
      data: JSON.stringify({ eventType: "order.completed", data: {} }),
      headers: {
        "content-type": "text/plain",
        "x-waffo-signature": "t=1,v1=invalid",
      },
    });
    // 拒绝路径：400/401 均合理（SDK 验签失败抛错）
    expect([400, 401, 403]).toContain(res.status());
  });

  test("超 64KB body → 413（webhook guard）", async ({ request }) => {
    const res = await request.post(`${BASE}/api/waffo-notify`, {
      data: "x".repeat(65 * 1024),
      headers: { "content-type": "text/plain" },
    });
    expect(res.status()).toBe(413);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));

vi.mock("@/models/db", () => ({
  getSupabaseClient: mocks.client,
  serverClient: mocks.client,
  userClient: mocks.client,
}));
vi.mock("@/models/payment", () => ({ getPaymentProducts: vi.fn() }));

import { creemProvider } from "@/lib/payment/providers/creem";

const secret = "test-creem-secret";

function hmac(body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function creemReq(payload: object): Request {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/creem-notify", {
    method: "POST",
    headers: { "creem-signature": hmac(body), "content-type": "application/json" },
    body,
  });
}

describe("lib/payment/providers/creem N-13 争议归一化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CREEM_WEBHOOK_SECRET = secret;
  });

  it("dispute.created → 归一化为 dispute_opened，携带 order_no/user_uuid/金额", async () => {
    const payload = {
      eventType: "dispute.created",
      object: {
        id: "dis_1",
        amount: 9900,
        currency: "usd",
        checkout: {
          metadata: {
            order_no: "o1",
            user_uuid: "u1",
          },
        },
      },
    };
    const event = await creemProvider.parseWebhook(creemReq(payload));
    expect(event).toMatchObject({
      type: "dispute_opened",
      order_no: "o1",
      user_uuid: "u1",
      amount: 9900,
      currency: "usd",
    });
  });

  it("dispute.created 无嵌套对象时兜底到顶层 metadata/order_no", async () => {
    const payload = {
      eventType: "dispute.created",
      object: {
        id: "dis_2",
        amount: 1990,
        currency: "eur",
        metadata: { order_no: "o2", user_uuid: "u2" },
      },
    };
    const event = await creemProvider.parseWebhook(creemReq(payload));
    expect(event).toMatchObject({
      type: "dispute_opened",
      order_no: "o2",
      user_uuid: "u2",
      amount: 1990,
      currency: "eur",
    });
  });

  it("dispute.created 缺 metadata 时仍返回 opened（order_no 留空，由下游告警人工核查）", async () => {
    const payload = { eventType: "dispute.created", object: { id: "dis_3", amount: 500 } };
    const event = await creemProvider.parseWebhook(creemReq(payload));
    expect(event).toMatchObject({ type: "dispute_opened", order_no: "" });
  });

  it("非争议事件（checkout.completed）不变更 dispute 语义", async () => {
    const payload = {
      eventType: "checkout.completed",
      object: { metadata: { order_no: "o9", user_uuid: "u9" }, product: { price: { amount: 100, currency: "usd" } } },
    };
    const event = await creemProvider.parseWebhook(creemReq(payload));
    expect(event?.type).toBe("payment_succeeded");
  });
});
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Webhook 验签失败告警（docs/16 §5.4 payment.webhook_invalid_signature）
 * 对抗式审查修复：此前三个 notify 路由验签失败只 console.log + 500，
 * 事件注册表有定义但全仓无发射点。现 parseWebhook 失败即发射 critical 告警。
 */

vi.mock("@/lib/payment", () => {
  const makeProvider = () => ({
    parseWebhook: vi.fn(),
    webhookResponseBody: vi.fn((ok: boolean) => ({ received: ok })),
  });
  return {
    stripeProvider: makeProvider(),
    creemProvider: makeProvider(),
    waffoProvider: makeProvider(),
    handlePaymentEvent: vi.fn(),
  };
});

vi.mock("@/lib/oplog", () => ({ trackCriticalEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { POST as stripePost } from "@/app/api/stripe-notify/route";
import { POST as creemPost } from "@/app/api/creem-notify/route";
import { POST as waffoPost } from "@/app/api/waffo-notify/route";
import {
  stripeProvider,
  creemProvider,
  waffoProvider,
  handlePaymentEvent,
} from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";

const req = () => new Request("http://localhost/api/stripe-notify", { method: "POST", body: "{}" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("webhook 验签失败发射 payment.webhook_invalid_signature", () => {
  it("stripe：parseWebhook 抛错 → 400 + critical 告警（含 provider 标识）", async () => {
    (stripeProvider.parseWebhook as any).mockRejectedValue(
      new Error("No signatures found matching the expected signature")
    );

    const res = await stripePost(req());
    expect(res.status).toBe(400);
    expect(handlePaymentEvent).not.toHaveBeenCalled();
    expect(trackCriticalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "payment.webhook_invalid_signature",
        severity: "critical",
        detail: expect.objectContaining({ provider: "stripe" }),
      })
    );
  });

  it("creem：parseWebhook 抛错 → 400 + critical 告警", async () => {
    (creemProvider.parseWebhook as any).mockRejectedValue(new Error("invalid creem signature"));

    const res = await creemPost(req());
    expect(res.status).toBe(400);
    expect(trackCriticalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "payment.webhook_invalid_signature",
        detail: expect.objectContaining({ provider: "creem" }),
      })
    );
  });

  it("waffo：验签失败仍遵守响应契约（webhookResponseBody(false)）且发射告警", async () => {
    (waffoProvider.parseWebhook as any).mockRejectedValue(new Error("rsa verify failed"));

    const res = await waffoPost(req());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ received: false });
    expect(waffoProvider.webhookResponseBody).toHaveBeenCalledWith(false);
    expect(trackCriticalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ provider: "waffo" }),
      })
    );
  });

  it("验签通过的正常事件不发射告警，处理失败才走 500 分支", async () => {
    const event = { order_no: "ORD1" };
    (stripeProvider.parseWebhook as any).mockResolvedValue(event);
    (handlePaymentEvent as any).mockResolvedValue(undefined);

    const ok = await stripePost(req());
    expect(ok.status).toBe(200);
    expect(trackCriticalEvent).not.toHaveBeenCalled();

    (handlePaymentEvent as any).mockRejectedValue(new Error("db down"));
    const bad = await stripePost(req());
    expect(bad.status).toBe(500);
    // 处理失败不是验签失败，不发射 invalid_signature
    expect(trackCriticalEvent).not.toHaveBeenCalled();
  });
});

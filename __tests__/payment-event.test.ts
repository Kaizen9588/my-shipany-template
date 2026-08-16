import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models/db", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/models/notification", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/email", () => ({ fireAndForgetEmail: vi.fn() }));
vi.mock("@/lib/telemetry/server", () => ({
  TelemetryEvents: {
    PaymentSucceeded: "payment.succeeded",
    PaymentAmountMismatch: "payment.amount_mismatch",
  },
  trackServer: vi.fn(),
}));
vi.mock("@/services/refund", () => ({ processRefund: vi.fn() }));
vi.mock("@/lib/payment/providers/stripe", () => ({
  stripeProvider: {},
}));
vi.mock("@/lib/payment/providers/creem", () => ({
  creemProvider: {},
}));
vi.mock("@/lib/payment/providers/waffo", () => ({
  waffoProvider: {},
}));
vi.mock("@/lib/payment/registry", () => ({
  registerPaymentProvider: vi.fn(),
}));

import { handlePaymentEvent } from "@/lib/payment";
import { getSupabaseClient } from "@/models/db";
import { createNotification } from "@/models/notification";
import { trackServer } from "@/lib/telemetry/server";
import { processRefund } from "@/services/refund";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockNotify = createNotification as unknown as ReturnType<typeof vi.fn>;
const mockTrack = trackServer as unknown as ReturnType<typeof vi.fn>;
const mockRefund = processRefund as unknown as ReturnType<typeof vi.fn>;

describe("lib/payment handlePaymentEvent（R1 金额比对契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("payment_succeeded 把渠道实付金额/币种传给存储过程", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "created", error: null });
    mockGetClient.mockReturnValue({ rpc });

    await handlePaymentEvent({
      type: "payment_succeeded",
      order_no: "o1",
      user_uuid: "u1",
      credits: 100,
      amount: 9900,
      currency: "usd",
      raw: { id: "evt_1" },
    });

    const [fnName, params] = rpc.mock.calls[0];
    expect(fnName).toBe("handle_order_payment");
    expect(params.p_order_no).toBe("o1");
    expect(params.p_amount_cents).toBe(9900);
    expect(params.p_currency).toBe("usd");
  });

  it("存储过程返回 mismatch：不发通知不发邮件，埋点告警", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "mismatch", error: null });
    mockGetClient.mockReturnValue({ rpc });

    await handlePaymentEvent({
      type: "payment_succeeded",
      order_no: "o1",
      user_uuid: "u1",
      credits: 100,
      amount: 100, // 渠道侧只付了 $1
      currency: "usd",
      raw: { id: "evt_2" },
    });

    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "payment.amount_mismatch",
        properties: expect.objectContaining({
          order_no: "o1",
          channel_amount_cents: 100,
        }),
      })
    );
  });

  it("payment_failed 不调用存储过程", async () => {
    const rpc = vi.fn();
    mockGetClient.mockReturnValue({ rpc });

    await handlePaymentEvent({
      type: "payment_failed",
      order_no: "o1",
      user_uuid: "u1",
      credits: 0,
      amount: 0,
      raw: {},
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("refund_succeeded 分发到 processRefund", async () => {
    mockGetClient.mockReturnValue({ rpc: vi.fn() });
    mockRefund.mockResolvedValueOnce({ deducted_credits: 100 });

    await handlePaymentEvent({
      type: "refund_succeeded",
      order_no: "o1",
      user_uuid: "u1",
      credits: 0,
      amount: 9900,
      raw: {},
    });

    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({ order_no: "o1", amount: 9900 })
    );
  });

  it("缺 order_no 的支付事件抛错", async () => {
    mockGetClient.mockReturnValue({ rpc: vi.fn() });

    await expect(
      handlePaymentEvent({
        type: "payment_succeeded",
        order_no: "",
        user_uuid: "",
        credits: 0,
        amount: 0,
        raw: {},
      })
    ).rejects.toThrow("missing order_no");
  });
});

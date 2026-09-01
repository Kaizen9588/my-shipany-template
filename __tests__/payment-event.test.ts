import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));

vi.mock("@/models/db", () => ({
  getSupabaseClient: mocks.client,
  serverClient: mocks.client,
  userClient: mocks.client,
}));
vi.mock("@/models/notification", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/email", () => ({ fireAndForgetEmail: vi.fn() }));
vi.mock("@/lib/telemetry/server", () => ({
  TelemetryEvents: {
    PaymentSucceeded: "payment.succeeded",
    PaymentAmountMismatch: "payment.amount_mismatch",
  },
  trackServer: vi.fn(),
}));
vi.mock("@/services/refund", () => ({
  processRefund: vi.fn(),
  registerRefundRequest: vi.fn(),
}));
vi.mock("@/services/dispute", () => ({ handleDisputeEvent: vi.fn() }));
vi.mock("@/lib/oplog", () => ({ trackCriticalEvent: vi.fn() }));
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
import { registerRefundRequest } from "@/services/refund";
import { handleDisputeEvent } from "@/services/dispute";

const mockGetClient = getSupabaseClient as unknown as ReturnType<typeof vi.fn>;
const mockNotify = createNotification as unknown as ReturnType<typeof vi.fn>;
const mockTrack = trackServer as unknown as ReturnType<typeof vi.fn>;
const mockRegisterRefund = registerRefundRequest as unknown as ReturnType<
  typeof vi.fn
>;
const mockDispute = handleDisputeEvent as unknown as ReturnType<typeof vi.fn>;

describe("lib/payment handlePaymentEvent（R1 金额比对契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("payment_succeeded 把渠道实付金额/币种传给存储过程", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "created", error: null });
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

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
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

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
    // N-2：资金 RPC 调用链为 serverClient().schema("private").rpc(...)，
    // mock 需支持 .schema() 链式调用（返回自身，共享同一 rpc mock）
    mockGetClient.mockReturnValue({ rpc, schema: () => ({ rpc }) });

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

  it("refund_succeeded 只登记 refund_requested 中间态（P0-1：不直接回收/终态化）", async () => {
    mockGetClient.mockReturnValue({ rpc: vi.fn() });
    mockRegisterRefund.mockResolvedValueOnce({ refund_no: "ref-1" });

    await handlePaymentEvent({
      type: "refund_succeeded",
      order_no: "o1",
      user_uuid: "u1",
      credits: 0,
      amount: 9900,
      currency: "USD",
      provider: "stripe",
      provider_ref_id: "re_123",
      raw: {},
    });

    expect(mockRegisterRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        order_no: "o1",
        user_uuid: "u1",
        provider: "stripe",
        provider_refund_id: "re_123",
        amount: 9900,
        initiated_by: "customer",
      })
    );
  });

  it("refund_succeeded 缺 user_uuid：不登记不回收，告警人工核查", async () => {
    mockGetClient.mockReturnValue({ rpc: vi.fn() });

    await handlePaymentEvent({
      type: "refund_succeeded",
      order_no: "o1",
      user_uuid: "",
      credits: 0,
      amount: 9900,
      raw: {},
    });

    expect(mockRegisterRefund).not.toHaveBeenCalled();
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

  it("dispute_lost 分发到 handleDisputeEvent（N-13 争议拒付）", async () => {
    mockGetClient.mockReturnValue({ rpc: vi.fn() });

    await handlePaymentEvent({
      type: "dispute_lost",
      order_no: "o1",
      user_uuid: "u1",
      credits: 0,
      amount: 9900,
      raw: { id: "dis_1" },
    });

    expect(mockDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        order_no: "o1",
        user_uuid: "u1",
        type: "dispute_lost",
        amount: 9900,
      })
    );
  });

  it("dispute_opened 缺 order_no 时告警并跳过（不崩）", async () => {
    mockGetClient.mockReturnValue({ rpc: vi.fn() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handlePaymentEvent({
      type: "dispute_opened",
      order_no: "",
      user_uuid: "",
      credits: 0,
      amount: 100,
      raw: {},
    });

    expect(mockDispute).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/user", () => ({
  getUserUuid: vi.fn(),
  getUserEmail: vi.fn(),
}));
vi.mock("@/models/order", () => ({ insertOrder: vi.fn() }));
vi.mock("@/models/payment", () => ({ getCheckoutProduct: vi.fn() }));
vi.mock("@/models/user", () => ({ findUserByUuid: vi.fn() }));
vi.mock("@/lib/hash", () => ({ getSnowId: vi.fn() }));
vi.mock("@/lib/payment", () => ({ routePaymentProvider: vi.fn() }));
vi.mock("@/lib/payment/health", () => ({
  recordProviderFailure: vi.fn(),
  recordProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/oplog", () => ({ fireAndForgetOpEvent: vi.fn() }));

import { getUserEmail, getUserUuid } from "@/services/user";
import { insertOrder } from "@/models/order";
import { getCheckoutProduct } from "@/models/payment";
import { getSnowId } from "@/lib/hash";
import { routePaymentProvider } from "@/lib/payment";
import { recordProviderFailure } from "@/lib/payment/health";
import { fireAndForgetOpEvent } from "@/lib/oplog";
import { POST } from "@/app/api/checkout/route";

const ORDER_NO = "ORDER_FAIL_123";

function checkoutRequest() {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product_id: "starter" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getUserUuid as any).mockResolvedValue("user-uuid-1");
  (getUserEmail as any).mockResolvedValue("buyer@example.com");
  (getCheckoutProduct as any).mockResolvedValue({
    product_id: "starter",
    product_name: "Starter",
    amount: 9900,
    currency: "USD",
    credits: 100,
    valid_months: 1,
    interval: "one-time",
  });
  (getSnowId as any).mockReturnValue(ORDER_NO);
  (insertOrder as any).mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_WEB_URL = "http://localhost:3000";
});

describe("checkout 失败分支的 op 事件关联（docs/16 事故诊断链）", () => {
  it("订单创建后渠道失败：checkout_failed 事件 subject_uuid 绑定 order_no", async () => {
    (routePaymentProvider as any).mockResolvedValue({
      id: "stripe",
      createCheckout: vi.fn().mockRejectedValue(new Error("provider boom")),
    });

    const res = await POST(checkoutRequest());
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toContain("provider boom");

    expect(recordProviderFailure).toHaveBeenCalledWith("stripe");
    expect(fireAndForgetOpEvent).toHaveBeenCalledTimes(1);
    const [event] = (fireAndForgetOpEvent as any).mock.calls[0];
    expect(event).toMatchObject({
      event_type: "payment.checkout_failed",
      severity: "error",
      subject_uuid: ORDER_NO,
    });
    // subject 非空且能关联到订单；detail 同时携带订单与错误信息
    expect(event.subject_uuid).not.toBe("");
    expect(event.detail.order_no).toBe(ORDER_NO);
    expect(event.detail.message).toBe("provider boom");
  });

  it("订单创建前失败（无订单可关联）：事件仍落库，subject 为空但不报错", async () => {
    (routePaymentProvider as any).mockRejectedValue(new Error("routing down"));

    const res = await POST(checkoutRequest());
    const body = await res.json();
    expect(body.code).toBe(-1);

    expect(fireAndForgetOpEvent).toHaveBeenCalledTimes(1);
    const [event] = (fireAndForgetOpEvent as any).mock.calls[0];
    expect(event.event_type).toBe("payment.checkout_failed");
    expect(event.subject_uuid).toBe("");
    expect(event.detail.message).toBe("routing down");
  });

  it("成功路径不变：checkout_succeeded 仍以 order_no 为 subject", async () => {
    (routePaymentProvider as any).mockResolvedValue({
      id: "stripe",
      createCheckout: vi
        .fn()
        .mockResolvedValue({ checkout_url: "https://pay.example/co_1" }),
    });

    const res = await POST(checkoutRequest());
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.order_no).toBe(ORDER_NO);

    const [event] = (fireAndForgetOpEvent as any).mock.calls[0];
    expect(event.event_type).toBe("payment.checkout_succeeded");
    expect(event.subject_uuid).toBe(ORDER_NO);
  });
});

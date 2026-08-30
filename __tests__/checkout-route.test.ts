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
vi.mock("@/lib/ip", () => ({ getClientIp: vi.fn(async () => "1.2.3.4") }));
vi.mock("@/lib/oplog", () => ({ fireAndForgetOpEvent: vi.fn() }));

import { getUserEmail, getUserUuid } from "@/services/user";
import { insertOrder } from "@/models/order";
import { getCheckoutProduct } from "@/models/payment";
import { getSnowId } from "@/lib/hash";
import { routePaymentProvider } from "@/lib/payment";
import { fireAndForgetOpEvent } from "@/lib/oplog";
import { POST } from "@/app/api/checkout/route";

const WEB_URL = "http://localhost:3000";

function checkoutRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockHappyPath() {
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
  (getSnowId as any).mockReturnValue("ORDER_ROUTE_1");
  (insertOrder as any).mockResolvedValue(undefined);
  const createCheckout = vi
    .fn()
    .mockResolvedValue({ checkout_url: "https://pay.example/co_1" });
  (routePaymentProvider as any).mockResolvedValue({
    id: "stripe",
    createCheckout,
  });
  return createCheckout;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_WEB_URL = WEB_URL;
  delete process.env.NEXT_PUBLIC_PAY_CANCEL_URL;
});

describe("checkout 入口编排：cancel_url 同源校验（6.1 安全要点）", () => {
  it("异地 cancel_url 被重置为本站地址，不作开放跳转", async () => {
    const createCheckout = mockHappyPath();

    const res = await POST(
      checkoutRequest({ product_id: "starter", cancel_url: "https://evil.example/phish" })
    );
    expect((await res.json()).code).toBe(0);
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(createCheckout.mock.calls[0][0].cancel_url).toBe(WEB_URL);
  });

  it("同源 cancel_url 原样透传", async () => {
    const createCheckout = mockHappyPath();

    const res = await POST(
      checkoutRequest({ product_id: "starter", cancel_url: `${WEB_URL}/pricing` })
    );
    expect((await res.json()).code).toBe(0);
    expect(createCheckout.mock.calls[0][0].cancel_url).toBe(`${WEB_URL}/pricing`);
  });

  it("相对路径 cancel_url 按本站基址校验通过后原样透传（绝对化由渠道侧处理）", async () => {
    const createCheckout = mockHappyPath();

    const res = await POST(
      checkoutRequest({ product_id: "starter", cancel_url: "/pricing" })
    );
    expect((await res.json()).code).toBe(0);
    // 编排层只负责同源/协议校验，不改写合法值；透传相对路径是当前实现行为，
    // 若后续要求绝对 URL，应改 handler 并同步更新本断言
    expect(createCheckout.mock.calls[0][0].cancel_url).toBe("/pricing");
  });

  it("非 http(s) 协议与无法解析的 cancel_url 一律回退本站", async () => {
    const createCheckout = mockHappyPath();

    await POST(
      checkoutRequest({ product_id: "starter", cancel_url: "javascript:alert(1)" })
    );
    expect(createCheckout.mock.calls[0][0].cancel_url).toBe(WEB_URL);

    await POST(
      checkoutRequest({ product_id: "starter", cancel_url: "http://[::1" })
    );
    expect(createCheckout.mock.calls[1][0].cancel_url).toBe(WEB_URL);
  });

  it("未传 cancel_url 时回退环境变量缺省值", async () => {
    process.env.NEXT_PUBLIC_PAY_CANCEL_URL = `${WEB_URL}/pay-cancel`;
    const createCheckout = mockHappyPath();

    await POST(checkoutRequest({ product_id: "starter" }));
    expect(createCheckout.mock.calls[0][0].cancel_url).toBe(`${WEB_URL}/pay-cancel`);
  });
});

describe("checkout 入口编排：早期失败分支（编排层直接拒绝）", () => {
  it("缺 product_id：拒绝且不触达定价/渠道/订单", async () => {
    mockHappyPath();

    const res = await POST(checkoutRequest({}));
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toBe("invalid params");
    expect(getCheckoutProduct).not.toHaveBeenCalled();
    expect(insertOrder).not.toHaveBeenCalled();
    expect(fireAndForgetOpEvent).not.toHaveBeenCalled();
  });

  it("未知产品：服务端定价拒绝（P-1.1 客户端不可注入）", async () => {
    mockHappyPath();
    (getCheckoutProduct as any).mockResolvedValue(undefined);

    const res = await POST(checkoutRequest({ product_id: "hacker-0-cost" }));
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toBe("invalid product");
    expect(insertOrder).not.toHaveBeenCalled();
  });

  it("未登录：拒绝并提示登录", async () => {
    mockHappyPath();
    (getUserUuid as any).mockResolvedValue("");

    const res = await POST(checkoutRequest({ product_id: "starter" }));
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toContain("sign-in");
    expect(insertOrder).not.toHaveBeenCalled();
  });

  it("无可用渠道：拒绝且不创建订单", async () => {
    mockHappyPath();
    (routePaymentProvider as any).mockResolvedValue(null);

    const res = await POST(checkoutRequest({ product_id: "starter" }));
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toBe("no payment provider available");
    expect(insertOrder).not.toHaveBeenCalled();
    expect(fireAndForgetOpEvent).not.toHaveBeenCalled();
  });

  it("邮箱缺失时回退用户表查询，仍查不到则拒绝", async () => {
    mockHappyPath();
    (getUserEmail as any).mockResolvedValue("");
    const { findUserByUuid } = await import("@/models/user");
    (findUserByUuid as any).mockResolvedValue(null);

    const res = await POST(checkoutRequest({ product_id: "starter" }));
    const body = await res.json();
    expect(body.code).toBe(-1);
    expect(body.message).toBe("invalid user");
    expect(findUserByUuid).toHaveBeenCalledWith("user-uuid-1");
  });
});

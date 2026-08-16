import { describe, expect, it } from "vitest";
import {
  getAllPaymentProviders,
  getPaymentProvider,
} from "@/lib/payment";

describe("lib/payment 渠道注册表（6.1）", () => {
  it("注册 3 个渠道：stripe / creem / waffo", () => {
    const ids = getAllPaymentProviders()
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["creem", "stripe", "waffo"]);
  });

  it("capabilities 符合设计（Creem 无退款 API，Stripe/Waffo 有）", () => {
    expect(getPaymentProvider("creem")!.capabilities.refund_api).toBe(false);
    expect(getPaymentProvider("waffo")!.capabilities.refund_api).toBe(true);
    expect(getPaymentProvider("stripe")!.capabilities.refund_api).toBe(true);
  });

  it("Stripe 默认支持 card；Waffo/Creem 支持 alipay", () => {
    expect(
      getPaymentProvider("stripe")!.supported_methods
    ).toContain("card");
    expect(getPaymentProvider("creem")!.supported_methods).toContain("alipay");
    expect(getPaymentProvider("waffo")!.supported_methods).toContain("alipay");
  });

  it("Waffo webhook 响应体必须为 {message: success|failed}", () => {
    expect(getPaymentProvider("waffo")!.webhookResponseBody(true)).toEqual({
      message: "success",
    });
    expect(getPaymentProvider("waffo")!.webhookResponseBody(false)).toEqual({
      message: "failed",
    });
  });
});

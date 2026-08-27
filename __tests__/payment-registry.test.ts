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

  it(
    "capabilities 符合设计（Stripe 有退款 API；" +
      "Creem 无；Waffo Pancake 无商户退款 API，退款走 Dashboard + webhook 扣分）",
    () => {
      expect(getPaymentProvider("creem")!.capabilities.refund_api).toBe(false);
      expect(getPaymentProvider("waffo")!.capabilities.refund_api).toBe(false);
      expect(getPaymentProvider("stripe")!.capabilities.refund_api).toBe(true);
    }
  );

  it("Stripe/Creem 支持 alipay；Waffo(Pancake) 收银台无 alipay，支持 card/wechat_pay", () => {
    expect(
      getPaymentProvider("stripe")!.supported_methods
    ).toContain("card");
    expect(getPaymentProvider("creem")!.supported_methods).toContain("alipay");
    const waffoMethods = getPaymentProvider("waffo")!.supported_methods;
    expect(waffoMethods).not.toContain("alipay");
    expect(waffoMethods).toContain("card");
    expect(waffoMethods).toContain("wechat_pay");
  });

  it("Waffo(Pancake) webhook 响应体：成功为纯文本 OK，失败为 JSON（非 2xx 触发重试）", () => {
    expect(getPaymentProvider("waffo")!.webhookResponseBody(true)).toBe("OK");
    expect(getPaymentProvider("waffo")!.webhookResponseBody(false)).toEqual({
      message: "failed",
    });
  });
});

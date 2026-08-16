import { respData, respErr } from "@/lib/resp";
import { getAllPaymentProviders, getEnabledProviders } from "@/lib/payment";

/**
 * GET /api/payment-methods —— 支付方式聚合（6.1，docs/payment/provider-abstraction.md §4.1）
 *
 * 聚合「启用渠道 × 渠道支持方式」，前端只渲染 method（Card/Alipay），完全不出现 provider。
 * available=false → 前端隐藏按钮，而非报错。
 */
export async function GET() {
  try {
    const enabled = await getEnabledProviders();
    const enabledIds = new Set(enabled.map((p) => p.id));

    // 聚合所有渠道的方法并集
    const methodSet = new Set<string>();
    getAllPaymentProviders().forEach((p) => {
      p.supported_methods.forEach((m) => methodSet.add(m));
    });

    const methods = Array.from(methodSet).map((method) => ({
      method,
      available: enabled.some((p) => p.supported_methods.includes(method as any)),
      providers: getAllPaymentProviders()
        .filter((p) => p.supported_methods.includes(method as any))
        .map((p) => p.id)
        .filter((id) => enabledIds.has(id)),
    }));

    return respData({ methods });
  } catch (e) {
    console.error("[payment-methods] failed:", e);
    return respErr("get payment methods failed");
  }
}

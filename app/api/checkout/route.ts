import { getUserEmail, getUserUuid } from "@/services/user";
import { insertOrder } from "@/models/order";
import { respData, respErr } from "@/lib/resp";
import { getPricingProduct } from "@/data/pricing";
import { getSnowId } from "@/lib/hash";
import { findUserByUuid } from "@/models/user";
import { routePaymentProvider } from "@/lib/payment";
import {
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/payment/health";

import { Order } from "@/types/order";

/**
 * POST /api/checkout —— 统一支付入口（6.1）
 *
 * 安全要点（P-1.1）：金额/积分/有效期一律从服务端 data/pricing.ts 读取，
 * 忽略客户端传入值。客户端只传 product_id（+ 可选 method）。
 *
 * 渠道路由（前端永远不感知渠道）：
 * - 传 method（card/alipay/wechat_pay）→ 服务端按 payment_settings.priority
 *   选第一个启用、凭据有效、支持该方式的渠道
 * - 不传 method → 默认渠道（priority 最小）
 *
 * 请求：{ product_id, method?, cancel_url? }
 * 响应：{ checkout_url, order_no, provider }（前端直接跳转 checkout_url）
 */
export async function POST(req: Request) {
  try {
    let { product_id, method, cancel_url } = await req.json();

    if (!cancel_url) {
      cancel_url = `${
        process.env.NEXT_PUBLIC_PAY_CANCEL_URL ||
        process.env.NEXT_PUBLIC_WEB_URL
      }`;
    }

    if (!product_id) {
      return respErr("invalid params");
    }

    // 服务端定价查询（P-1.1）
    const product = getPricingProduct(product_id);
    if (!product) {
      return respErr("invalid product");
    }

    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth, please sign-in");
    }

    let user_email = await getUserEmail();
    if (!user_email) {
      const user = await findUserByUuid(user_uuid);
      if (user) {
        user_email = user.email;
      }
    }
    if (!user_email) {
      return respErr("invalid user");
    }

    // 渠道路由（method → provider，服务端决策）
    const provider = await routePaymentProvider(method);
    if (!provider) {
      return respErr("no payment provider available");
    }

    const order_no = getSnowId();
    const created_at = new Date().toISOString();

    // 一次性积分包：有效期 = 当前时间 + valid_months
    const timePeriod = new Date();
    timePeriod.setMonth(timePeriod.getMonth() + product.valid_months);
    const expired_at = timePeriod.toISOString();

    const order: Order = {
      order_no: order_no,
      created_at: created_at,
      user_uuid: user_uuid,
      user_email: user_email,
      amount: product.amount,
      interval: "one-time",
      expired_at: expired_at,
      status: "created",
      credits: product.credits,
      currency: product.currency,
      product_id: product.product_id,
      product_name: product.product_name,
      valid_months: product.valid_months,
      // R2：写入实际渠道路由结果，admin 退款按此分发（缺省会错路由到 stripe）
      payment_provider: provider.id,
    };
    await insertOrder(order);

    // 调用渠道 createCheckout（各渠道差异由适配器消化）
    const webUrl = process.env.NEXT_PUBLIC_WEB_URL || "";
    let result;
    try {
      result = await provider.createCheckout({
        order_no,
        product_id: product.product_id,
        product_name: product.product_name,
        user_uuid,
        user_email,
        amount: product.amount,
        currency: product.currency,
        credits: product.credits,
        goods_url: `${webUrl}/#pricing`,
        success_url: `${webUrl}/pay-success`,
        cancel_url,
      });
      recordProviderSuccess(provider.id);
    } catch (e) {
      // 6.1 阶段 3：连续失败标记 unhealthy，同支付方式请求自动路由下一渠道
      recordProviderFailure(provider.id);
      throw e;
    }

    if (!result.checkout_url) {
      return respErr("checkout failed: no checkout url");
    }

    return respData({
      checkout_url: result.checkout_url,
      order_no,
      provider: provider.id,
    });
  } catch (e: any) {
    console.log("checkout failed: ", e);
    return respErr("checkout failed: " + e.message);
  }
}

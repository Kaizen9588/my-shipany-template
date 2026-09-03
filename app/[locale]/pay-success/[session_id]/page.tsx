import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

/**
 * Stripe 支付成功回跳页（2.19-① 收敛）
 *
 * 此前页面直接 retrieve session 并调 handleOrderSession 落账（充值积分/发邮件）。
 * 问题：该页面无鉴权，任何持有 session_id 者都能触发 Stripe API 调用 +
 * 落账 RPC + 邮件发送（金额虽取自 Stripe 权威值且经 0010 比对，无资金风险，
 * 但可被刷 API 配额与邮件）。
 *
 * 现职责收敛为纯跳转：落账唯一入口是 /api/stripe-notify webhook
 * （验签后的服务端真相源，幂等由 handle_order_payment 保证）。
 * 展示层需要的支付结果由用户自己的 /my-orders 数据反映（webhook 已处理）。
 * 若 webhook 延迟导致订单仍 created，用户刷新订单页即可看到（Stripe 会重试投递）。
 */
export default async function ({
  params,
}: {
  params: Promise<{ session_id: string }>;
}) {
  // 参数仅用于路由匹配，不做任何服务端调用
  void params;

  const locale = await getLocale();

  redirect({ href: process.env.NEXT_PUBLIC_PAY_SUCCESS_URL || "/", locale });
}

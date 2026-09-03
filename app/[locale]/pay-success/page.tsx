import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

/**
 * 支付成功兜底页（6.1）
 * Creem/Waffo 等渠道跳转到普通 /pay-success（无 session_id），
 * 订单由 webhook 处理（服务端真相源），直接跳转订单页。
 */
export default async function PaySuccessFallback() {
  const locale = await getLocale();
  redirect({
    href: process.env.NEXT_PUBLIC_PAY_SUCCESS_URL || "/my-orders",
    locale,
  });
}

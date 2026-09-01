import { getIsoTimestr } from "@/lib/time";
import { serverClient } from "@/models/db";
import { findOrderByOrderNo } from "@/models/order";
import { fireAndForgetEmail } from "@/lib/email";
import { trackCriticalEvent } from "@/lib/oplog";

import Stripe from "stripe";

/**
 * 处理 Stripe Checkout Session 支付成功回调（P-1.3 事务化）
 *
 * 「更新订单 + 充值积分 + 记录联盟」三步由数据库存储过程
 * handle_order_payment() 在一个事务中原子完成，中间失败整体回滚；
 * 存储过程内部做幂等检查（已 paid 直接返回，Webhook 重试安全）。
 */
export async function handleOrderSession(session: Stripe.Checkout.Session) {
  try {
    if (
      !session ||
      !session.metadata ||
      !session.metadata.order_no ||
      session.payment_status !== "paid"
    ) {
      throw new Error("invalid session");
    }

    const order_no = session.metadata.order_no;
    const paid_email =
      session.customer_details?.email || session.customer_email || "";
    const paid_detail = JSON.stringify(session);
    const paid_at = getIsoTimestr();

    // 支付落账是资金操作，走 service_role（serverClient），绕过 RLS（N-3）
    const supabase = serverClient().schema("private");
    const { data, error } = await supabase.rpc("handle_order_payment", {
      p_order_no: order_no,
      p_paid_at: paid_at,
      p_paid_email: paid_email,
      p_paid_detail: paid_detail,
      // R1：金额/币种比对（与 lib/payment/index.ts 的 webhook 路径保持一致）
      p_amount_cents: session.amount_total ?? null,
      p_currency: session.currency || null,
    });

    if (error) {
      throw error;
    }

    if (data === "mismatch") {
      // R1：金额/币种不匹配，订单已置 mismatch（不充值）。不抛错——
      // 重试不可能修复金额差异，只会引发渠道无限重试（与 handlePaymentEvent 一致）
      trackCriticalEvent({
        event_type: "payment.amount_mismatch",
        severity: "critical",
        source: "webhook",
        subject_uuid: order_no,
        detail: { amount_cents: session.amount_total, currency: session.currency },
      });
      console.error(
        "[order] payment amount mismatch: order_no=",
        order_no,
        "amount_total=",
        session.amount_total,
        "currency=",
        session.currency
      );
      return data;
    }

    console.log(
      "handle order session successed: ",
      order_no,
      paid_at,
      paid_email
    );

    // 6.2：支付成功邮件（fire-and-forget，不阻塞 webhook 响应）
    void (async () => {
      try {
        const order = await findOrderByOrderNo(order_no);
        const email = order?.paid_email || order?.user_email;
        if (!order || !email) {
          return;
        }
        fireAndForgetEmail({
          to: email,
          template: "payment_success",
          variables: {
            product_name: order.product_name || "",
            credits: order.credits,
            order_no: order.order_no,
          },
          category: "transactional",
        });
      } catch (e) {
        console.error("[order] payment success email failed:", e);
      }
    })();

    return data;
  } catch (e) {
    console.log("handle order session failed: ", e);
    throw e;
  }
}

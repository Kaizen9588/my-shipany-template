import { PaymentProvider, PaymentEvent } from "./types";
import { registerPaymentProvider } from "./registry";
import { stripeProvider } from "./providers/stripe";
import { creemProvider } from "./providers/creem";
import { waffoProvider } from "./providers/waffo";
import { getIsoTimestr } from "@/lib/time";
import { getSupabaseClient } from "@/models/db";
import { fireAndForgetEmail } from "@/lib/email";
import { createNotification } from "@/models/notification";
import { processRefund } from "@/services/refund";
import { TelemetryEvents, trackServer } from "@/lib/telemetry/server";

export * from "./types";
export * from "./registry";

// 渠道注册（阶段 2 加 Stripe/PayPal 时：写 adapter + 这里加一行）
registerPaymentProvider(stripeProvider);
registerPaymentProvider(creemProvider);
registerPaymentProvider(waffoProvider);

export { stripeProvider, creemProvider, waffoProvider };

/**
 * 归一化支付事件处理（各渠道 webhook 共用）
 * 支付成功 → handle_order_payment 存储过程（事务 + 幂等，P-1.3）
 */
export async function handlePaymentEvent(event: PaymentEvent): Promise<void> {
  switch (event.type) {
    case "payment_succeeded": {
      if (!event.order_no) {
        throw new Error("payment event missing order_no");
      }

      const paid_at = getIsoTimestr();
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc("handle_order_payment", {
        p_order_no: event.order_no,
        p_paid_at: paid_at,
        p_paid_email: "",
        p_paid_detail: JSON.stringify(event.raw || {}),
        // R1：渠道实付金额/币种传入存储过程，与本地订单精确比对
        p_amount_cents: typeof event.amount === "number" ? event.amount : null,
        p_currency: event.currency || null,
      });
      if (error) {
        throw error;
      }

      // 金额/币种不匹配：订单已置 mismatch，不充值不发奖励，告警人工核查
      // （不抛错——渠道重试不可能修复金额差异，只会无限重试）
      if (data === "mismatch") {
        console.error(
          "[payment] AMOUNT MISMATCH: order_no=",
          event.order_no,
          "channel amount(cents)=",
          event.amount,
          "currency=",
          event.currency
        );
        trackServer({
          name: TelemetryEvents.PaymentAmountMismatch,
          distinctId: event.user_uuid || "server",
          properties: {
            order_no: event.order_no,
            channel_amount_cents: event.amount,
            channel_currency: event.currency || "",
          },
        });
        return;
      }

      // 6.14：站内通知（支付成功）
      if (event.user_uuid) {
        void createNotification({
          user_uuid: event.user_uuid,
          type: "payment",
          title: "Payment received",
          content: `Order ${event.order_no} paid, credits added.`,
        });
      }

      // 6.5：支付成功服务端埋点（t3）
      trackServer({
        name: TelemetryEvents.PaymentSucceeded,
        distinctId: event.user_uuid || "server",
        properties: {
          order_no: event.order_no,
          amount: event.amount,
          plan: "",
        },
      });

      // 6.2：支付成功邮件（fire-and-forget）
      void (async () => {
        try {
          const { data: order } = await supabase
            .from("orders")
            .select("paid_email, user_email, product_name, credits, order_no")
            .eq("order_no", event.order_no)
            .single();
          const email = order?.paid_email || order?.user_email;
          if (order && email) {
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
          }
        } catch (e) {
          console.error("[payment] payment success email failed:", e);
        }
      })();

      return data;
    }

    case "payment_failed":
      console.log("[payment] event:", event.type, event.order_no);
      return;

    case "refund_succeeded": {
      // 6.21：退款事件（webhook 触发）→ 扣回积分 + 标记 refunded
      if (!event.order_no) {
        console.warn("[payment] refund event missing order_no");
        return;
      }
      await processRefund({ order_no: event.order_no, amount: event.amount });
      return;
    }

    default:
      return;
  }
}

export type { PaymentProvider, PaymentEvent };

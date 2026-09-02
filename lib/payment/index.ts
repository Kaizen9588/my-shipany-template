import { PaymentProvider, PaymentEvent } from "./types";
import { registerPaymentProvider } from "./registry";
import { stripeProvider } from "./providers/stripe";
import { creemProvider } from "./providers/creem";
import { waffoProvider } from "./providers/waffo";
import { getIsoTimestr } from "@/lib/time";
import { serverClient } from "@/models/db";
import { fireAndForgetEmail } from "@/lib/email";
import { runAfterResponse } from "@/lib/after-response";
import { createNotification } from "@/models/notification";
import { registerRefundRequest } from "@/services/refund";
import { handleDisputeEvent } from "@/services/dispute";
import { notifyAffiliateReward } from "@/services/affiliate";
import { TelemetryEvents, trackServer } from "@/lib/telemetry/server";
import { trackCriticalEvent } from "@/lib/oplog";

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
      // 支付落账是资金操作，走 service_role（serverClient），绕过 RLS（N-3）
      const supabase = serverClient().schema("private");
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
        trackCriticalEvent({
          event_type: "payment.amount_mismatch",
          severity: "critical",
          source: "webhook",
          subject_uuid: event.order_no,
          detail: { amount_cents: event.amount, currency: event.currency || "" },
        });
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
        runAfterResponse(() =>
          createNotification({
            user_uuid: event.user_uuid,
            type: "payment",
            title: "Payment received",
            content: `Order ${event.order_no} paid, credits added.`,
          })
        );
      }

      // 迁移 0036：联盟奖励到账通知（fire-and-forget；发放本体在存储过程内）
      runAfterResponse(() => notifyAffiliateReward(event.order_no));

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

      // 6.2：支付成功邮件（fire-and-forget，经 after() 调度冻结安全）
      runAfterResponse(async () => {
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
      });

      return data;
    }

    case "payment_failed":
      console.log("[payment] event:", event.type, event.order_no);
      return;

    case "refund_succeeded": {
      // P0-1（docs/05 §4.3）：webhook 到达只「登记退款事实」（refund_requested 中间态
      // + refunds 退款单 + 债务化准入），不再直接扣积分/终态化——终态由后台人工/回收流程闭合。
      // admin 退款路径不受影响（processRefund 直回收 + 终态）。
      if (!event.order_no) {
        console.warn("[payment] refund event missing order_no");
        return;
      }
      if (!event.user_uuid) {
        // 没有 user_uuid 无法登记欠款归属：不终态化也不回收，告警人工核查
        trackCriticalEvent({
          event_type: "payment.refund_event_missing_user",
          severity: "critical",
          source: "webhook",
          subject_uuid: event.order_no,
          detail: { provider: event.provider || "", amount: event.amount },
        });
        return;
      }
      await registerRefundRequest({
        order_no: event.order_no,
        user_uuid: event.user_uuid,
        provider: event.provider || "",
        provider_refund_id: event.provider_ref_id || "",
        amount: event.amount,
        currency: event.currency || "USD",
        reason: "refund succeeded webhook",
        initiated_by: "customer",
      });
      return;
    }

    case "dispute_opened":
    case "dispute_won":
    case "dispute_lost": {
      // N-13 争议/拒付链路（docs/05 §7）：归一化状态 + 冻结/解冻资金与积分
      if (!event.order_no) {
        console.warn("[payment] dispute event missing order_no");
        return;
      }
      await handleDisputeEvent({
        order_no: event.order_no,
        user_uuid: event.user_uuid,
        type: event.type as "dispute_opened" | "dispute_won" | "dispute_lost",
        amount: event.amount,
        raw: event.raw,
      });
      return;
    }

    default:
      return;
  }
}

export type { PaymentProvider, PaymentEvent };

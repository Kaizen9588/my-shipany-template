import { stripeProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";

/**
 * POST /api/stripe-notify —— Stripe Webhook（6.1）
 * 验签 + 归一化由 stripeProvider.parseWebhook 消化，业务处理统一 handlePaymentEvent。
 * 验签/解析失败发射 payment.webhook_invalid_signature（docs/16 §5.4，疑似伪造或签名配置错误）。
 */
export async function POST(req: Request) {
  let event: Awaited<ReturnType<typeof stripeProvider.parseWebhook>>;
  try {
    event = await stripeProvider.parseWebhook(req);
  } catch (e: any) {
    logger.error(e, { route: "POST /api/stripe-notify", stage: "parseWebhook" });
    trackCriticalEvent({
      event_type: "payment.webhook_invalid_signature",
      severity: "critical",
      source: "webhook",
      subject_uuid: "",
      detail: { provider: "stripe", message: String(e?.message || e) },
    });
    return Response.json(
      { error: `invalid stripe webhook: ${e.message}` },
      { status: 400 }
    );
  }

  try {
    if (event) {
      await handlePaymentEvent(event);
    }
    return Response.json(stripeProvider.webhookResponseBody(true));
  } catch (e: any) {
    logger.error(e, {
      route: "POST /api/stripe-notify",
      stage: "handlePaymentEvent",
      order_no: event?.order_no || "",
    });
    return Response.json(
      { error: `handle stripe notify failed: ${e.message}` },
      { status: 500 }
    );
  }
}

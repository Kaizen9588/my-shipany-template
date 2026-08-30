import { stripeProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";
import { guardWebhookRequest, requestWithRawBody } from "@/lib/webhook-guard";

/**
 * POST /api/stripe-notify —— Stripe Webhook（6.1）
 * 验签 + 归一化由 stripeProvider.parseWebhook 消化，业务处理统一 handlePaymentEvent。
 * 验签/解析失败发射 payment.webhook_invalid_signature（docs/16 §5.4，疑似伪造或签名配置错误）。
 */
export async function POST(req: Request) {
  // N-5：body 上限防护（防止超大/畸形请求打爆内存与日志告警）
  const guard = await guardWebhookRequest(req);
  if (!guard.ok) {
    return Response.json({ error: guard.reason }, { status: guard.status });
  }

  let event: Awaited<ReturnType<typeof stripeProvider.parseWebhook>>;
  try {
    event = await stripeProvider.parseWebhook(
      requestWithRawBody(req, guard.rawBody || "")
    );
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

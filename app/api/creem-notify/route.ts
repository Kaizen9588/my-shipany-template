import { creemProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";
import { guardWebhookRequest, requestWithRawBody } from "@/lib/webhook-guard";

/**
 * POST /api/creem-notify —— Creem Webhook（6.1，docs/payment/creem-integration.md §3.4）
 * 签名：creem-signature header + HMAC-SHA256（parseWebhook 内验签）
 * 业务：checkout.completed → handle_order_payment（事务 + 幂等，P-1.3）
 * 验签/解析失败发射 payment.webhook_invalid_signature（docs/16 §5.4）。
 */
export async function POST(req: Request) {
  // N-5：body 上限防护（防止超大/畸形请求打爆内存与日志告警）
  const guard = await guardWebhookRequest(req);
  if (!guard.ok) {
    return Response.json({ error: guard.reason }, { status: guard.status });
  }

  let event: Awaited<ReturnType<typeof creemProvider.parseWebhook>>;
  try {
    event = await creemProvider.parseWebhook(
      requestWithRawBody(req, guard.rawBody || "")
    );
  } catch (e: any) {
    logger.error(e, { route: "POST /api/creem-notify", stage: "parseWebhook" });
    trackCriticalEvent({
      event_type: "payment.webhook_invalid_signature",
      severity: "critical",
      source: "webhook",
      subject_uuid: "",
      detail: { provider: "creem", message: String(e?.message || e) },
    });
    return Response.json(
      { error: `invalid creem webhook: ${e.message}` },
      { status: 400 }
    );
  }

  try {
    if (event) {
      await handlePaymentEvent(event);
    }
    return Response.json(creemProvider.webhookResponseBody(true));
  } catch (e: any) {
    logger.error(e, {
      route: "POST /api/creem-notify",
      stage: "handlePaymentEvent",
      order_no: event?.order_no || "",
    });
    return Response.json(
      { error: `handle creem notify failed: ${e.message}` },
      { status: 500 }
    );
  }
}

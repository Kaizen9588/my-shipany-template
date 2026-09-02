import { creemProvider } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";
import { guardWebhookRequest, requestWithRawBody } from "@/lib/webhook-guard";
import { processWebhookEvent } from "@/lib/webhook-process";

/**
 * POST /api/creem-notify —— Creem Webhook（6.1，docs/payment/creem-integration.md §3.4）
 * 签名：creem-signature header + HMAC-SHA256（parseWebhook 内验签）
 * 流程（P1 inbox，迁移 0031）：guard → parseWebhook（验签+归一化）→ 先落
 * payment_events inbox（幂等键 = Creem event.id，缺省 raw hash fallback）→
 * handlePaymentEvent（已处理重放跳过）→ 标记成败。
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

  // 非业务事件（parseWebhook 返回 null，含 subscription.* 日志类）：不落 inbox，直接 ack
  if (!event) {
    return Response.json(creemProvider.webhookResponseBody(true));
  }

  try {
    await processWebhookEvent(event, "creem");
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

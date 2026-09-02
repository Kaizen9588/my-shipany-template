import { stripeProvider } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";
import { guardWebhookRequest, requestWithRawBody } from "@/lib/webhook-guard";
import { processWebhookEvent } from "@/lib/webhook-process";

/**
 * POST /api/stripe-notify —— Stripe Webhook（6.1）
 * 流程（P1 inbox，迁移 0031）：guard（64KB 上限）→ parseWebhook（验签+归一化）
 * → **先落 payment_events inbox（原始 payload 存档 + event.id 幂等键）**
 * → handlePaymentEvent（已处理的重放直接跳过）→ 标记 processed/失败留错重试。
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

  // 非业务事件（parseWebhook 返回 null）：不落 inbox，直接 ack
  if (!event) {
    return Response.json(stripeProvider.webhookResponseBody(true));
  }

  try {
    await processWebhookEvent(event, "stripe");
    return Response.json(stripeProvider.webhookResponseBody(true));
  } catch (e: any) {
    logger.error(e, {
      route: "POST /api/stripe-notify",
      stage: "handlePaymentEvent",
      order_no: event?.order_no || "",
    });
    // inbox 行已保留失败痕迹，渠道重试/每日 cron 重放兜底；返回 500 让渠道重试
    return Response.json(
      { error: `handle stripe notify failed: ${e.message}` },
      { status: 500 }
    );
  }
}

import { waffoProvider } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";
import { guardWebhookRequest, requestWithRawBody } from "@/lib/webhook-guard";
import { processWebhookEvent } from "@/lib/webhook-process";

/**
 * POST /api/waffo-notify —— Waffo Pancake Webhook
 * （docs/payment/waffo-operations-guide.md §六；2026-08 从旧代 API 迁移）
 * 签名：x-waffo-signature（t=,v1= RSA-SHA256，SDK 内置公钥验签 + 时间戳防重放）
 * 响应：成功 200 + 纯文本 "OK"；失败非 2xx，Waffo 重试最多 5 次
 *      （5min/30min/2h/24h）。验签/解析失败发射 payment.webhook_invalid_signature。
 * 流程（P1 inbox，迁移 0031）：guard → parseWebhook（验签+归一化）→ 先落
 * payment_events inbox（幂等键 = Pancake delivery id，缺省 raw hash fallback）→
 * handlePaymentEvent（已处理重放跳过）→ 标记成败。
 */
function toWebhookResponse(success: boolean, status: number): Response {
  const body = waffoProvider.webhookResponseBody(success);
  if (typeof body === "string") {
    return new Response(body, {
      status,
      headers: { "content-type": "text/plain" },
    });
  }
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  // N-5：body 上限防护（Waffo 事件重试≤5 次且数据量小；超限直接拒绝，不验签不打告警）
  const guard = await guardWebhookRequest(req);
  if (!guard.ok) {
    return toWebhookResponse(false, guard.status || 413);
  }

  let event: Awaited<ReturnType<typeof waffoProvider.parseWebhook>>;
  try {
    event = await waffoProvider.parseWebhook(
      requestWithRawBody(req, guard.rawBody || "")
    );
  } catch (e: any) {
    logger.error(e, { route: "POST /api/waffo-notify", stage: "parseWebhook" });
    trackCriticalEvent({
      event_type: "payment.webhook_invalid_signature",
      severity: "critical",
      source: "webhook",
      subject_uuid: "",
      detail: { provider: "waffo", message: String(e?.message || e) },
    });
    // 非 2xx：渠道按重试日程重投
    return toWebhookResponse(false, 400);
  }

  // 非业务事件（parseWebhook 返回 null，含未订阅 eventType）：不落 inbox，直接 ack
  if (!event) {
    return toWebhookResponse(true, 200);
  }

  try {
    await processWebhookEvent(event, "waffo");
    return toWebhookResponse(true, 200);
  } catch (e: any) {
    logger.error(e, {
      route: "POST /api/waffo-notify",
      stage: "handlePaymentEvent",
      order_no: event?.order_no || "",
    });
    // inbox 行已保留失败痕迹，渠道重试/每日 cron 重放兜底；非 2xx 触发渠道重试
    return toWebhookResponse(false, 500);
  }
}

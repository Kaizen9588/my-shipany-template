import { waffoProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";

/**
 * POST /api/waffo-notify —— Waffo Pancake Webhook
 * （docs/payment/waffo-operations-guide.md §六；2026-08 从旧代 API 迁移）
 * 签名：x-waffo-signature（t=,v1= RSA-SHA256，SDK 内置公钥验签 + 时间戳防重放）
 * 响应：成功 200 + 纯文本 "OK"；失败非 2xx，Waffo 重试最多 5 次
 *      （5min/30min/2h/24h）。验签/解析失败发射 payment.webhook_invalid_signature。
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
  let event: Awaited<ReturnType<typeof waffoProvider.parseWebhook>>;
  try {
    event = await waffoProvider.parseWebhook(req);
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

  try {
    if (event) {
      await handlePaymentEvent(event);
    }
    return toWebhookResponse(true, 200);
  } catch (e: any) {
    logger.error(e, {
      route: "POST /api/waffo-notify",
      stage: "handlePaymentEvent",
      order_no: event?.order_no || "",
    });
    return toWebhookResponse(false, 500);
  }
}

import { waffoProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";
import { trackCriticalEvent } from "@/lib/oplog";
import { logger } from "@/lib/logger";

/**
 * POST /api/waffo-notify —— Waffo Webhook（6.1，docs/payment/waffo-integration.md §4）
 * 签名：X-SIGNATURE + RSA（SDK handleWebhook 内验签）
 * 响应：必须 {"message":"success"}，否则 Waffo 视为失败并重试（最多 8 次）
 * 验签/解析失败发射 payment.webhook_invalid_signature（docs/16 §5.4）。
 */
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
    // 保持 Waffo 响应契约（非 success 即重试）
    return Response.json(waffoProvider.webhookResponseBody(false), {
      status: 400,
    });
  }

  try {
    if (event) {
      await handlePaymentEvent(event);
    }
    return Response.json(waffoProvider.webhookResponseBody(true));
  } catch (e: any) {
    logger.error(e, {
      route: "POST /api/waffo-notify",
      stage: "handlePaymentEvent",
      order_no: event?.order_no || "",
    });
    return Response.json(waffoProvider.webhookResponseBody(false), {
      status: 500,
    });
  }
}

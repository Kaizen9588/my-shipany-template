import { waffoProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";

/**
 * POST /api/waffo-notify —— Waffo Webhook（6.1，docs/payment/waffo-integration.md §4）
 * 签名：X-SIGNATURE + RSA（SDK handleWebhook 内验签）
 * 响应：必须 {"message":"success"}，否则 Waffo 视为失败并重试（最多 8 次）
 */
export async function POST(req: Request) {
  try {
    const event = await waffoProvider.parseWebhook(req);
    if (event) {
      await handlePaymentEvent(event);
    }
    return Response.json(waffoProvider.webhookResponseBody(true));
  } catch (e: any) {
    console.log("waffo notify failed: ", e);
    return Response.json(waffoProvider.webhookResponseBody(false), {
      status: 500,
    });
  }
}

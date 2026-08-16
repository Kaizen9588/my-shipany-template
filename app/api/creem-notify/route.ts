import { creemProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";

/**
 * POST /api/creem-notify —— Creem Webhook（6.1，docs/payment/creem-integration.md §3.4）
 * 签名：creem-signature header + HMAC-SHA256（parseWebhook 内验签）
 * 业务：checkout.completed → handle_order_payment（事务 + 幂等，P-1.3）
 */
export async function POST(req: Request) {
  try {
    const event = await creemProvider.parseWebhook(req);
    if (event) {
      await handlePaymentEvent(event);
    }
    return Response.json(creemProvider.webhookResponseBody(true));
  } catch (e: any) {
    console.log("creem notify failed: ", e);
    return Response.json(
      { error: `handle creem notify failed: ${e.message}` },
      { status: 500 }
    );
  }
}

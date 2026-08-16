import { stripeProvider } from "@/lib/payment";
import { handlePaymentEvent } from "@/lib/payment";

/**
 * POST /api/stripe-notify —— Stripe Webhook（6.1）
 * 验签 + 归一化由 stripeProvider.parseWebhook 消化，业务处理统一 handlePaymentEvent。
 */
export async function POST(req: Request) {
  try {
    const event = await stripeProvider.parseWebhook(req);
    if (event) {
      await handlePaymentEvent(event);
    }
    return Response.json(stripeProvider.webhookResponseBody(true));
  } catch (e: any) {
    console.log("stripe notify failed: ", e);
    return Response.json(
      { error: `handle stripe notify failed: ${e.message}` },
      { status: 500 }
    );
  }
}

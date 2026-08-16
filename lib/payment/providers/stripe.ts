import Stripe from "stripe";
import {
  CheckoutParams,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
} from "../types";
import { findOrderByOrderNo, updateOrderSession } from "@/models/order";

/**
 * Stripe 支付渠道适配器（6.1）
 * 现有 Stripe 集成重构为 Provider 形态；阶段 1 作为默认渠道（priority 10）。
 */
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  supported_methods: ["card", "alipay", "wechat_pay"],
  capabilities: {
    refund_api: true,
    subscription: true,
    portal: true,
  },

  hasValidCredentials() {
    return Boolean(
      process.env.STRIPE_PRIVATE_KEY && process.env.STRIPE_PUBLIC_KEY
    );
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY || "");

    const options: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: params.currency,
            product_data: { name: params.product_name },
            unit_amount: params.amount,
          },
          quantity: 1,
        },
      ],
      // R1 金额比对要求「实付 == 订单额」精确匹配；促销码打折后实付 < 订单额
      // 会被判 mismatch。优惠码待订单模型支持折扣金额后再恢复（迁移 0010 注释）。
      allow_promotion_codes: false,
      metadata: {
        project: process.env.NEXT_PUBLIC_PROJECT_NAME || "",
        product_name: params.product_name,
        order_no: params.order_no,
        user_email: params.user_email,
        credits: String(params.credits),
        user_uuid: params.user_uuid,
      },
      mode: "payment",
      // Stripe 成功页需要 {CHECKOUT_SESSION_ID} 模板（其他渠道用普通 URL，适配器内消化差异）
      success_url: `${params.success_url}/{CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancel_url,
      customer_email: params.user_email,
    };

    const session = await stripe.checkout.sessions.create(options);

    // 渠道 session id 存入 orders.stripe_session_id
    await updateOrderSession(
      params.order_no,
      session.id,
      JSON.stringify(options)
    );

    return {
      checkout_url: session.url || "",
      provider_session_id: session.id,
    };
  },

  async parseWebhook(req: Request): Promise<PaymentEvent | null> {
    const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY || "");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("invalid stripe webhook config");
    }

    const sign = req.headers.get("stripe-signature") as string;
    const body = await req.text();
    if (!sign) {
      throw new Error("missing stripe-signature");
    }

    const event = await stripe.webhooks.constructEventAsync(body, sign, secret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== "paid") {
          return null;
        }
        return {
          type: "payment_succeeded",
          order_no: session.metadata?.order_no || "",
          user_uuid: session.metadata?.user_uuid || "",
          credits: parseInt(session.metadata?.credits || "0", 10),
          amount: session.amount_total || 0,
          currency: session.currency || "",
          raw: session,
        };
      }

      // 6.21：退款事件 → 通过 payment_intent 反查订单
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntent =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id || "";
        if (!paymentIntent) {
          return null;
        }
        const session = await stripe.checkout.sessions
          .list({ payment_intent: paymentIntent, limit: 1 })
          .then((r) => r.data[0]);
        if (!session?.metadata?.order_no) {
          return null;
        }
        return {
          type: "refund_succeeded",
          order_no: session.metadata.order_no,
          user_uuid: session.metadata.user_uuid || "",
          credits: 0,
          amount: charge.amount_refunded || 0,
          raw: charge,
        };
      }

      default:
        return null;
    }
  },

  webhookResponseBody(success: boolean) {
    return { received: success };
  },

  async refund(params: { order_no: string; amount?: number }) {
    const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY || "");
    const order = await findOrderByOrderNo(params.order_no);
    if (!order?.stripe_session_id) {
      throw new Error("order has no stripe session");
    }
    const session = await stripe.checkout.sessions.retrieve(
      order.stripe_session_id
    );
    const paymentIntent = session.payment_intent as string;
    if (!paymentIntent) {
      throw new Error("order has no payment intent");
    }
    await stripe.refunds.create({
      payment_intent: paymentIntent,
      ...(params.amount ? { amount: params.amount } : {}),
    });
  },
};

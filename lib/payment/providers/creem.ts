import { Creem } from "creem";
import { createHmac, timingSafeEqual } from "crypto";
import {
  CheckoutParams,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
} from "../types";
import { getPaymentProducts } from "@/models/payment";
import { getSupabaseClient } from "@/models/db";

/**
 * Creem 支付渠道适配器（6.1，docs/payment/creem-integration.md）
 *
 * 差异点（适配器内消化）：
 * - 预建 product：checkout 传 creem_product_id（从 payment_products 表映射）
 * - 认证：x-api-key（SDK 内部处理）
 * - Webhook 签名：creem-signature header + HMAC-SHA256
 * - 退款 API：无 → capabilities.refund_api = false（Dashboard 手动 + refund.created webhook）
 */
export const creemProvider: PaymentProvider = {
  id: "creem",
  supported_methods: ["card", "alipay"],
  capabilities: {
    refund_api: false,
    subscription: true,
    portal: false,
  },

  hasValidCredentials() {
    return Boolean(process.env.CREEM_API_KEY);
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const creem = new Creem({
      apiKey: process.env.CREEM_API_KEY,
      server: process.env.NODE_ENV === "production" ? "prod" : "test",
    });

    // Creem 预建产品映射（payment_products.creem_product_id）
    const products = await getPaymentProducts();
    const creemProductId =
      products[params.product_id]?.creem_product_id || "";

    if (!creemProductId) {
      throw new Error(
        `creem product not mapped for: ${params.product_id}（请在 Creem Dashboard 创建产品并回填 payment_products.creem_product_id）`
      );
    }

    const checkout = await creem.checkouts.create({
      requestId: params.order_no, // 幂等键
      productId: creemProductId,
      successUrl: params.success_url,
      metadata: {
        order_no: params.order_no,
        user_uuid: params.user_uuid,
        user_email: params.user_email,
        credits: String(params.credits),
      },
      customer: { email: params.user_email },
    });

    // 存入 creem_orders 渠道专属表
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("creem_orders").insert({
      order_no: params.order_no,
      creem_checkout_id: checkout.id || "",
      created_at: new Date().toISOString(),
    });
    if (error) {
      throw error;
    }

    return {
      checkout_url: checkout.checkoutUrl || "",
      provider_session_id: checkout.id || "",
    };
  },

  async parseWebhook(req: Request): Promise<PaymentEvent | null> {
    const secret = process.env.CREEM_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("invalid creem webhook config");
    }

    const signature = req.headers.get("creem-signature") as string;
    const body = await req.text();
    if (!signature) {
      throw new Error("missing creem-signature");
    }

    // HMAC-SHA256 验签（creem-signature header，secret 为 key）
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const received = signature;
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(received);
    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new Error("invalid creem webhook signature");
    }

    const event = JSON.parse(body);
    if (event?.eventType === "checkout.completed") {
      const obj = event.object || {};
      const metadata = obj.metadata || {};
      // Creem 的 product.price 是 { amount, currency } 对象（部分版本直接给数字），
      // 统一归一化为「分 + 币种」，供 handle_order_payment 与本地订单比对（R1）
      const price = obj.product?.price;
      const amountCents =
        typeof price === "number" ? price : Number(price?.amount || 0);
      const currency =
        typeof price === "object" && price ? String(price.currency || "") : "";
      return {
        type: "payment_succeeded",
        order_no: metadata.order_no || "",
        user_uuid: metadata.user_uuid || "",
        credits: parseInt(metadata.credits || "0", 10),
        amount: Math.round(amountCents),
        currency,
        raw: event,
      };
    }

    // 6.21：退款事件（Creem Dashboard 手动退款后触发 → 同步扣回积分）
    if (event?.eventType === "refund.created") {
      const obj = event.object || {};
      const metadata = obj.metadata || {};
      return {
        type: "refund_succeeded",
        order_no: metadata.order_no || obj.order_no || "",
        user_uuid: metadata.user_uuid || obj.user_uuid || "",
        credits: 0,
        amount: obj.amount || 0,
        raw: event,
      };
    }

    // subscription.* 事件 v1 记录日志（订阅功能 v1 不启用）
    if (
      event?.eventType &&
      typeof event.eventType === "string" &&
      event.eventType.startsWith("subscription.")
    ) {
      console.log("[creem] subscription event:", event.eventType);
    }

    return null;
  },

  webhookResponseBody(success: boolean) {
    return { received: success };
  },
};

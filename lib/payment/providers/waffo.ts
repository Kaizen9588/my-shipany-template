import { Environment, Waffo } from "@waffo/waffo-node";
import {
  CheckoutParams,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
} from "../types";
import { getSupabaseClient } from "@/models/db";

/**
 * Waffo 支付渠道适配器（6.1，docs/payment/waffo-integration.md）
 *
 * 差异点（适配器内消化）：
 * - 动态金额：无 product 概念，金额为字符串（"99.00"）
 * - 认证：API Key + RSA 密钥对 + merchantId
 * - Webhook：RSA 验签（X-SIGNATURE），响应必须 {"message":"success"}
 * - 退款 API：有
 */
let waffoClient: Waffo | null = null;

function getWaffoClient(): Waffo {
  if (!waffoClient) {
    waffoClient = new Waffo({
      apiKey: process.env.WAFFO_API_KEY || "",
      privateKey: process.env.WAFFO_PRIVATE_KEY || "",
      waffoPublicKey: process.env.WAFFO_PUBLIC_KEY || "",
      merchantId: process.env.WAFFO_MERCHANT_ID || "",
      environment:
        process.env.NODE_ENV === "production"
          ? Environment.PRODUCTION
          : Environment.SANDBOX,
    });
  }
  return waffoClient;
}

function centsToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const waffoProvider: PaymentProvider = {
  id: "waffo",
  supported_methods: ["card", "alipay", "wechat_pay"],
  capabilities: {
    refund_api: true,
    subscription: true,
    portal: true,
  },

  hasValidCredentials() {
    return Boolean(
      process.env.WAFFO_API_KEY &&
        process.env.WAFFO_PRIVATE_KEY &&
        process.env.WAFFO_PUBLIC_KEY &&
        process.env.WAFFO_MERCHANT_ID
    );
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const waffo = getWaffoClient();
    const webUrl = process.env.NEXT_PUBLIC_WEB_URL || "";

    const response = await waffo.order().create({
      paymentRequestId: params.order_no, // 幂等键（≤32 位）
      merchantOrderId: params.order_no,
      orderCurrency: params.currency,
      orderAmount: centsToString(params.amount),
      orderDescription: params.product_name,
      orderRequestedAt: new Date().toISOString(),
      notifyUrl: `${webUrl}/api/waffo-notify`,
      successRedirectUrl: params.success_url,
      failedRedirectUrl: params.cancel_url,
      cancelRedirectUrl: params.cancel_url,
      userInfo: {
        userId: params.user_uuid, // 必填
        userEmail: params.user_email, // 必填（真实邮箱，防欺诈）
        userTerminal: "WEB", // 必填
      },
      paymentInfo: {
        productName: "ONE_TIME_PAYMENT", // 不传 payMethodName → 用户跳 Waffo cashier 自选支付方式
      },
      goodsInfo: {
        goodsName: params.product_name, // 必填
        goodsUrl: params.goods_url, // 必填（合规）
        appName: process.env.NEXT_PUBLIC_PROJECT_NAME || "", // 必填：goodsUrl 或 appName 至少一个
      },
      extendInfo: JSON.stringify({
        order_no: params.order_no,
        user_uuid: params.user_uuid,
        credits: params.credits,
      }),
    });

    if (!response.isSuccess()) {
      throw new Error(
        `waffo order create failed: ${response.getMessage() || "unknown"}`
      );
    }

    const data = response.getData();
    if (!data) {
      throw new Error("waffo order create failed: empty data");
    }

    // 存入 waffo_orders 渠道专属表
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("waffo_orders").insert({
      order_no: params.order_no,
      acquiring_order_id: data.acquiringOrderId || "",
      payment_request_id: params.order_no,
      created_at: new Date().toISOString(),
    });
    if (error) {
      throw error;
    }

    return {
      checkout_url: data.orderAction || "",
      provider_session_id: data.acquiringOrderId || "",
    };
  },

  async parseWebhook(req: Request): Promise<PaymentEvent | null> {
    const waffo = getWaffoClient();
    const body = await req.text();
    const signature = req.headers.get("x-signature") || "";

    if (!signature) {
      throw new Error("missing x-signature");
    }

    const handler = waffo.webhook();
    let settled = false;

    // 兜底超时：SDK 可能在验签失败时 resolve（而非 reject）、或回调类型不匹配
    // 而不触发 onPayment/onRefund —— 此前 Promise 永久 pending，请求悬挂 + 渠道无限重试
    // （docs/12 2.11）。时限内未 settle 按 "未识别事件" 处理返回 null，避免挂起。
    const event = await new Promise<PaymentEvent | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 10_000);

      const settle = (ev: PaymentEvent | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ev);
      };

      handler.onPayment((notification: any) => {
        const result = notification?.result || {};
        const extendInfo = result.extendInfo
          ? safeParseExtend(result.extendInfo)
          : {};
        const orderNo = String(
          result.merchantOrderId || extendInfo.order_no || ""
        );
        settle({
          type:
            result.orderStatus === "PAY_SUCCESS"
              ? "payment_succeeded"
              : "payment_failed",
          order_no: orderNo,
          user_uuid: String(extendInfo.user_uuid || ""),
          credits: parseInt(String(extendInfo.credits || "0"), 10),
          amount: Math.round(
            parseFloat(String(result.orderAmount || "0")) * 100
          ),
          currency: String(result.orderCurrency || ""),
          raw: notification,
        });
      });

      handler.onRefund((notification: any) => {
        const result = notification?.result || {};
        settle({
          type: "refund_succeeded",
          order_no: String(result.origPaymentRequestId || ""),
          user_uuid: "",
          credits: 0,
          amount: Math.round(
            parseFloat(String(result.refundAmount || "0")) * 100
          ),
          raw: notification,
        });
      });

      // 验签 + 事件路由（SDK 内部完成 RSA 验签）
      handler
        .handleWebhook(body, signature)
        .then(() => {
          // 正常 resolve 但未命中任何业务回调（未知事件类型）→ 兜底返回 null
          settle(null);
        })
        .catch((e: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(
              new Error(`waffo webhook verify failed: ${e.message}`)
            );
          }
        });
    });

    return event;
  },

  webhookResponseBody(success: boolean) {
    // ⚠️ Waffo 必须返回 {"message":"success"}，否则视为失败并重试（最多 8 次）
    return { message: success ? "success" : "failed" };
  },

  async refund(params: { order_no: string; amount?: number }) {
    const waffo = getWaffoClient();
    const webUrl = process.env.NEXT_PUBLIC_WEB_URL || "";
    const response = await waffo.order().refund({
      merchantOrderId: params.order_no,
      refundAmount: params.amount ? centsToString(params.amount) : undefined,
      refundReason: "requested_by_customer",
      refundNotifyUrl: `${webUrl}/api/waffo-notify`,
    } as any);
    if (!response.isSuccess()) {
      throw new Error(
        `waffo refund failed: ${response.getMessage() || "unknown"}`
      );
    }
  },
};

function safeParseExtend(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch (e) {
    return {};
  }
}

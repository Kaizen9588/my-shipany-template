import {
  WaffoPancake,
  WebhookEvent,
  WebhookEventType,
} from "@waffo/pancake-ts";
import {
  CheckoutParams,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
} from "../types";
import { serverClient } from "@/models/db";
import { getPaymentProducts } from "@/models/payment";
import { findOrderByOrderNo } from "@/models/order";

/**
 * Waffo 支付渠道适配器（Pancake 新一代模型，2026-08 从 @waffo/waffo-node 迁移）
 * 操作指南：docs/payment/waffo-operations-guide.md
 *
 * 差异点（适配器内消化，均以 @waffo/pancake-ts d.ts 为准）：
 * - 预建产品：金额真相在渠道目录（Store/Product + publish），本地下单不传金额、
 *   严禁 priceSnapshot 覆盖目录价 —— webhook 实付额与本地订单靠迁移 0010 精确比对兜底
 * - 认证收敛为 2 项凭据：WAFFO_MERCHANT_ID + WAFFO_PRIVATE_KEY（PEM，
 *   或 WAFFO_PRIVATE_KEY_BASE64 供 CI）；旧 API_KEY/WAFFO_PUBLIC_KEY 已废弃
 * - 会话：登录用户一律 checkout.authenticated.create（buyerIdentity=user_uuid 防
 *   串号），session 默认 45 分钟；新标签页打开 checkoutUrl（Safari ITP）
 * - Webhook：x-waffo-signature 头（t=,v1= RSA-SHA256），SDK 内置验签公钥 +
 *   时间戳防重放（默认容忍 45 分钟以覆盖全部重试）；成功响应体是纯文本 "OK"
 * - 幂等锚点：orderMerchantExternalId = order_no，webhook data 原样回传
 * - 退款：Pancake 无商户退款 API（OrdersResource 仅 cancelSubscription）——
 *   capabilities.refund_api=false，后台退款走手动指引，refund.succeeded webhook 扣回积分
 */
let pancakeClient: WaffoPancake | null = null;

function getPancakeClient(): WaffoPancake {
  if (!pancakeClient) {
    // BASE64 注入供 CI/托管平台无法存多行 PEM 的场景（操作指南 §三注入方式 C）
    const privateKey = process.env.WAFFO_PRIVATE_KEY_BASE64
      ? Buffer.from(process.env.WAFFO_PRIVATE_KEY_BASE64, "base64").toString(
          "utf8"
        )
      : process.env.WAFFO_PRIVATE_KEY || "";
    pancakeClient = new WaffoPancake({
      merchantId: process.env.WAFFO_MERCHANT_ID || "",
      privateKey,
    });
  }
  return pancakeClient;
}

/** 渠道显示串金额（"29.00"）→ 整数分。JPY 等零小数币种本项目 v1 未启用 */
function displayToCents(display: string | undefined): number {
  return Math.round(parseFloat(String(display ?? "0")) * 100);
}

export const waffoProvider: PaymentProvider = {
  id: "waffo",
  // Pancake 收银台方法集为 card/applepay/googlepay/wechat（d.ts PaymentMethod），无 alipay
  supported_methods: ["card", "wechat_pay"],
  capabilities: {
    refund_api: false, // Pancake 无商户退款 API → 后台退款给手动指引，webhook 兜底扣分
    subscription: true, // 模型存在但 v1 产品全为一次性
    portal: false, // customer session 自助管理未接入
  },

  hasValidCredentials() {
    return Boolean(
      process.env.WAFFO_MERCHANT_ID &&
        (process.env.WAFFO_PRIVATE_KEY || process.env.WAFFO_PRIVATE_KEY_BASE64)
    );
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const waffo = getPancakeClient();

    // Pancake 预建产品映射（payment_products.waffo_product_id，迁移 0018）
    const products = await getPaymentProducts();
    const waffoProductId = products[params.product_id]?.waffo_product_id || "";
    if (!waffoProductId) {
      throw new Error(
        `waffo product not mapped for: ${params.product_id}（请在 Waffo 创建 Store/Product 并 publish，再回填 payment_products.waffo_product_id；价格必须等于目录原价且与定价页含税口径一致）`
      );
    }

    const result = await waffo.checkout.authenticated.create({
      productId: waffoProductId,
      currency: params.currency.toUpperCase(),
      buyerIdentity: params.user_uuid, // 绑定我方账户 id，JWT 身份防串号/滥用
      buyerEmail: params.user_email, // 仅预填收银台邮箱输入框，与身份独立
      successUrl: params.success_url,
      orderMerchantExternalId: params.order_no, // 幂等/对账锚点，webhook 回传
      metadata: {
        order_no: params.order_no,
        user_uuid: params.user_uuid,
        credits: String(params.credits),
      },
      // 不传 priceSnapshot：目录原价即实付价（资金安全约束，动态改价 v1 禁用）
      // 不传 cancel_url：create-session 无该参数，取消在收银台上完成
    });

    // 存入 waffo_orders 渠道专属表（渠道表仅服务端写入，走 service_role，N-3）
    const supabase = serverClient();
    const { error } = await supabase.from("waffo_orders").insert({
      order_no: params.order_no,
      acquiring_order_id: "",
      payment_request_id: params.order_no,
      session_id: result.sessionId || "",
      checkout_expires_at: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : null,
      created_at: new Date().toISOString(),
    });
    if (error) {
      throw error;
    }

    return {
      checkout_url: result.checkoutUrl || "",
      provider_session_id: result.sessionId || "",
    };
  },

  async parseWebhook(req: Request): Promise<PaymentEvent | null> {
    const body = await req.text();
    const signature =
      req.headers.get("x-waffo-signature") ||
      req.headers.get("X-Waffo-Signature") ||
      "";

    if (!signature) {
      throw new Error("missing x-waffo-signature");
    }

    // SDK 验签失败/时间戳过期直接抛错（旧代 SDK 静默 resolve 的坑已在新代消除）
    let event: WebhookEvent;
    try {
      event = getPancakeClient().webhooks.verify(body, signature);
    } catch (e) {
      throw new Error(`waffo webhook verify failed: ${(e as Error).message}`);
    }

    const data = (event.data || {}) as WebhookEvent["data"];
    const meta = data.orderMetadata || {};
    const orderNo = String(
      data.orderMerchantExternalId || meta.order_no || ""
    );

    switch (event.eventType) {
      case WebhookEventType.OrderCompleted: {
        return {
          type: "payment_succeeded",
          order_no: orderNo,
          user_uuid: String(meta.user_uuid || ""),
          credits: parseInt(String(meta.credits || "0"), 10),
          // 含税总额优先（taxIncluded 口径下 = 标价 = 本地订单额）
          amount: displayToCents(data.total ?? data.amount),
          currency: String(data.currency || ""),
          provider_event_id: String(event.id || ""),
          raw: event,
        };
      }
      case WebhookEventType.RefundSucceeded: {
        // Waffo 退款事件不带 user identity（orderMetadata 不保证有 user_uuid），
        // 从本地订单反查——缺了它 webhook 只能告警、无法登记欠款归属（审查修复）
        let refundUserUuid = String(meta.user_uuid || "");
        if (!refundUserUuid && orderNo) {
          try {
            const order = await findOrderByOrderNo(orderNo);
            refundUserUuid = order?.user_uuid || "";
          } catch {
            // 反查失败按缺 user_uuid 处理（上层会告警人工核查）
          }
        }
        return {
          type: "refund_succeeded",
          order_no: orderNo,
          user_uuid: refundUserUuid,
          credits: 0,
          amount: displayToCents(data.amount),
          provider: "waffo",
          provider_ref_id: String(event.id || ""),
          provider_event_id: String(event.id || ""),
          raw: event,
        };
      }
      default:
        // N-13 边界：Pancake v0.19 webhook 枚举无 dispute/chargeback 事件类型
        //（仅 Dashboard 通知设置里暴露 notifyChargeback，无 webhook 归一化入口）。
        // 拒付由渠道内置防御承担 + Dashboard 人工处理；本地无事件可归一化，仅告警关注。
        console.log("[waffo] unhandled webhook eventType:", event.eventType);
        return null;
    }
  },

  webhookResponseBody(success: boolean) {
    // ⚠️ Pancake 官方契约：200 + 纯文本 "OK"（旧代的 {"message":"success"} 已废止）
    return success ? "OK" : { message: "failed" };
  },
};

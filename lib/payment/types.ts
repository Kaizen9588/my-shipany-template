/**
 * 支付 Provider 抽象层类型定义（6.1，docs/payment/provider-abstraction.md）
 *
 * 核心原则：
 * - 用户只感知支付方式（card/alipay/wechat_pay），不感知渠道（stripe/creem/waffo）
 * - 渠道是插件：新增渠道 = 一个 adapter + registry 加一行
 * - 金额统一「分」（整数），各渠道差异（Waffo 字符串金额等）由适配器消化
 */

export type PaymentMethod = "card" | "alipay" | "wechat_pay" | "paypal";

export interface CheckoutParams {
  order_no: string; // 内部订单号（幂等键）
  product_id: string;
  product_name: string;
  user_uuid: string;
  user_email: string;
  amount: number; // 分（整数）
  currency: string; // 大写 ISO
  credits: number;
  goods_url: string; // 产品 URL（合规要求）
  success_url: string;
  cancel_url: string;
}

export interface CheckoutResult {
  checkout_url: string; // 重定向用户
  provider_session_id: string; // 存入渠道专属表
}

export type PaymentEventType =
  | "payment_succeeded"
  | "payment_failed"
  | "refund_succeeded"
  | "dispute_opened"
  | "dispute_won"
  | "dispute_lost"
  | "subscription_activated"
  | "subscription_canceled"
  | "subscription_renewed";

export interface PaymentEvent {
  type: PaymentEventType;
  order_no: string;
  user_uuid: string;
  credits: number;
  /** 实付金额（分，整数）——由 handle_order_payment 与本地订单精确比对（R1） */
  amount: number;
  /** 实付币种（ISO，大小写不敏感）——与本地订单比对（R1） */
  currency?: string;
  /** 渠道 ID（适配器填自己的 id）——退款登记 refunds.provider 用（P0-1） */
  provider?: string;
  /** 渠道退款/争议对象 ID（如 Stripe refund.id）——refunds.provider_refund_id 幂等键（P0-1） */
  provider_ref_id?: string;
  raw: unknown; // 原始 payload 存 order_detail
}

export interface PaymentProvider {
  id: string; // "stripe" | "creem" | "waffo" | "paypal"
  supported_methods: PaymentMethod[];
  capabilities: {
    refund_api: boolean; // Stripe=true；Creem=false；Waffo（Pancake）=false，退款走 Dashboard 手动 + refund.succeeded webhook
    subscription: boolean;
    portal: boolean;
  };

  hasValidCredentials(): boolean;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  /** 验签 + 归一化；验签失败抛错，非业务事件返回 null */
  parseWebhook(req: Request): Promise<PaymentEvent | null>;
  /**
   * 各渠道 webhook 响应体要求。返回 object 走 JSON；返回 string 走 text/plain
   * （Pancake 官方契约：200 + 纯文本 "OK"，不再是旧代 {"message":"success"}）
   */
  webhookResponseBody(success: boolean): object | string;
  refund?(params: { order_no: string; amount?: number }): Promise<void>;
  cancelSubscription?(providerSubId: string): Promise<void>;
  createPortal?(customerId: string): Promise<string>;
}

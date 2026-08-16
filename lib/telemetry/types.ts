/**
 * 埋点事件类型与规范（6.5，docs/11）
 * 事件命名：对象_动作（动词后置），全小写 + 点号分层。
 */

export type TelemetryEvent = {
  name: string;
  properties?: Record<string, string | number | boolean>;
  /** 服务端事件：用户标识（user_uuid）；客户端由 SDK 自动附加 */
  distinctId?: string;
};

export interface TelemetryProvider {
  id: string;
  hasValidCredentials(): boolean;
  captureClient(event: TelemetryEvent): void;
  captureServer(event: TelemetryEvent): void;
  identify(userId: string, props?: Record<string, unknown>): void;
}

/** 事件名常量（docs/11 §5 规范） */
export const TelemetryEvents = {
  LandingViewed: "landing.visited",
  SignupStarted: "signup.started",
  SignupCompleted: "signup.completed",
  PricingViewed: "pricing.viewed",
  PlanSelected: "pricing.plan_selected",
  CheckoutStarted: "checkout.started", // t1：点击 Buy
  CheckoutUrlRedirected: "checkout.url_redirected", // t2：拿到托管页 URL
  PaymentSucceeded: "payment.succeeded", // t3：webhook 服务端确认
  PaymentFailed: "payment.failed",
  PaymentAmountMismatch: "payment.amount_mismatch", // 渠道实付与本地订单不符，订单已置 mismatch 待人工核查
  CreditsExhausted: "credits.exhausted",
  ApiKeyCreated: "api_key.created",
} as const;

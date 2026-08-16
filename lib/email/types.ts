/**
 * 邮件系统类型定义（6.2，docs/10）
 * 与支付 Provider 同构：接口抽象 + 环境变量选实现 + 失败降级不阻塞主流程。
 */

export type EmailTemplate =
  | "welcome"
  | "verification_code"
  | "payment_success"
  | "credit_low"
  | "credit_exhausted"
  | "subscription_renewal_reminder" // 预留：订阅续费提醒（ROSCA/ARL 合规必须）
  | "subscription_canceled" // 预留
  | "password_reset"; // 预留

export interface EmailMessage {
  to: string; // 收件人
  template: EmailTemplate;
  variables: Record<string, string | number>; // 模板变量
  category: "transactional" | "marketing";
}

export interface EmailResult {
  id: string; // provider 返回的 message id
  status: "sent" | "failed";
  error?: string;
}

export interface EmailProvider {
  id: string; // "resend"
  hasValidCredentials(): boolean;
  send(message: EmailMessage): Promise<EmailResult>;
}

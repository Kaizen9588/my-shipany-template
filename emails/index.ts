import { EmailTemplate } from "@/lib/email/types";
import WelcomeEmail from "./templates/welcome";
import VerificationCodeEmail from "./templates/verification-code";
import PaymentSuccessEmail from "./templates/payment-success";
import CreditLowEmail from "./templates/credit-low";
import CreditExhaustedEmail from "./templates/credit-exhausted";

/**
 * 模板注册表（docs/10 §3.2）
 * template -> subject + component 映射；subject 支持 {var} 插值。
 */
const TEMPLATES = {
  welcome: { subject: "Welcome to {project}!", component: WelcomeEmail },
  verification_code: {
    subject: "Your verification code",
    component: VerificationCodeEmail,
  },
  payment_success: {
    subject: "Payment received",
    component: PaymentSuccessEmail,
  },
  credit_low: {
    subject: "Your credits are running low",
    component: CreditLowEmail,
  },
  credit_exhausted: {
    subject: "Your credits are exhausted",
    component: CreditExhaustedEmail,
  },
} as const;

export function getTemplateComponent(template: EmailTemplate) {
  const t = TEMPLATES[template as keyof typeof TEMPLATES];
  return t ? t.component : WelcomeEmail;
}

export function getTemplateSubject(
  template: EmailTemplate,
  variables: Record<string, string | number>
): string {
  const t = TEMPLATES[template as keyof typeof TEMPLATES];
  const subject = t ? t.subject : "Notification";
  return subject.replace(/\{(\w+)\}/g, (_, key: string) =>
    variables[key] !== undefined ? String(variables[key]) : ""
  );
}

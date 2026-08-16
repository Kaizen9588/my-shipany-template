import { Resend } from "resend";
import { render } from "@react-email/render";
import { EmailMessage, EmailProvider, EmailResult } from "../types";
import { getTemplateSubject, getTemplateComponent } from "@/emails";

/**
 * Resend Provider（6.2，docs/10 §2.2）
 * 换邮件服务商（AWS SES / Postmark）只改这一个文件。
 */
export const resendProvider: EmailProvider = {
  id: "resend",
  hasValidCredentials() {
    return Boolean(process.env.RESEND_API_KEY);
  },
  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const Component = getTemplateComponent(message.template);
      const subject = getTemplateSubject(
        message.template,
        message.variables
      );

      const html = await render(
        Component({ variables: message.variables }),
        { pretty: true }
      );

      const { data, error } = await resend.emails.send({
        from:
          process.env.EMAIL_FROM ||
          `ShipAny <onboarding@resend.dev>`,
        to: [message.to],
        subject,
        html,
      });

      if (error) {
        console.error("[email] resend send failed:", error.message);
        return { id: "", status: "failed", error: error.message };
      }

      return { id: data?.id || "", status: "sent" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[email] resend send error:", msg);
      return { id: "", status: "failed", error: msg };
    }
  },
};

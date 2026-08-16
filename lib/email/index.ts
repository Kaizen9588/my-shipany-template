import { EmailMessage, EmailProvider, EmailResult } from "./types";
import { resendProvider } from "./providers/resend";

/**
 * 统一邮件入口（6.2，docs/10 §2.3）
 *
 * 业务代码只调 sendEmail / fireAndForgetEmail，不感知 provider。
 *
 * ⚠️ 事务性邮件必须 **fire-and-forget**（void sendEmail(...)）：
 * 严禁同步 await 拖慢登录/支付主流程，发送失败不阻塞主流程。
 */
const providers: EmailProvider[] = [resendProvider];

function getEnabledProvider(): EmailProvider | undefined {
  return providers.find((p) => p.hasValidCredentials());
}

export async function sendEmail(
  message: EmailMessage
): Promise<EmailResult> {
  const provider = getEnabledProvider();
  if (!provider) {
    console.error(
      "[email] provider not configured, skip:",
      message.template
    );
    return { id: "", status: "failed", error: "no provider" };
  }

  return provider.send(message);
}

/**
 * Fire-and-forget 发送：不 await、错误在内部消化，绝不阻塞主流程。
 */
export function fireAndForgetEmail(message: EmailMessage): void {
  void sendEmail(message).catch((e) => {
    console.error("[email] fire-and-forget failed:", message.template, e);
  });
}

// 简单节流：同 key 同一天只发一次（如 credit_low，避免每次扣费都发）
// v1 内存级实现；多实例部署可能重复发送，可接受（docs/10 §4.1）
const lastSentAt = new Map<string, string>(); // key -> YYYY-MM-DD

export function shouldSendToday(key: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (lastSentAt.get(key) === today) {
    return false;
  }
  lastSentAt.set(key, today);
  return true;
}

import { respData, respErr } from "@/lib/resp";
import { createVerificationCode } from "@/models/verification";
import { findUserByEmail } from "@/models/user";
import { fireAndForgetEmail } from "@/lib/email";
import { getClientIp } from "@/lib/ip";
import { rateLimit, rateLimitByIp } from "@/lib/ratelimit";

/**
 * POST /api/send-verification —— 发送邮箱验证码（6.4）
 *
 * 请求：{ email, purpose?: "register" | "reset" }（默认 register）
 * - S2 防刷：每邮箱 60s 冷却 + 每邮箱每日 10 次上限 + 每 IP 30 次/分钟
 *   （冷却走统一限流（Upstash 可用时跨实例），每日上限为内存级降级）
 * - register：邮箱已被 credentials 注册 → 400
 * - 配置了 Resend → 发邮件；未配置 → 仅开发环境返回 code（生产拒绝，防误配泄露）
 */
export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rl = rateLimitByIp(ip, 30);
    if (!rl.ok) {
      return respErr("too many requests", 429);
    }

    const { email, purpose } = await req.json();
    if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return respErr("invalid email");
    }

    const emailLower = email.trim().toLowerCase();
    const purposeValue = purpose === "reset" ? "reset" : "register";

    // S2：每邮箱 60s 冷却（此前只有注释没有实现，可对任意邮箱无限发信）
    const cooldown = await rateLimit(`sendcode:cooldown:${emailLower}`, 1);
    if (!cooldown.ok) {
      return respErr("please wait 60s before requesting another code", 429);
    }
    // S2：每邮箱每日上限（内存级，多实例下为近似值）
    const daily = rateLimitByIp(
      `sendcode:daily:${emailLower}`,
      10,
      24 * 60 * 60 * 1000
    );
    if (!daily.ok) {
      return respErr("daily verification email limit reached", 429);
    }

    // register：邮箱已被 credentials 用户注册 → 拒绝（避免覆盖已有密码账号）
    if (purposeValue === "register") {
      const exist = await findUserByEmail(emailLower, "credentials");
      if (exist?.password_hash) {
        return respErr("email already registered");
      }
    }

    const code = await createVerificationCode(emailLower);

    // 已配置 Resend → 发邮件；否则仅开发环境降级返回 code（生产误配即任意邮箱接管）
    if (process.env.RESEND_API_KEY) {
      fireAndForgetEmail({
        to: emailLower,
        template: "verification_code",
        variables: { code, purpose: purposeValue },
        category: "transactional",
      });
      return respData({ sent: true });
    }

    if (process.env.NODE_ENV === "production") {
      console.error("[send-verification] RESEND_API_KEY not configured in production");
      return respErr("email service not configured");
    }

    console.warn("[send-verification] RESEND_API_KEY not configured, returning code in response (dev only)");
    return respData({ sent: false, code });
  } catch (e) {
    console.error("[send-verification] failed:", e);
    return respErr("send verification failed");
  }
}

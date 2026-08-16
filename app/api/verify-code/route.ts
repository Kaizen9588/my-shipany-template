import { respData, respErr } from "@/lib/resp";
import {
  CreditsAmount,
  CreditsTransType,
  increaseCredits,
} from "@/services/credit";
import { consumeVerificationCode } from "@/models/verification";
import { findUserByEmail, insertUser } from "@/models/user";
import { getIsoTimestr, getOneYearLaterTimestr } from "@/lib/time";
import { getUuid } from "@/lib/hash";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { getSupabaseClient } from "@/models/db";
import { getClientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/ratelimit";

import { User } from "@/types/user";

/**
 * POST /api/verify-code —— 校验验证码（6.4）
 *
 * mode=register：注册 —— 原子消费验证码 + 强度校验 + 写入 password_hash + 赠新手积分
 * mode=reset：密码重置 —— 原子消费验证码 + 更新 password_hash
 *
 * S2 防爆破：6 位码 10 分钟有效，本接口必须限流——
 * 每邮箱 5 次/分钟 + 每 IP 20 次/分钟，超限 429（mode=reset 爆破即可接管任意账号）
 *
 * 请求：{ email, code, password, mode?: "register" | "reset" }
 */
export async function POST(req: Request) {
  try {
    const { email, code, password, mode } = await req.json();
    if (!email || !code || !password) {
      return respErr("invalid params");
    }

    const emailLower = String(email).trim().toLowerCase();

    // S2：按邮箱 + 按 IP 双维度限流（防验证码爆破）
    const ip = await getClientIp();
    const emailRl = await rateLimit(`verify:email:${emailLower}`, 5);
    if (!emailRl.ok) {
      return respErr("too many attempts, please try later", 429);
    }
    const ipRl = await rateLimit(`verify:ip:${ip}`, 20);
    if (!ipRl.ok) {
      return respErr("too many attempts, please try later", 429);
    }

    const modeValue = mode === "reset" ? "reset" : "register";

    // 密码强度（前端 zod + 后端二次校验）
    const strengthError = validatePasswordStrength(String(password));
    if (strengthError) {
      return respErr(strengthError);
    }

    // 原子消费验证码（防一码多用）
    const consumed = await consumeVerificationCode(emailLower, String(code));
    if (!consumed) {
      return respErr("invalid or expired verification code");
    }

    const passwordHash = await hashPassword(String(password));
    const supabase = getSupabaseClient();

    const existUser = await findUserByEmail(emailLower, "credentials");

    if (modeValue === "register") {
      if (existUser?.password_hash) {
        return respErr("email already registered");
      }

      if (existUser) {
        // 已有记录（如 OAuth 注册过）→ 补密码
        await supabase
          .from("users")
          .update({
            password_hash: passwordHash,
            password_updated_at: getIsoTimestr(),
          })
          .eq("uuid", existUser.uuid);
        return respData({ registered: true });
      }

      // 新用户：写入 users + 赠新手积分（验证后才赠送，docs/14 §3.1）
      const user: User = {
        uuid: getUuid(),
        email: emailLower,
        nickname: emailLower.split("@")[0],
        avatar_url: "",
        signin_type: "credentials",
        signin_provider: "credentials",
        created_at: getIsoTimestr(),
        password_hash: passwordHash,
        password_updated_at: getIsoTimestr(),
      };
      await insertUser(user);

      await increaseCredits({
        user_uuid: user.uuid || "",
        trans_type: CreditsTransType.NewUser,
        credits: CreditsAmount.NewUserGet,
        expired_at: getOneYearLaterTimestr(),
      });

      return respData({ registered: true });
    }

    // mode=reset：更新密码（用户必须已存在）
    if (!existUser) {
      return respErr("user not found");
    }
    await supabase
      .from("users")
      .update({
        password_hash: passwordHash,
        password_updated_at: getIsoTimestr(),
      })
      .eq("uuid", existUser.uuid);

    return respData({ reset: true });
  } catch (e) {
    console.error("[verify-code] failed:", e);
    return respErr("verify code failed");
  }
}

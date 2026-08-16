import { getSupabaseClient } from "@/models/db";
import { getNonceStr, hashString } from "@/lib/hash";

/**
 * 邮箱验证码模型（6.4）
 * 注册验证与密码重置复用 verification_codes 表。
 *
 * 2.15 修复：code 只存 SHA-256 哈希（与 API key 同款处理）。
 * 此前明文入库，DB/备份泄漏即可读出未使用验证码接管任意邮箱账号。
 * 过期与单次使用的约束不变；明文 code 只在生成瞬间返回给发件流程。
 */

export interface VerificationCode {
  id: number;
  email: string;
  /** SHA-256(code)，绝不存明文 */
  code: string;
  expired_at: string;
  used: boolean;
  created_at: string;
}

/** 生成 6 位数字验证码 */
export function generateCode(): string {
  return getNonceStr(6).replace(/[^0-9]/g, "").slice(0, 6) || "000000";
}

/** 创建验证码（10 分钟有效），返回明文（仅用于发送邮件） */
export async function createVerificationCode(
  email: string,
  ttlMinutes: number = 10
): Promise<string> {
  const code = generateCode();
  const expiredAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("verification_codes").insert({
    email,
    code: hashString(code),
    expired_at: expiredAt,
    used: false,
  });

  if (error) {
    throw error;
  }

  return code;
}

/**
 * 原子消费验证码（6.4 并发安全）：
 * 按哈希等值查找 -> UPDATE ... WHERE id=? AND used=false 原子标记，
 * 检查影响行数，防止一码多用。
 */
export async function consumeVerificationCode(
  email: string,
  code: string
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("verification_codes")
    .select("id")
    .eq("email", email)
    .eq("code", hashString(code))
    .eq("used", false)
    .gt("expired_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return false;
  }

  // 原子标记 used=true（仅当仍为未使用状态）
  const { error: updateError, count } = await supabase
    .from("verification_codes")
    .update({ used: true })
    .eq("id", data.id)
    .eq("used", false)
    .select("id");

  if (updateError || !count || count === 0) {
    return false;
  }

  return true;
}

/**
 * 清理过期验证码（2.15）：删除过期超过 1 天的记录。
 * used=true 的记录同样删除（其价值只在过期前，历史统计不依赖此表）。
 */
export async function cleanupVerificationCodes(): Promise<number> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("verification_codes")
    .delete()
    .lt("expired_at", cutoff)
    .select("id");

  if (error) {
    console.error("[verification] cleanup failed:", error.message);
    return 0;
  }
  return data?.length || 0;
}

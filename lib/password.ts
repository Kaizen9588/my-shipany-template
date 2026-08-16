import bcrypt from "bcryptjs";

/**
 * 密码安全工具（6.4，DEVELOPMENT_PLAN §6.4 密码安全设计）
 * - bcrypt 哈希存储，绝不存明文
 * - 成本因子来自 BCRYPT_SALT_ROUNDS（默认 12）
 * - 密码强度：最少 8 位，包含字母 + 数字
 */

export function getSaltRounds(): number {
  const rounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);
  return rounds > 0 ? rounds : 12;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, getSaltRounds());
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** 密码强度校验（前端 zod + 后端二次校验一致） */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return "password must be at least 8 characters";
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "password must contain both letters and numbers";
  }
  return null;
}

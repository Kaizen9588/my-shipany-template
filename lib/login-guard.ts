/**
 * 登录失败锁定（6.4 密码安全设计）
 *
 * - 同一邮箱 5 次失败后锁定 15 分钟
 * - 同一 IP 10 次失败后封禁 1 小时
 *
 * v1 内存级实现（单实例有效）；多实例部署需共享存储（Redis/DB），
 * 与 6.18 限流同一升级路径。
 */
interface FailEntry {
  fails: number;
  lockedUntil: number;
}

const emailFails = new Map<string, FailEntry>();
const ipFails = new Map<string, FailEntry>();

const EMAIL_MAX_FAILS = 5;
const EMAIL_LOCK_MS = 15 * 60 * 1000;
const IP_MAX_FAILS = 10;
const IP_LOCK_MS = 60 * 60 * 1000;

export function isLoginLocked(
  email: string,
  ip: string
): { locked: boolean; retryAfterSeconds?: number } {
  const now = Date.now();

  const emailEntry = emailFails.get(email);
  if (emailEntry && emailEntry.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((emailEntry.lockedUntil - now) / 1000),
    };
  }

  const ipEntry = ipFails.get(ip);
  if (ipEntry && ipEntry.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((ipEntry.lockedUntil - now) / 1000),
    };
  }

  return { locked: false };
}

export function recordLoginFailure(email: string, ip: string): void {
  const now = Date.now();

  // 邮箱维度：已锁定则忽略；否则累计失败次数
  const emailEntry = emailFails.get(email);
  if (emailEntry && emailEntry.lockedUntil > now) {
    return;
  }
  if (!emailEntry) {
    emailFails.set(email, { fails: 1, lockedUntil: 0 });
  } else {
    emailEntry.fails += 1;
    if (emailEntry.fails >= EMAIL_MAX_FAILS) {
      emailEntry.lockedUntil = now + EMAIL_LOCK_MS;
      emailEntry.fails = 0;
    }
  }

  // IP 维度：同上
  const ipEntry = ipFails.get(ip);
  if (ipEntry && ipEntry.lockedUntil > now) {
    return;
  }
  if (!ipEntry) {
    ipFails.set(ip, { fails: 1, lockedUntil: 0 });
  } else {
    ipEntry.fails += 1;
    if (ipEntry.fails >= IP_MAX_FAILS) {
      ipEntry.lockedUntil = now + IP_LOCK_MS;
      ipEntry.fails = 0;
    }
  }
}

export function clearLoginFailure(email: string, ip: string): void {
  emailFails.delete(email);
  ipFails.delete(ip);
}

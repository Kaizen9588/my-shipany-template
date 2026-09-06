/**
 * 登录失败锁定（6.4 密码安全设计）
 *
 * - 同一邮箱 5 次失败后锁定 15 分钟
 * - 同一 IP 10 次失败后封禁 1 小时
 *
 * v1 内存级实现（单实例有效）；多实例部署需共享存储（Redis/DB），
 * 与 6.18 限流同一升级路径。
 */
import { recordOpEvent } from "@/lib/oplog";

/** 日志脱敏：只保留首字符（与 auth/config.ts 同口径），避免明文邮箱进事件详情 */
function maskEmailLocal(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

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
      // docs/16 §5 发射点：auth.login_failed_burst（锁定时刻发一次，锁定期间不重复）
      recordOpEvent({
        event_type: "auth.login_failed_burst",
        severity: "warn",
        source: "app",
        detail: {
          scope: "email",
          email: maskEmailLocal(email),
          fails: EMAIL_MAX_FAILS,
          lock_minutes: EMAIL_LOCK_MS / 60000,
        },
      });
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
      recordOpEvent({
        event_type: "auth.login_failed_burst",
        severity: "warn",
        source: "app",
        detail: {
          scope: "ip",
          ip_prefix: ip.split(".").slice(0, 2).join(".") + ".*",
          fails: IP_MAX_FAILS,
          lock_minutes: IP_LOCK_MS / 60000,
        },
      });
    }
  }
}

export function clearLoginFailure(email: string, ip: string): void {
  emailFails.delete(email);
  ipFails.delete(ip);
}

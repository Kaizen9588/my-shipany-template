import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * 统一限流（6.18，docs/DEVELOPMENT_PLAN 6.18）
 *
 * - 配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 后自动启用 Upstash
 *   （Redis-based，Serverless 友好，多实例共享）
 * - 未配置时降级为内存实现（单实例有效，P0 网关已用）
 * - 用户维度配额：免费用户 10 次/天，付费用户 100 次/天（按积分是否 >0 判断）
 */

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
}

// ---------- 内存实现（降级） ----------
const WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 30;

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

export function rateLimitByIp(
  ip: string,
  max: number = DEFAULT_MAX,
  windowMs: number = WINDOW_MS
): RateLimitResult {
  const now = Date.now();
  const entry = windows.get(ip);

  if (!entry || entry.resetAt <= now) {
    windows.set(ip, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }

  entry.count += 1;
  if (entry.count > max) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  return { ok: true, remaining: max - entry.count };
}

// ---------- Upstash 实现 ----------
// S2：按 max 缓存实例（Ratelimit 构造时固定窗口大小，此前 max 参数在
// Upstash 路径被忽略、一律按 DEFAULT_MAX 限流，导致更严格的限制不生效）
const upstashLimiters = new Map<number, Ratelimit>();

function getUpstash(max: number = DEFAULT_MAX): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  let limiter = upstashLimiters.get(max);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(max, "60 s"),
    });
    upstashLimiters.set(max, limiter);
  }
  return limiter;
}

/** 统一限流入口：Upstash 配置时用 Upstash，否则内存降级 */
export async function rateLimit(
  identifier: string,
  max: number = DEFAULT_MAX
): Promise<RateLimitResult> {
  // 修复：必须把 max 传给 getUpstash，否则 Upstash 路径一直用 DEFAULT_MAX=30，
  // 调用方更严格的限制（如验证码 5 次/分）在 Upstash 下失效（docs/12 S2 半成品）
  const up = getUpstash(max);
  if (up) {
    try {
      const res = await up.limit(identifier);
      return {
        ok: res.success,
        remaining: res.remaining,
        retryAfterSeconds: res.success
          ? undefined
          : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
      };
    } catch (e) {
      console.error("[ratelimit] upstash failed, fallback memory:", e);
      return rateLimitByIp(identifier, max);
    }
  }
  return rateLimitByIp(identifier, max);
}

// ---------- 用户维度分级配额（6.18 策略） ----------
export const USER_QUOTA = {
  FREE_DAILY: 10, // 免费用户 10 次/天
  PRO_DAILY: 100, // 付费用户 100 次/天
};

let upstashDailyLimiters = new Map<number, Ratelimit>();

function getUpstashDaily(max: number): Ratelimit | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  // 修复：按 max 分实例——此前固定 FREE_DAILY(10)/天，isPro 算出的 100 次/天上限从未生效
  let limiter = upstashDailyLimiters.get(max);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(max, "1 d"),
    });
    upstashDailyLimiters.set(max, limiter);
  }
  return limiter;
}

/**
 * 按用户分级限流：isPro（有积分余额）→ 100 次/天，否则 10 次/天。
 * 仅 Upstash 配置时有效；内存降级不做跨实例日配额（IP 限流兜底）。
 */
export async function rateLimitUser(
  user_uuid: string,
  isPro: boolean
): Promise<RateLimitResult> {
  const max = isPro ? USER_QUOTA.PRO_DAILY : USER_QUOTA.FREE_DAILY;
  const up = getUpstashDaily(max);
  if (up) {
    try {
      const res = await up.limit(user_uuid);
      return {
        ok: res.success,
        remaining: res.remaining,
        retryAfterSeconds: res.success
          ? undefined
          : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
      };
    } catch (e) {
      console.error("[ratelimit] upstash daily failed:", e);
    }
  }
  return { ok: true };
}

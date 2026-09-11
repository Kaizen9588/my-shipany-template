/**
 * 错误上报纯逻辑（docs/16 v2）：客户端 reporter 与服务端端点共用。
 *
 * - computeFingerprint：message + 堆栈首行 → 短稳定指纹（同因错误聚合去重的 key）
 * - createFingerprintThrottle：按指纹节流（同指纹窗口内只放行一次），
 *   条目数硬上限防内存膨胀——防泄漏纪律同 lib/ratelimit.ts
 * - isReportableClientError：过滤跨域 "Script error." 与良性浏览器噪音
 * - parseClientErrorPayload：上报端点请求体校验（字段类型/长度收口）
 *
 * 全部纯函数/可注入 now()，vitest node 环境直接覆盖（__tests__/error-report.test.ts）。
 */

export const FINGERPRINT_THROTTLE_MS = 60_000;
export const FINGERPRINT_MAX_ENTRIES = 500;

export const CLIENT_ERROR_BODY_LIMIT = 16 * 1024;
export const CLIENT_ERROR_MESSAGE_MAX = 500;
export const CLIENT_ERROR_STACK_MAX = 4_000;
export const CLIENT_ERROR_URL_MAX = 1_000;

/** 稳定短指纹：djb2(message + 堆栈首个有意义的帧)，避免长堆栈撑大事件 detail */
export function computeFingerprint(message: string, stack?: string): string {
  const firstFrame = (stack || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || /@|:\d+:\d+/.test(line));
  const raw = `${message}::${firstFrame || "no-stack"}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 是否值得上报的客户端错误。浏览器会把跨域脚本的错误脱敏成 "Script error."，
 * 插件注入/布局抖动（ResizeObserver loop）也是常见噪音——过滤掉防告警刷屏。
 */
export function isReportableClientError(message: string): boolean {
  const m = (message || "").trim();
  if (!m) return false;
  if (/^script error/i.test(m)) return false;
  if (/^resizeobserver loop/i.test(m)) return false;
  return true;
}

export interface FingerprintThrottle {
  /** 同指纹 intervalMs 内只放行一次；返回 false 表示节流命中，调用方应静默丢弃 */
  allow(fingerprint: string): boolean;
}

export function createFingerprintThrottle(options?: {
  intervalMs?: number;
  maxEntries?: number;
  now?: () => number;
}): FingerprintThrottle {
  const intervalMs = options?.intervalMs ?? FINGERPRINT_THROTTLE_MS;
  const maxEntries = options?.maxEntries ?? FINGERPRINT_MAX_ENTRIES;
  const now = options?.now ?? Date.now;
  const lastSeen = new Map<string, number>();

  return {
    allow(fingerprint: string): boolean {
      const t = now();
      // 惰性清理：达上限先丢过期项，仍超限按插入序丢最老项
      if (lastSeen.size >= maxEntries) {
        for (const [k, ts] of lastSeen) {
          if (t - ts >= intervalMs) lastSeen.delete(k);
        }
        while (lastSeen.size >= maxEntries) {
          const oldest = lastSeen.keys().next().value;
          if (oldest === undefined) break;
          lastSeen.delete(oldest);
        }
      }
      const last = lastSeen.get(fingerprint);
      if (last !== undefined && t - last < intervalMs) {
        return false;
      }
      lastSeen.set(fingerprint, t);
      return true;
    },
  };
}

export type ClientErrorKind = "error" | "unhandledrejection";

export interface ClientErrorPayload {
  kind: ClientErrorKind;
  message: string;
  stack: string;
  url: string;
  fingerprint: string;
}

export function parseClientErrorPayload(
  body: unknown
): { ok: true; value: ClientErrorPayload } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "invalid body" };
  }
  const b = body as Record<string, unknown>;
  const kind: ClientErrorKind =
    b.kind === "unhandledrejection" ? "unhandledrejection" : "error";
  const message =
    typeof b.message === "string" ? b.message.slice(0, CLIENT_ERROR_MESSAGE_MAX) : "";
  const stack =
    typeof b.stack === "string" ? b.stack.slice(0, CLIENT_ERROR_STACK_MAX) : "";
  const url =
    typeof b.url === "string" ? b.url.slice(0, CLIENT_ERROR_URL_MAX) : "";

  // 不可上报（噪音/空消息）不算校验失败：端点按 204 静默吞掉，客户端无感
  if (!isReportableClientError(message)) {
    return { ok: false, reason: "unreportable" };
  }

  return {
    ok: true,
    value: {
      kind,
      message,
      stack,
      url,
      fingerprint: computeFingerprint(message, stack),
    },
  };
}

import { respErr } from "@/lib/resp";
import { getClientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/ratelimit";

/**
 * 运维只读指标接口的鉴权 + 限流守卫（server-only）
 *
 * 供 /api/metrics 与 /api/metrics/events 共用。这两端点是对外暴露的只读数据源，
 * 供「飞书多维表格数据接入 / 定时脚本 / 后台看板」拉取。因可被公网访问：
 *  1. 鉴权：唯一门禁是 METRICS_ACCESS_SECRET（长随机串，见下）；
 *     请求须带 `Authorization: Bearer <KEY>`，比对用常数时间（不泄露长度差异）。
 *  2. 限流：防滥刷。按固定全局窗口限制总调用（不依赖 IP，避免 TRUSTED_PROXY=none
 *     下 getClientIp 恒为 127.0.0.1 使单 IP 限流失效）；同时尽力做单 IP 限流。
 *  3. 只读无副作用：仅 GET 聚合，不外发任何请求。
 *
 * 安全边界（与 Mimosa/AGENTS 一致）：
 *  - METRICS_ACCESS_SECRET 只从环境变量读，源码/示例/日志不含真实值；
 *  - 生产未配置密钥时直接拒绝（fail fast，暴露部署缺陷，不静默放行）；
 *  - 本模块不做任何出网请求，不涉及 URL 校验。
 */

/** 每个密钥窗口（默认 1 分钟）内最大请求数 */
const GLOBAL_MAX_PER_WINDOW = 60;
/** 单 IP 每窗口最大请求数（尽力而为；TRUSTED_PROXY=none 时按聚合生效） */
const IP_MAX_PER_WINDOW = 20;

/** 常数时间字符串比较，避免长度/前缀侧信道 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 校验运维只读接口的访问。通过返回 null；否则返回要直接 send 的 Response。
 */
export async function metricsGuard(req: Request) {
  const secret = process.env.METRICS_ACCESS_SECRET;
  // 生产未配密钥：拒绝，暴露部署缺陷
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[metrics] METRICS_ACCESS_SECRET is not set; refusing");
      return respErr("not configured", 500);
    }
    // 本地开发允许无密钥便捷调试
    return null;
  }

  // 鉴权
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, secret)) {
    return respErr("unauthorized", 401);
  }

  // 限流：全局窗口（主）+ 单 IP（尽力）
  const global = await rateLimit("metrics:global", GLOBAL_MAX_PER_WINDOW);
  if (!global.ok) {
    return respErr("too many requests", 429);
  }
  const ip = await getClientIp();
  const perIp = await rateLimit(`metrics:ip:${ip}`, IP_MAX_PER_WINDOW);
  if (!perIp.ok) {
    return respErr("too many requests", 429);
  }

  return null;
}
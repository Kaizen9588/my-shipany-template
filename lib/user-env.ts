import { headers } from "next/headers";

/**
 * 用户画像采集（0037，管理员后台展示用）
 *
 * - 设备：解析 User-Agent 为「类型 · OS」短语（不存原始 UA，数据最小化）
 * - 国家：只信任部署平台覆写的国别头，与 lib/ip.ts 的 TRUSTED_PROXY 同一口径——
 *   默认 TRUSTED_PROXY=none 时不信任任何客户端可伪造的头，返回空（展示为未知）
 * - 采集时刻 = 登录/注册（jwt 回调 account 分支，仅真正登录时触发），
 *   会话刷新不更新；国家随每次登录刷新（用户换地区/VPN 场景）
 */

export function parseUserAgent(ua: string): string {
  const s = (ua || "").trim();
  if (!s) {
    return "未知";
  }
  if (/bot|crawler|spider|curl|wget|axios|python-requests|postman|node-fetch/i.test(s)) {
    return "程序";
  }
  if (/iPhone|iPod/i.test(s)) {
    return "手机 · iOS";
  }
  if (/iPad/i.test(s)) {
    return "平板 · iPadOS";
  }
  if (/Android/i.test(s)) {
    return /Mobile/i.test(s) ? "手机 · Android" : "平板 · Android";
  }
  if (/Windows/i.test(s)) {
    return "电脑 · Windows";
  }
  if (/Macintosh|Mac OS X/i.test(s)) {
    return "电脑 · macOS";
  }
  if (/Linux|X11/i.test(s)) {
    return "电脑 · Linux";
  }
  return "未知";
}

/** ISO 3166-1 alpha-2 → 「ES · 西班牙」样式；非法/缺失码展示为未知 */
export function formatCountry(code: string): string {
  const c = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) {
    return "未知";
  }
  try {
    const name = new Intl.DisplayNames(["zh"], { type: "region" }).of(c);
    return name && name !== c ? `${c} · ${name}` : c;
  } catch {
    return c;
  }
}

export async function getLoginEnv(): Promise<{
  device: string;
  country: string;
}> {
  const h = await headers();
  const device = parseUserAgent(h.get("user-agent") || "");

  const trusted = (process.env.TRUSTED_PROXY || "none").toLowerCase();
  let country = "";
  if (trusted === "vercel") {
    country = (h.get("x-vercel-ip-country") || "").trim();
  } else if (trusted === "cloudflare") {
    country = (h.get("cf-ipcountry") || "").trim();
  }
  // CF 对未知来源/Tor 的占位码不当真实国家
  if (["XX", "T1", "AA"].includes(country.toUpperCase())) {
    country = "";
  }

  return { device, country };
}

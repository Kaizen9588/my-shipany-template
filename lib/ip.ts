"use server";

import { headers } from "next/headers";

// S1 IP 信任收敛（2026-08 架构审查）：
// 原实现按 cf-connecting-ip > x-real-ip > x-forwarded-for 逐个取值，
// 但 Vercel 只覆写 x-forwarded-for——其余头客户端可随意伪造，
// 所有 IP 限流（发码 / demo / 登录锁）在非 Cloudflare 部署下形同虚设。
//
// 现按 TRUSTED_PROXY 声明的部署拓扑，只信任平台覆写的头：
// - cloudflare：仅 cf-connecting-ip（CF 覆写并剥离客户端值；绕过 CF 直连源站
//   的流量头不可信，返回 127.0.0.1--如需彻底防护应将源站防火墙限到 CF 网段）
// - vercel：仅 x-forwarded-for 第一跳（Vercel 覆写整个头）
// - none（默认，第五轮 2.16）：不信任任何代理头，返回 socket 直连地址。
//   默认从 "vercel" 收敛为 "none"：Vercel 部署显式声明即可恢复，
//   而 Docker/自托管误用 "vercel" 时自建 nginx 只 append 不覆写代理头，
//   攻击者可逐请求伪造 X-Forwarded-For 绕过全部 IP 限流
const TRUSTED_PROXY = (process.env.TRUSTED_PROXY || "none").toLowerCase();

export async function getClientIp(): Promise<string> {
  const h = await headers();

  if (TRUSTED_PROXY === "cloudflare") {
    return (h.get("cf-connecting-ip") || "").trim() || "127.0.0.1";
  }

  if (TRUSTED_PROXY === "vercel") {
    // 仅当部署在 Vercel（平台覆写整个头）时首跳才是真实客户端
    const first = (h.get("x-forwarded-for") || "").split(",")[0].trim();
    return first || "127.0.0.1";
  }

  // none / 其他：不信任任何可伪造头，直连地址（反代后将是代理 IP，
  // 限流按代理聚合--保守但不会被伪造绕过）
  return "127.0.0.1";
}

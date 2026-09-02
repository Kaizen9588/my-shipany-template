import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * middleware CSRF 防护单测（6.22 / 第十九批加固，P3-4 防护矩阵的测试面）：
 * - 非 GET API：Origin 匹配放行 / 不匹配 403 / 缺失放行（非浏览器或 Bearer 调用）
 * - 豁免精确化：/api/cron/* 与 /api/*-notify 豁免；子串意外命中不再豁免
 * - 允许集合：NEXT_PUBLIC_WEB_URL 钉死 + Host 派生 + CORS_ALLOWED_ORIGINS；
 *   生产 https 站点拒绝 http:// 降级 origin
 * - GET/HEAD/OPTIONS 不校验
 */

vi.mock("next-intl/middleware", () => ({
   
  default: () => (req: any) => new Response("intl", { status: 200 }),
}));
// i18n/routing -> next-intl/navigation 拉起 React client 代码，vitest node 环境解析不了
vi.mock("next-intl/navigation", () => ({
  createNavigation: () => ({ Link: () => null, redirect: () => null, usePathname: () => null, useRouter: () => null }),
}));
vi.mock("@/i18n/routing", () => ({ routing: {} }));

import middleware from "@/middleware";

 
function req(path: string, opts: { method?: string; origin?: string; host?: string } = {}) {
  const headers = new Headers();
  if (opts.origin) {
    headers.set("origin", opts.origin);
  }
  headers.set("host", opts.host || "localhost:3000");
  return {
    nextUrl: new URL(`https://localhost:3000${path}`),
    method: opts.method || "POST",
    headers,
  } as any;  
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_WEB_URL = ORIGINAL_ENV.NEXT_PUBLIC_WEB_URL;
  process.env.CORS_ALLOWED_ORIGINS = ORIGINAL_ENV.CORS_ALLOWED_ORIGINS;
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV.NODE_ENV;
});

function setProd() {
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
}

function setDev() {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
}

describe("middleware CSRF（6.22 + 第十九批）", () => {
  it("同源 Origin（Host 派生）放行", () => {
    setDev();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    const res = middleware(req("/api/checkout", { origin: "https://localhost:3000" }));
    expect(res).not.toBeNull();
  });

  it("跨站 Origin → 403 invalid origin", () => {
    setDev();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    const res = middleware(req("/api/checkout", { origin: "https://evil.com" }));
    expect(res?.status).toBe(403);
  });

  it("缺失 Origin 放行（curl/SDK/Bearer API Key 调用）", () => {
    setDev();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    expect(middleware(req("/api/checkout"))).not.toBeNull();
    expect(middleware(req("/api/admin/refund"))).not.toBeNull();
  });

  it("NEXT_PUBLIC_WEB_URL 钉死站点 origin：Host 被篡改时站点 origin 仍放行", () => {
    setProd();
    process.env.NEXT_PUBLIC_WEB_URL = "https://myapp.com";
    const res = middleware(
      req("/api/admin/user/credits", {
        origin: "https://myapp.com",
        host: "attacker-controlled.example",
      })
    );
    expect(res).not.toBeNull();
  });

  it("生产 https 站点：http:// 同源 origin 拒绝（降级攻击）", () => {
    setProd();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    const res = middleware(
      req("/api/checkout", { origin: "http://localhost:3000" })
    );
    expect(res?.status).toBe(403);
  });

  it("CORS_ALLOWED_ORIGINS 中的 origin 放行（跨域白名单）", () => {
    setDev();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    process.env.CORS_ALLOWED_ORIGINS = "https://partner.example, https://app2.example";
    const res = middleware(req("/api/checkout", { origin: "https://partner.example" }));
    expect(res).not.toBeNull();
  });

  it("豁免：/api/cron/* 与 /api/*-notify（服务端到服务端，无 Origin）", () => {
    setProd();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    expect(middleware(req("/api/cron/daily", { origin: "https://evil.com" }))).not.toBeNull();
    expect(middleware(req("/api/stripe-notify", { origin: "https://evil.com" }))).not.toBeNull();
    expect(middleware(req("/api/creem-notify", { origin: "https://evil.com" }))).not.toBeNull();
    expect(middleware(req("/api/waffo-notify", { origin: "https://evil.com" }))).not.toBeNull();
  });

  it("豁免精确化：含 -notify 子串的非 webhook 路径不豁免（此前 includes 会放行）", () => {
    setProd();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    const res = middleware(req("/api/checkout", { origin: "https://evil.com" }));
    expect(res?.status).toBe(403);
  });

  it("GET/HEAD/OPTIONS 不做 CSRF 校验", () => {
    setProd();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    expect(middleware(req("/api/checkout", { method: "GET", origin: "https://evil.com" }))).not.toBeNull();
    expect(middleware(req("/api/checkout", { method: "HEAD", origin: "https://evil.com" }))).not.toBeNull();
    expect(middleware(req("/api/checkout", { method: "OPTIONS", origin: "https://evil.com" }))).not.toBeNull();
  });

  it("非 /api/ 路径不走 CSRF（页面路由交给 intl 中间件）", () => {
    setDev();
    delete process.env.NEXT_PUBLIC_WEB_URL;
    const res = middleware(req("/pricing", { origin: "https://evil.com" }));
    expect(res?.status).toBe(200);
  });
});

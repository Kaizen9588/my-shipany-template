import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const intlMiddleware = createMiddleware(routing);

// P-1.10：允许的跨域来源（逗号分隔），未配置时默认拒绝跨域
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// 站点自身 origin（lib/env 必填项）；middleware 运行在 edge，不能 import zod 校验，
// 只做存在性归一（去尾斜杠）。生产未配置时回退 Host 头派生（与旧行为一致但记日志）。
function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_WEB_URL || "";
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, "");
}

/** 6.22：webhook / cron 端点是服务端到服务端，无 cookie/Origin，必须排除 CSRF 校验 */
// 第十九批：精确匹配（后缀 / 前缀）取代子串匹配——此前 includes("-notify") 会让
// 任何路径名恰好含 "-notify" 的未来端点意外绕过 CSRF（fail-open）
function isCsrfExempt(pathname: string): boolean {
  if (pathname.startsWith("/api/cron/")) {
    return true;
  }
  return /^\/api\/[a-z0-9-]*-notify$/.test(pathname);
}

/**
 * CSRF 防护（6.22 / 第十九批加固）：
 * - 浏览器跨站 POST 必带 Origin；缺失 Origin = 非浏览器客户端（curl/SDK），
 *   或 Bearer API Key 调用（无 cookie 可被 CSRF，放行）
 * - 允许集合 = NEXT_PUBLIC_WEB_URL（站点 origin，钉死，不信客户端 Host 头）
 *   + 同源 Host 派生 + CORS_ALLOWED_ORIGINS
 * - https 站点上 http:// 同源 origin 视为降级攻击（HSTS 场景），拒绝
 * - Origin 存在但不在允许集合 → 403
 */
function checkCsrf(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return null;
  }
  if (isCsrfExempt(pathname)) {
    return null;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return null;
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    return null; // 非浏览器客户端 / Bearer API Key 调用（无 cookie CSRF 面）
  }

  const host = req.headers.get("host") || "";
  const allowed = new Set<string>(ALLOWED_ORIGINS);
  const site = siteOrigin();
  if (site) {
    allowed.add(site);
  }
  // 同源放行（浏览器同站请求的 Origin 与 Host 一致）
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== "production") {
      // http 同源仅限开发环境；生产 HSTS 站点不允许降级 origin
      allowed.add(`http://${host}`);
    } else if (site && site.startsWith("http://")) {
      // 显式 http 站点（如自托管未配 TLS）允许自己的 scheme
      allowed.add(site);
    }
  }

  if (!allowed.has(origin)) {
    return NextResponse.json(
      { code: -1, message: "invalid origin" },
      { status: 403 }
    );
  }

  return null;
}

export default function middleware(req: NextRequest) {
  // API 路由：CORS + CSRF 处理（P-1.10 / 6.22）
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const csrfBlock = checkCsrf(req);
    if (csrfBlock) {
      return csrfBlock;
    }

    const origin = req.headers.get("origin") || "";
    const allowOrigin =
      ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)
        ? origin
        : "";

    const res = NextResponse.next();
    if (allowOrigin) {
      res.headers.set("Access-Control-Allow-Origin", allowOrigin);
      res.headers.set("Vary", "Origin");
    }
    res.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    // 预检请求直接返回
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: res.headers });
    }

    return res;
  }

  return intlMiddleware(req);
}

export const config = {
  matcher: [
    "/",
    // P-1.6：只匹配实际支持的语言 en/zh，避免多余语言前缀进入中间件
    "/(en|zh)/:path*",
    // P-1.10：API 路由纳入中间件以附加 CORS 头
    "/(api)/:path*",
    "/((?!privacy-policy|terms-of-service|api/|_next|_vercel|.*\\..*).*)",
  ],
};

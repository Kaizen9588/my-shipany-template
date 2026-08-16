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

/** 6.22：webhook / cron 端点是服务端到服务端，无 cookie/Origin，必须排除 CSRF 校验 */
const CSRF_EXEMPT_PATHS = ["-notify", "/cron/"];

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((p) => pathname.includes(p));
}

/**
 * CSRF 防护（6.22）：非 GET API 校验 Origin
 * - 浏览器跨站 POST 必带 Origin；缺失 Origin = 非浏览器客户端（curl/SDK），放行
 * - Origin 存在但不在允许集合（同源 + CORS_ALLOWED_ORIGINS）→ 403
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
    return null; // 非浏览器客户端
  }

  const host = req.headers.get("host") || "";
  const allowed = new Set([
    `https://${host}`,
    `http://${host}`,
    ...ALLOWED_ORIGINS,
  ]);

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

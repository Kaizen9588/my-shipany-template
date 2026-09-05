import bundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import mdx from "@next/mdx";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withNextIntl = createNextIntlPlugin();

const withMDX = mdx({
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

// P-1.6：images 只允许已知域名（Google/GitHub 头像 + 配置的 S3 CDN），不再放通 *
function buildImageRemotePatterns() {
  const hosts = [
    "lh3.googleusercontent.com",
    "avatars.githubusercontent.com",
  ];

  const storageDomain = process.env.STORAGE_DOMAIN;
  if (storageDomain) {
    try {
      const hostname = new URL(storageDomain).hostname;
      if (hostname) {
        hosts.push(hostname);
      }
    } catch (e) {
      // 忽略非法 STORAGE_DOMAIN
    }
  }

  return hosts.map((hostname) => ({ protocol: "https", hostname }));
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // P-1.6：standalone 输出只用于 Docker（构建时 NEXT_OUTPUT=standalone），
  // 与 next start / Vercel 不再冲突
  output:
    process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
  // 隐藏开发模式左下角的 Next.js 指示器（N 圆圈），编译/运行错误仍会正常显示
  devIndicators: false,
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  images: {
    remotePatterns: buildImageRemotePatterns(),
  },
  async redirects() {
    return [];
  },
  // 专业 SaaS 模板：默认安全响应头（CSP 由部署平台按需追加）
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 2.18：支付站点必须 HSTS--首次访问后的浏览器强制 HTTPS，
          // 防止降级到 HTTP 的中间人替换支付跳转。max-age 180 天，先不带 preload
          // （域名确定长期 HTTPS 后再考虑提交 preload list）
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          // 2.18 / boundary-spec §三：CSP 基线（此前 HSTS 已有、CSP 待办）。
          // 取舍说明：
          // - script-src 保留 'unsafe-inline'/'unsafe-eval'（Next.js 注水与 dev HMR 必需；
          //   收紧到 nonce 需改 layout 渲染链，留给具体项目按需加固）
          // - connect-src 放行 https/wss（分析/客服/AI 供应商由环境变量决定，模板无法
          //   枚举；ws://localhost 仅 dev HMR 用）；真正的第三方脚本面由 script-src 收口
          // - object-src 'none' + base-uri/form-action 'self' + frame-ancestors 'none'
          //   是无副作用的强约束（与 X-Frame-Options: DENY 对齐）
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://www.googletagmanager.com https://*.posthog.com https://client.crisp.chat https://openpanel.dev https://js.stripe.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:*",
              "frame-src https://accounts.google.com https://*.google.com https://js.stripe.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

// Make sure experimental mdx flag is enabled
const configWithMDX = {
  ...nextConfig,
  experimental: {
    mdxRs: true,
  },
};

export default withBundleAnalyzer(withNextIntl(withMDX(configWithMDX)));

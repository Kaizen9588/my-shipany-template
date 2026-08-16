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

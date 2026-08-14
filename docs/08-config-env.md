# 配置与环境变量文档

## 1. 配置文件清单

| 文件 | 用途 |
|------|------|
| `next.config.mjs` | Next.js 核心配置 |
| `tailwind.config.ts` | Tailwind CSS 配置 |
| `postcss.config.mjs` | PostCSS 配置 |
| `tsconfig.json` | TypeScript 配置 |
| `components.json` | shadcn/ui 配置 |
| `middleware.ts` | next-intl 国际化中间件 |
| `vercel.json` | Vercel 部署配置 |
| `wrangler.toml.example` | Cloudflare Workers 配置模板 |
| `Dockerfile` | Docker 构建配置 |
| `.env.example` | 环境变量模板 |
| `.env.local` | 本地环境变量（不提交） |
| `pnpm-workspace.yaml` | pnpm 工作区配置 |

## 2. next.config.mjs 详解

```javascript
import bundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import mdx from "@next/mdx";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",  // ANALYZE=true 时启用包分析
});

const withNextIntl = createNextIntlPlugin();  // next-intl 插件

const withMDX = mdx({                         // MDX 支持
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

const nextConfig = {
  output: "standalone",         // 独立输出（Docker 友好）
  reactStrictMode: false,        // ⚠️ 关闭了严格模式
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  images: {
    remotePatterns: [{
      protocol: "https",
      hostname: "*",             // 允许所有 HTTPS 图片源
    }],
  },
  async redirects() {
    return [];                   // 无自定义重定向
  },
  experimental: {
    mdxRs: true,                 // MDX Rust 编译器（Turbopack）
  },
};

export default withBundleAnalyzer(withNextIntl(withMDX(configWithMDX)));
```

### 配置问题

| 项 | 当前值 | 建议 |
|----|--------|------|
| `reactStrictMode` | `false` | 建议改为 `true`（生产环境质量保障） |
| `images.hostname` | `"*"` | 安全风险，建议限制为已知域名 |
| `output: "standalone"` | 开启 | 与 `next start` 冲突，Vercel 部署可去掉 |

## 3. tailwind.config.ts

```typescript
// 关键配置
{
  darkMode: ["class"],           // 暗色模式通过 class 切换
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./i18n/**/*.{json}",
  ],
  theme: {
    extend: {
      colors: {
        // CSS 变量映射（支持亮/暗色切换）
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // ... 更多颜色变量
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

主题颜色定义在 `app/theme.css`，可通过 [shadcn-ui-theme-generator](https://zippystarter.com/tools/shadcn-ui-theme-generator) 生成。

## 4. middleware.ts

```typescript
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: [
    "/",
    "/(en|en-US|zh|zh-CN|zh-TW|zh-HK|zh-MO|ja|ko|ru|fr|de|ar|es|it)/:path*",
    "/((?!privacy-policy|terms-of-service|api/|_next|_vercel|.*\\..*).*)",
  ],
};
```

**匹配规则**：
- `/` - 首页
- `/(en|zh|...)/:path*` - 带语言前缀的路径
- 排除：`privacy-policy`、`terms-of-service`、`api/`、`_next`、`_vercel`、含点的路径（静态文件）

> ⚠️ 注意：matcher 中列出了 14 种语言，但 `i18n/locale.ts` 中 `locales` 只有 `["en", "zh"]`。其他语言前缀会被匹配但无翻译文件，会 fallback 到 en。

## 5. 环境变量完整清单

### 5.1 基础配置

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `NEXT_PUBLIC_WEB_URL` | ✅ | - | 网站 URL，如 `http://localhost:3000` |
| `NEXT_PUBLIC_PROJECT_NAME` | ✅ | - | 项目名称 |
| `NEXT_PUBLIC_DEFAULT_THEME` | ❌ | `light` | 默认主题：`light` / `dark` |
| `NEXT_PUBLIC_LOCALE_DETECTION` | ❌ | `false` | 是否自动检测浏览器语言 |
| `ADMIN_EMAILS` | ❌ | - | 管理员邮箱，逗号分隔 |

### 5.2 数据库 (Supabase)

| 变量 | 必填 | 说明 |
|------|------|------|
| `SUPABASE_URL` | ✅ | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase Service Role Key（绕过 RLS） |

> ⚠️ 代码中优先使用 `SUPABASE_SERVICE_ROLE_KEY`，仅在未设置时 fallback 到 `SUPABASE_ANON_KEY`。生产环境应谨慎使用 Service Role Key。

### 5.3 鉴权 (NextAuth)

| 变量 | 必填 | 说明 |
|------|------|------|
| `AUTH_SECRET` | ✅ | JWT 加密密钥（`openssl rand -base64 32`） |
| `AUTH_GOOGLE_ID` | ❌ | Google OAuth Client ID |
| `AUTH_GOOGLE_SECRET` | ❌ | Google OAuth Client Secret |
| `NEXT_PUBLIC_AUTH_GOOGLE_ID` | ❌ | Google OAuth Client ID（前端用） |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | ❌ | 启用 Google 登录：`true`/`false` |
| `NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED` | ❌ | 启用 One-Tap：`true`/`false` |
| `AUTH_GITHUB_ID` | ❌ | GitHub OAuth Client ID |
| `AUTH_GITHUB_SECRET` | ❌ | GitHub OAuth Client Secret |
| `NEXT_PUBLIC_AUTH_GITHUB_ENABLED` | ❌ | 启用 GitHub 登录：`true`/`false` |

### 5.4 支付 (Stripe)

| 变量 | 必填 | 说明 |
|------|------|------|
| `STRIPE_PUBLIC_KEY` | ❌ | Stripe 公钥（`pk_...`） |
| `STRIPE_PRIVATE_KEY` | ❌ | Stripe 私钥（`sk_...`） |
| `STRIPE_WEBHOOK_SECRET` | ❌ | Webhook 签名密钥（`whsec_...`） |
| `NEXT_PUBLIC_PAY_SUCCESS_URL` | ❌ | 支付成功跳转 URL |
| `NEXT_PUBLIC_PAY_FAIL_URL` | ❌ | 支付失败跳转 URL |
| `NEXT_PUBLIC_PAY_CANCEL_URL` | ❌ | 支付取消跳转 URL |

### 5.5 AI 模型

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | ❌ | OpenAI API Key |
| `DEEPSEEK_API_KEY` | ❌ | DeepSeek API Key |
| `OPENROUTER_API_KEY` | ❌ | OpenRouter API Key |
| `SILICONFLOW_API_KEY` | ❌ | 硅基流动 API Key |
| `SILICONFLOW_BASE_URL` | ❌ | 硅基流动 Base URL |
| `REPLICATE_API_TOKEN` | ❌ | Replicate API Token |
| `KLING_API_KEY` | ❌ | Kling API Key |
| `KLING_BASE_URL` | ❌ | Kling Base URL |

### 5.6 存储 (AWS S3)

| 变量 | 必填 | 说明 |
|------|------|------|
| `STORAGE_ENDPOINT` | ❌ | S3 端点 URL |
| `STORAGE_REGION` | ❌ | S3 区域（默认 `auto`） |
| `STORAGE_ACCESS_KEY` | ❌ | S3 Access Key |
| `STORAGE_SECRET_KEY` | ❌ | S3 Secret Key |
| `STORAGE_BUCKET` | ❌ | S3 Bucket 名称 |
| `STORAGE_DOMAIN` | ❌ | CDN 域名（用于拼接文件 URL） |

### 5.7 分析

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` | ❌ | Google Analytics ID（`G-XXXXXXX`） |
| `NEXT_PUBLIC_OPENPANEL_CLIENT_ID` | ❌ | OpenPanel Client ID |

### 5.8 待新增环境变量

| 变量 | 用途 | 阶段 |
|------|------|------|
| `CREEM_API_KEY` | Creem 支付 | P0 |
| `CREEM_WEBHOOK_SECRET` | Creem Webhook 验证 | P0 |
| `NEXT_PUBLIC_PAYMENT_PROVIDER` | 支付渠道选择 | P0 |
| `RESEND_API_KEY` | Resend 邮件发送 | P0 |
| `EMAIL_FROM` | 发件人地址 | P0 |
| `NEXT_PUBLIC_CRISP_WEBSITE_ID` | Crisp 客服 | P0 |
| `UPSTASH_REDIS_REST_URL` | 限流 Redis | P3 |
| `UPSTASH_REDIS_REST_TOKEN` | 限流 Redis Token | P3 |
| `SENTRY_DSN` | Sentry 错误监控 | P3 |

## 6. 环境变量配置检查清单

### 最小可运行配置（仅 Landing Page）

```
NEXT_PUBLIC_WEB_URL=http://localhost:3000
NEXT_PUBLIC_PROJECT_NAME=my-shipany-template
AUTH_SECRET=<openssl rand -base64 32>
```

> Supabase 未配置时，Landing Page 可正常显示，但登录/控制台/后台会报错。

### 完整开发配置

```
# 基础
NEXT_PUBLIC_WEB_URL=http://localhost:3000
NEXT_PUBLIC_PROJECT_NAME=my-shipany-template
NEXT_PUBLIC_DEFAULT_THEME=light
ADMIN_EMAILS=your-email@example.com

# 数据库
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 鉴权
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=xxx.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=xxx
NEXT_PUBLIC_AUTH_GOOGLE_ID=xxx.apps.googleusercontent.com
NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true
AUTH_GITHUB_ID=xxx
AUTH_GITHUB_SECRET=xxx
NEXT_PUBLIC_AUTH_GITHUB_ENABLED=true

# 支付
STRIPE_PUBLIC_KEY=pk_test_xxx
STRIPE_PRIVATE_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# 存储（可选）
STORAGE_ENDPOINT=https://xxx.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=xxx
STORAGE_SECRET_KEY=xxx
STORAGE_BUCKET=my-bucket
STORAGE_DOMAIN=https://cdn.example.com
```

## 7. i18n 配置

### 7.1 语言配置 (`i18n/locale.ts`)

```typescript
export const locales = ["en", "zh"];           // 支持的语言
export const defaultLocale = "en";              // 默认语言
export const localePrefix = "as-needed";        // 前缀策略
export const localeDetection = false;           // 不自动检测
```

### 7.2 添加新语言

1. 在 `locale.ts` 的 `locales` 数组中添加语言代码
2. 在 `localeNames` 中添加显示名称
3. 在 `i18n/messages/` 中添加 `{locale}.json`
4. 在 `i18n/pages/landing/` 中添加 `{locale}.json`
5. 在 `middleware.ts` 的 matcher 中添加语言代码

### 7.3 翻译文件结构

```
i18n/
├── messages/         # UI 文案翻译
│   ├── en.json       # 结构: { "metadata": {...}, "signin": {...}, "console": {...}, ... }
│   └── zh.json
└── pages/            # 页面内容配置
    └── landing/
        ├── en.json   # 结构: { "template": "...", "header": {...}, "hero": {...}, ... }
        └── zh.json
```

## 8. 构建脚本

| 脚本 | 命令 | 用途 |
|------|------|------|
| `dev` | `cross-env NODE_NO_WARNINGS=1 next dev --turbopack` | 开发服务器 |
| `build` | `next build` | 生产构建 |
| `start` | `NODE_NO_WARNINGS=1 next start` | 启动生产服务器 |
| `lint` | `next lint` | ESLint 检查 |
| `analyze` | `ANALYZE=true pnpm build` | 包体积分析 |
| `cf:build` | `npx @cloudflare/next-on-pages` | Cloudflare 构建 |
| `cf:preview` | `pnpm cf:build && wrangler pages dev` | Cloudflare 预览 |
| `cf:deploy` | `pnpm cf:build && wrangler pages deploy` | Cloudflare 部署 |
| `docker:build` | `docker build -f Dockerfile -t my-shipany-template:latest .` | Docker 构建 |

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
  // P-1.6：条件 standalone——仅 Docker 构建（NEXT_OUTPUT=standalone）启用，
  // 与 next start / Vercel 不再冲突
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,           // ✅ 已开启严格模式
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  images: {
    // P-1.6：只允许已知域名（Google/GitHub 头像 + 配置的 STORAGE_DOMAIN），不再放通 *
    remotePatterns: buildImageRemotePatterns(),
  },
  async redirects() {
    return [];                     // 无自定义重定向
  },
  // 安全响应头：X-Frame-Options / X-Content-Type-Options / Referrer-Policy /
  // Strict-Transport-Security 等（CSP 由部署平台按需追加）
  async headers() { /* ... */ },
};

export default withBundleAnalyzer(withNextIntl(withMDX(configWithMDX)));
```

### 配置状态（P-1.6 后）

| 项 | 当前值 | 说明 |
|----|--------|------|
| `reactStrictMode` | `true` | ✅ 已修复 |
| `images.remotePatterns` | 白名单 | ✅ 已修复（不再放通 `*`） |
| `output: "standalone"` | 条件开启 | ✅ 已修复（仅 NEXT_OUTPUT=standalone 时，与 Vercel/next start 不冲突） |

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
| `ADMIN_BOOTSTRAP_EMAIL` | ❌（建议生产启用） | - | **第九轮 P0-3 建议新增**：仅当显式设置时才由迁移 0012 创建初始管理员；未设置则不建号 |
| `ADMIN_BOOTSTRAP_PASSWORD` | ❌（建议生产启用） | - | **第九轮 P0-3 建议新增**：初始管理员密码；未设置时迁移内用 `gen_random_uuid()` 随机生成，只写一次启动日志 |

### 5.2 数据库 (Supabase)

> ⚠️ 必填语义（2026-08 修订）：`lib/env.ts` 启动 fail-fast 仅强制 3 个变量
> （NEXT_PUBLIC_WEB_URL、NEXT_PUBLIC_PROJECT_NAME、AUTH_SECRET）。下表 SUPABASE_*
> 在 schema 中为 **optional**：未配置时降级为 Landing Page 模式（数据库功能不可用），
> 「功能必填」指要启用对应功能时必须配置。

| 变量 | 必填 | 说明 |
|------|------|------|
| `SUPABASE_URL` | 功能必填* | Supabase 项目 URL（*未配置时降级 Landing Page 模式，不 fail-fast） |
| `SUPABASE_ANON_KEY` | 功能必填* | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | 功能必填* | Supabase Service Role Key（绕过 RLS） |
| `DATABASE_URL` | ❌* | PostgreSQL 连接串，迁移机制（P-1.12）使用；推荐 Supabase 连接池事务模式（`?pgbouncer=true`）。*设置后服务启动自动执行未应用迁移 |

> ⚠️ 代码中优先使用 `SUPABASE_SERVICE_ROLE_KEY`，仅在未设置时 fallback 到 `SUPABASE_ANON_KEY`。生产环境应谨慎使用 Service Role Key。

### 5.3 鉴权 (NextAuth)

| 变量 | 必填 | 说明 |
|------|------|------|
| `AUTH_SECRET` | ✅ | JWT 会话签名密钥（`openssl rand -base64 32`）。**禁止留空或复用示例值**（2.14：.env.example 已置空，启动校验强制填写） |
| `AUTH_GOOGLE_ID` | ❌ | Google OAuth Client ID |
| `AUTH_GOOGLE_SECRET` | ❌ | Google OAuth Client Secret |
| `NEXT_PUBLIC_AUTH_GOOGLE_ID` | ❌ | Google OAuth Client ID（前端用） |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | ❌ | 启用 Google 登录：`true`/`false` |
| `NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED` | ❌ | 启用 One-Tap：`true`/`false` |
| `AUTH_GITHUB_ID` | ❌ | GitHub OAuth Client ID |
| `AUTH_GITHUB_SECRET` | ❌ | GitHub OAuth Client Secret |
| `NEXT_PUBLIC_AUTH_GITHUB_ENABLED` | ❌ | 启用 GitHub 登录：`true`/`false` |

### 5.4 支付 (Stripe，多渠道后待重构)

> 多渠道（Creem/Waffo）环境变量见 §5.8 待新增；渠道启用状态由 `payment_settings` 表管理，不靠环境变量。架构见 [payment/provider-abstraction.md](./payment/provider-abstraction.md)。

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
| `STORAGE_PREFIX` | ❌ | 文件 key 前缀（默认项目名，替代硬编码 "shipany/"，P-1.8） |

### 5.7 分析

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` | ❌ | Google Analytics ID（`G-XXXXXXX`） |
| `NEXT_PUBLIC_OPENPANEL_CLIENT_ID` | ❌ | OpenPanel Client ID |

### 5.8 变量登记台账

> ⚠️ 本清单是环境变量的**登记台账**：新增变量时须在此同步登记，避免多源漂移。
> 注意边界：启动 fail-fast 校验以 `lib/env.ts` 为准（当前仅强制 3 个变量 + 一批
> optional 声明）；本表中 CREEM/WAFFO/RESEND/CRON_SECRET/UPSTASH/TRUSTED_PROXY 等
> 由功能代码在运行时读取，**不在启动校验 schema 内**（未配置 = 对应功能关闭）。

| 变量 | 用途 | 阶段 |
|------|------|------|
| `CREEM_API_KEY` | Creem 支付 | ✅ 6.1 已落地 |
| `CREEM_WEBHOOK_SECRET` | Creem Webhook 验证 | ✅ 6.1 已落地 |
| `WAFFO_API_KEY` | Waffo 支付 | ✅ 6.1 已落地 |
| `WAFFO_PRIVATE_KEY` | Waffo 商户 RSA 私钥 | ✅ 6.1 已落地 |
| `WAFFO_PUBLIC_KEY` | Waffo 公钥（webhook 验签） | ✅ 6.1 已落地 |
| `WAFFO_MERCHANT_ID` | Waffo 商户 ID | ✅ 6.1 已落地 |
| `RESEND_API_KEY` | Resend 邮件发送 | ✅ 6.2 已落地 |
| `EMAIL_FROM` | 发件人地址 | ✅ 6.2 已落地 |
| `CREDIT_LOW_THRESHOLD` | 积分低余额提醒阈值 | ✅ 6.2 已落地 |
| `NEXT_PUBLIC_CRISP_WEBSITE_ID` | Crisp 客服 | ✅ 6.3 已落地 |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog 埋点 | ✅ 6.5 已落地 |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog 节点（EU/自托管） | ✅ 6.5 已落地 |
| `CRON_SECRET` | Vercel Cron 校验（Authorization Bearer）。**生产必填**：未设置时 /api/cron/daily 拒绝执行（2.13） | ✅ 第五轮 2.13 fail-fast |
| `ANONYMOUS_DAILY_LIMIT` | 未登录每日免费演示次数（默认 3） | ✅ 6.0.1 已落地 |
| `ANONYMOUS_FINGERPRINT_ENABLED` | ~~是否启用设备指纹~~ 已废弃：x-device-id 头客户端可伪造，额度键改纯 IP（第四轮审查 S3） | ⚠️ 废弃（不再读取） |
| `DEMO_MODEL` | 演示使用的模型（默认 deepseek-chat） | ✅ 6.0.1 已落地 |
| `DEMO_MAX_TOKENS` | 演示输出上限（默认 1024） | ✅ 6.0.1 已落地 |
| `BCRYPT_SALT_ROUNDS` | 密码哈希成本因子 | ✅ 6.4 已落地 |
| `CORS_ALLOWED_ORIGINS` | CORS 允许的域名列表 | ✅ P-1.10 已落地 |
| `TRUSTED_PROXY` | IP 信任拓扑：`none`（默认，不信任任何代理头）/ `vercel`（只信 x-forwarded-for 首跳）/ `cloudflare`（只信 cf-connecting-ip）。**Vercel 部署必须显式设 vercel；Docker/自托管保持 none 或声明真实拓扑** | ✅ 第五轮 2.16 默认值收敛 |
| `SNOWFLAKE_WORKER_ID` | Snowflake workerId（多实例唯一） | ✅ P-1.11 已落地 |
| `NEXT_OUTPUT` | `standalone` 时启用 standalone 输出（Docker 构建用，P-1.6） | ✅ P-1.6 已落地 |
| `UPSTASH_REDIS_REST_URL` | 限流 Redis | ✅ 6.18 已落地 |
| `UPSTASH_REDIS_REST_TOKEN` | 限流 Redis Token | ✅ 6.18 已落地 |
| `ADMIN_BOOTSTRAP_EMAIL` | 初始管理员邮箱（条件建号开关） | 🚧 第九轮 P0-3 建议新增 |
| `ADMIN_BOOTSTRAP_PASSWORD` | 初始管理员一次性密码（未设置则随机生成） | 🚧 第九轮 P0-3 建议新增 |

> 已废弃：
> - `NEXT_PUBLIC_PAYMENT_PROVIDER` — 渠道启用状态改由 `payment_settings` 表管理（见 [支付架构](./payment/provider-abstraction.md)）
> - `SENTRY_DSN` — 错误监控改由 PostHog 承担（见 [埋点方案](./11-telemetry-analytics.md)）

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
| `lint` | `eslint .` | ESLint 检查 |
| `test` | `vitest run` | 单元测试 |
| `migrate` | `node --experimental-strip-types scripts/migrate.ts` | 执行数据库迁移 |
| `db:generate` | `drizzle-kit generate` | 生成 drizzle 迁移 |
| `analyze` | `ANALYZE=true pnpm build` | 包体积分析 |
| `cf:build` | `npx @cloudflare/next-on-pages` | Cloudflare 构建 |
| `cf:preview` | `pnpm cf:build && wrangler pages dev` | Cloudflare 预览 |
| `cf:deploy` | `pnpm cf:build && wrangler pages deploy` | Cloudflare 部署 |
| `docker:build` | `docker build -f Dockerfile -t my-shipany-template:latest .` | Docker 构建 |

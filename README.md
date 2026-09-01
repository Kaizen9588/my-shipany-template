# my-shipany-template

> 基于 [ShipAny](https://shipany.ai) 开源版打造的 **个人 AI SaaS 通用模板**。
> 后续每个新产品以此为基础快速启动，无需从零搭建。

`my-shipany-template` 是一个开箱即用的 AI SaaS 全栈模板，预置了登录鉴权、积分系统、多支付渠道、AI 网关、后台管理、用户控制台、国际化、邮件通知、埋点分析等能力，并配套完整的工程化（构建 / 单测 / Lint / 迁移 / Docker）。

---

## ✨ 功能总览

### 认证与用户
- **NextAuth.js v5**：Google / GitHub OAuth + Google One-Tap
- **初始管理员引导**：内置默认管理员 `admin@shipany.local`（初始密码 `123456`，仅 bcrypt 哈希入库），状态 `pending_activation` + `must_change_password`，首次登录强制改密激活；另可通过 `ADMIN_BOOTSTRAP_EMAIL` 显式创建一次性引导账号
- **邮箱密码登录**（Credentials Provider + bcrypt，含登录失败锁定）
- 邮箱验证码（注册验证 / 密码重置复用）
- JWT Session，OAuth 登录自动建号并赠送 10 积分
- 路由保护：控制台需登录、后台需管理员 RBAC

### 积分系统
- 新用户赠送 / 订单充值 / API 调用扣费 / 管理员手动调整
- 原子扣减存储过程（`decrease_credits`，FIFO 从最早过期积分消耗）
- 余额不足抛 `InsufficientCreditsError`，防止透支
- 积分低余额 / 耗尽邮件 + 站内通知

### 支付（多渠道抽象）
- **Stripe**（Card / Alipay / WeChat Pay）
- **Creem**（MoR 渠道，Card / Alipay）
- **Waffo**（MoR+PSP 渠道，Card / Alipay / WeChat Pay）
- 统一 Provider 抽象层：业务只感知支付方式，不感知渠道
- `payment_settings` 表热切换 + 健康检测 failover
- 退款：Stripe / Waffo 自动 API 退款，Creem Dashboard 手动 + Webhook 同步
- 服务端定价单一真相源（`data/pricing.ts`），客户端不可篡改金额

### AI 网关
- Vercel AI SDK 统一入口，支持 OpenAI / DeepSeek / OpenRouter / SiliconFlow
- 模型白名单 + 定价表（`data/model-pricing.ts`）
- 预估一次扣清 + 失败退款闭环
- `/api/v1/ai/generate` + `/api/v1/ai/demo`（匿名免费试用）
- 匿名试用限流（纯 IP 维度，指纹方案已废弃，见 docs/14）

### 后台管理（Admin）
- 数据看板：总用户 / 今日新增 / 总收入 / 今日订单 / 积分消耗 / 活跃用户 + 30 天趋势
- 支付渠道管理：/admin/payment，一键启用/停用 Stripe/Creem/Waffo + 优先级 + 健康状态 / 24h 成败统计（数据库热切换，无需重部署）
- 告警通知：/admin/notify，配置飞书/企业微信机器人；支持事件级开关与最低级别，支付渠道摘除、金额不匹配等事件实时推送到群
- 定价映射：/admin/pricing，独立管理 product_id → 金额 / 积分 / 有效期 / 渠道产品 ID
- 运营日志：/admin/logs，检索 payment.* 等结构化运营事件；/admin/payment 展示渠道健康状态与 24h 成败统计
- 用户管理：搜索 / 分页 / 详情 / 角色修改 / 封禁/解封 / 手动调整积分
- 订单管理：搜索 / 筛选 / 按渠道退款 / CSV 导出
- 文章（博客）管理：Markdown 编辑器、多语言、上下架
- 积分流水查询、操作审计日志

### 用户控制台（Console）
- API Key 管理（哈希存储）
- 我的积分 / 我的订单 / 我的邀请
- 个人资料编辑（昵称 / 头像 / 语言）
- 用量统计（日 / 周 / 月聚合）
- 通知中心（30s 轮询）
- 订阅管理、账号删除（GDPR）

### Landing Page & 国际化
- 完整 Landing 区块（Hero / Feature / Pricing / Testimonial / FAQ / CTA / Footer 等）
- 中英双语（next-intl，URL 前缀路由）
- 所有文案通过 i18n JSON 配置，无需改代码
- 法律页（隐私政策 / 服务条款）

### 工程化与运维
- 单元测试：Vitest，43 文件 / 179 用例覆盖核心业务逻辑（以 `pnpm test` 实际输出为准）
- ESLint（Next.js flat config）
- 数据库迁移：`data/migrations/*.sql` 自动执行（幂等）
- 健康检查 `/api/health`、每日备份 Cron、CSRF/CORS 防护
- Vercel / Cloudflare / Docker 三种部署方式

---

## 🛠 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Next.js (App Router, Turbopack) | 16.3.1 |
| 语言 | TypeScript | 5.7.2 |
| UI | React + Tailwind CSS + shadcn/ui | 19.2.8 / 3.4.x |
| 数据库 | Supabase (PostgreSQL) | - |
| 鉴权 | NextAuth.js (Auth.js v5) | 5.0.0-beta.25 |
| 支付 | Stripe / Creem / Waffo（Provider 抽象） | - |
| AI | Vercel AI SDK | 4.1.x |
| i18n | next-intl | 4.13.x |
| 邮件 | Resend + React Email | - |
| 埋点 | PostHog + GA4 + OpenPanel | - |
| 限流 | 内存级（Upstash Ratelimit 待接入） | - |
| 测试 | Vitest | 4.1.x |
| 包管理 | pnpm | 11.x |

---

## 📁 项目结构

```
my-shipany-template/
├── app/
│   ├── [locale]/              # 多语言页面（Landing / Admin / Console / Auth）
│   ├── api/                   # API 路由（checkout / webhook / admin / v1/ai 等）
│   └── (legal)/               # 法律页
├── auth/                      # NextAuth 配置
├── components/                # UI 组件（blocks / ui / console / dashboard / sign）
├── data/                      # 定价表、AI 模型定价、数据库迁移 SQL
├── db/                        # Drizzle 配置
├── docs/                      # 完整技术文档（14+ 篇）
├── emails/                    # React Email 模板
├── i18n/                      # 国际化（landing 文案 / 消息 / 路由）
├── lib/                       # 工具库（env / hash / payment / email / telemetry 等）
├── models/                    # 数据模型（Supabase 操作）
├── services/                  # 业务逻辑（credit / order / refund / stats 等）
├── types/                     # TypeScript 类型定义
├── aisdk/                     # AI SDK Provider（Kling 等）
├── __tests__/                 # 单元测试
├── ESLint config
├── next.config.mjs
├── middleware.ts              # next-intl + CSRF/CORS 防护
└── instrumentation.ts         # 启动时环境校验 + 自动迁移
```

---

## 🚀 快速开始

### 前置要求

- Node.js 20+（推荐 22 LTS）
- pnpm 11+（`corepack enable pnpm` 或 `npm i -g pnpm`）
- Supabase 项目（或本地 PostgreSQL）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少配置以下必填项：

```env
NEXT_PUBLIC_WEB_URL = "http://localhost:3000"
NEXT_PUBLIC_PROJECT_NAME = "my-shipany-template"
AUTH_SECRET = "用 openssl rand -base64 32 生成"
```

数据库（Supabase）：
```env
SUPABASE_URL = "https://<project-ref>.supabase.co"
SUPABASE_ANON_KEY = "<anon-key>"
SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
DATABASE_URL = "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres"
```

### 3. 初始化数据库

```bash
# 唯一建库入口：脚本会自动读取 .env.local 中的 DATABASE_URL
pnpm migrate

# 应用启动时只校验迁移版本；若有 pending migration 会拒绝启动
pnpm dev
```

> 迁移仅在 `DATABASE_URL` 配置后执行；仅预览 Landing Page 时可不配置数据库。不要执行 `data/install.sql` 或手工粘贴迁移，以免触发基线一致性检查失败。

### 🧑‍💻 第一次运行：初始管理员

迁移会内置默认超级管理员（0027，幂等）：

- 账号 `admin@shipany.local`，初始密码 `123456`（仅 bcrypt 哈希入库，明文不出现在迁移/代码中）
- 状态 `pending_activation` + `must_change_password`：可登录，但访问 `/admin` 或控制台会被强制跳转 `/change-password`，改密完成前任何后台 API 都被拒绝（`requireAdmin` 拦截）
- 用初始密码登录后设置新密码（≥8 位含字母和数字），改密成功账号自动激活

不需要默认管理员时（如生产环境），执行 `DELETE FROM users WHERE email='admin@shipany.local';` 或将其置为 `banned`（见迁移 0027 末尾注释）。

需要额外创建其他初始管理员时，在受控部署环境中配置：

```env
ADMIN_BOOTSTRAP_EMAIL = "admin@example.com"
# 建议直接设置高强度一次性密码；留空时服务只会在受限启动日志输出随机临时密码。
ADMIN_BOOTSTRAP_PASSWORD = "ReplaceWithAStrongTemporaryPassword123"
```

首次迁移会创建一条 `pending_activation` 的 `super_admin` 账号；它只能进入改密流程。打开
`http://localhost:3000/auth/signin` 后使用上述凭据登录，系统会跳转至 `/change-password`。
完成强制改密后账号自动激活，可访问 `/admin`。

> ⚠️ 临时密码、启动日志和环境变量都属于敏感信息，不能提交到仓库或发送到公开渠道。
> 自托管 `next start` 时还需设置 `AUTH_TRUST_HOST=true`。

### 4. 启动开发服务器

```bash
pnpm dev
```

打开 http://localhost:3000

### 5. 运行测试

```bash
pnpm test        # 运行全部单元测试（43 文件 / 179 用例）
pnpm lint        # ESLint 检查
pnpm build       # 生产构建
```

---

## 🔑 环境变量清单

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_WEB_URL` | ✅ | 站点根 URL |
| `NEXT_PUBLIC_PROJECT_NAME` | ✅ | 项目名称 |
| `AUTH_SECRET` | ✅ | NextAuth 密钥（`openssl rand -base64 32`） |
| `SUPABASE_URL` | 条件 | 数据库启用时必填 |
| `SUPABASE_ANON_KEY` | 条件 | 数据库启用时必填 |
| `SUPABASE_SERVICE_ROLE_KEY` | 条件 | 服务端操作必填 |
| `DATABASE_URL` | 条件 | 迁移机制使用 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 可选 | Google OAuth |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | 可选 | GitHub OAuth |
| `ADMIN_EMAILS` | 可选 | 管理员邮箱白名单（逗号分隔） |
| `STRIPE_PRIVATE_KEY` / `STRIPE_PUBLIC_KEY` | 可选 | Stripe 支付 |
| `STRIPE_WEBHOOK_SECRET` | 可选 | Stripe Webhook 验签 |
| `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` | 可选 | Creem 支付 |
| `WAFFO_API_KEY` / `WAFFO_PRIVATE_KEY` / `WAFFO_PUBLIC_KEY` / `WAFFO_MERCHANT_ID` | 可选 | Waffo 支付 |
| `OPENAI_API_KEY` | 可选 | OpenAI |
| `DEEPSEEK_API_KEY` | 可选 | DeepSeek |
| `OPENROUTER_API_KEY` | 可选 | OpenRouter |
| `REPLICATE_API_TOKEN` | 可选 | Replicate |
| `KLING_API_KEY` / `KLING_BASE_URL` | 可选 | Kling 视频 |
| `RESEND_API_KEY` / `EMAIL_FROM` | 可选 | 邮件发送 |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | 可选 | PostHog 埋点 |
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` | 可选 | GA4 |
| `NEXT_PUBLIC_CRISP_WEBSITE_ID` | 可选 | Crisp 客服 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 可选 | Upstash 限流 |
| `STORAGE_ENDPOINT` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_BUCKET` | 可选 | S3 存储 |
| `CRON_SECRET` | 可选 | Cron 鉴权 |
| `FEISHU_WEBHOOK_URL` / `FEISHU_SECRET` | 可选 | 飞书机器人告警（后台 /admin/notify 可替代） |
| `WECOM_WEBHOOK_URL` | 可选 | 企业微信机器人告警（后台 /admin/notify 可替代） |
| `NOTIFY_MIN_SEVERITY` | 可选 | 通知最低级别 info/warn/error/critical（默认 warn） |
| `SNOWFLAKE_WORKER_ID` | 可选 | 多实例部署时唯一，避免订单号重复 |
| `CORS_ALLOWED_ORIGINS` | 可选 | 跨域来源 |

> 完整清单与说明见 [docs/08-config-env.md](./docs/08-config-env.md)。

---

## 🧪 单元测试

项目使用 **Vitest**，覆盖核心业务逻辑：

```bash
pnpm test                    # 全部测试
pnpm test -- __tests__/credit.test.ts   # 指定文件
```

当前覆盖模块：

| 模块 | 说明 |
|------|------|
| `services/credit` | 积分扣减 / 增加 / 订单充值 / 管理员调整 / 余额查询 |
| `services/order` | Stripe 支付回调处理 |
| `services/refund` | 退款扣回积分 |
| `services/affiliate` | 联盟奖励计算 |
| `services/page` | Landing Page 文案加载 |
| `lib/env` | 环境变量校验 |
| `lib/hash` | 哈希 / UUID / Snowflake ID |
| `lib/password` | 密码哈希 / 强度校验 |
| `lib/ratelimit` | 限流 |
| `lib/login-guard` | 登录失败锁定 |
| `lib/csv` | CSV 导出 |
| `lib/resp` | 统一响应格式 |
| `lib/time` | 时间工具 |
| `lib/payment/*` | 支付渠道注册 / 路由 / 健康检测 |
| `lib/email` | 邮件发送 / 节流 |
| `lib/ai/registry` | AI Provider 注册 |
| `lib/backup` | 数据备份 |
| `lib/audit` | 操作审计 |
| `lib/storage` | 存储 key 生成 |
| `lib/telemetry` | 埋点 |
| `models/verification` | 邮箱验证码 |
| `data/pricing` | 定价表 |
| `data/model-pricing` | AI 模型定价 |
| `app/api/health` | 健康检查 API |

---

## 🌐 部署

### Vercel（推荐）

1. 将仓库推送到 GitHub
2. Vercel Dashboard → New Project → 导入仓库
3. 配置环境变量（同 `.env.example`）
4. 部署后配置 Stripe / Creem / Waffo Webhook

项目已包含 `vercel.json`（API 最大执行时间 60s + 每日 Cron 备份）。

### Cloudflare Workers

```bash
pnpm cf:deploy   # 构建并部署到 Cloudflare Pages
```

### Docker

```bash
pnpm docker:build
docker run -p 3000:3000 my-shipany-template:latest
```

> 详细部署步骤见 [docs/07-deployment.md](./docs/07-deployment.md)。

---

## 📚 技术文档

完整技术文档见 [docs/README.md](./docs/README.md)，包含：

| 文档 | 内容 |
|------|------|
| [01-architecture.md](./docs/01-architecture.md) | 总体架构设计 |
| [02-api-reference.md](./docs/02-api-reference.md) | API 接口文档 |
| [03-database-schema.md](./docs/03-database-schema.md) | 数据库设计 |
| [04-auth-flow.md](./docs/04-auth-flow.md) | 鉴权流程 |
| [05-payment-credits-flow.md](./docs/05-payment-credits-flow.md) | 支付与积分流程 |
| [07-deployment.md](./docs/07-deployment.md) | 部署文档 |
| [08-config-env.md](./docs/08-config-env.md) | 配置与环境变量 |
| [10-email-system.md](./docs/10-email-system.md) | 邮件系统 |
| [11-telemetry-analytics.md](./docs/11-telemetry-analytics.md) | 埋点与监控 |
| [12-architecture-adversarial-review.md](./docs/12-architecture-adversarial-review.md) | 架构审查遗留项 |
| [13-ai-gateway.md](./docs/13-ai-gateway.md) | AI 网关闭环 |
| [14-anonymous-trial.md](./docs/14-anonymous-trial.md) | 免费试用额度 |
| [boundary-spec.md](./docs/boundary-spec.md) | 项目边界规范（禁止提交 / 密钥安全 / 越权与资金边界 / Git 自查） |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 完整开发方案与路线图 |

---

## 🧩 如何基于此模板开发新产品

1. **Fork / Copy** 本仓库，改项目名与 `package.json`
2. **配置环境变量**：`.env.local` 填入你的 Supabase / OAuth / 支付 / AI 凭据
3. **初始化数据库**：配置 `DATABASE_URL` 后执行 `pnpm migrate`（迁移集合已包含基线表）
4. **修改 Landing 文案**：编辑 `i18n/pages/landing/{en,zh}.json`
5. **新增 AI 能力**：在 `services/` 加业务逻辑，在 `data/model-pricing.ts` 注册模型定价
6. **调整定价**：修改 `data/pricing.ts`（服务端单一真相源）
7. **部署**：推送到 GitHub → Vercel 自动部署

---

## 📄 License

基于 **ShipAny AI SaaS Boilerplate License Agreement**。

---

## 🙏 致谢

- [ShipAny](https://shipany.ai) - 开源样板
- [Next.js](https://nextjs.org) / [shadcn/ui](https://ui.shadcn.com) / [Vercel AI SDK](https://ai-sdk.dev)

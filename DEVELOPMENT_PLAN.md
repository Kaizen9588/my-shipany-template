# my-shipany-template 开发方案

> 基于 ShipAny 开源版（ShipAny One）打造的 AI SaaS 模板项目。
> 本文档梳理已有功能、待完成功能、技术选型及开发路线，供团队和 LLM 评审。

> ✅ **2026-08-16 完善**：单元测试补全至 119 个用例；README 重写为完整版；
> 新增安全响应头 / GitHub Actions CI / 动态 Sitemap / Open Graph 元数据 / 错误与加载页；
> 修复 `login-guard.ts` 登录失败计数失效、`payment-health.ts` 健康状态被 `isProviderHealthy` 误重置；
> 修复 Landing 区块条件 Hooks 与 `useOneTapLogin` 条件调用（rules-of-hooks）；
> 修复 ESLint 配置（Next 16 flat config）与 `pnpm-workspace.yaml` allowBuilds；
> 完整度清单见 [docs/15-professional-checklist.md](./docs/15-professional-checklist.md)。

> 🔒 **2026-08-16 资金安全第四轮（R1-R3/S1-S3 已修）**：Webhook 金额/币种精确比对
> （迁移 0010，不匹配置 `mismatch` 不充值）、订单写入 payment_provider、退款存储过程原子化
> （迁移 0011，并发双扣修复）、IP 信任按 TRUSTED_PROXY 收敛、验证码 crypto 随机+限流+发送冷却、
> 匿名 demo 模型服务端固定且额度改纯 IP；Stripe 优惠码因金额精确比对暂时禁用。
> 单测 126 用例（含对抗性回归）。遗留 6 项待办见 [docs/12](./docs/12-architecture-adversarial-review.md) §2.7~2.12。

---

## 一、项目概述

| 项目 | 说明 |
|------|------|
| 仓库 | https://github.com/Kaizen9588/my-shipany-template |
| 本地路径 | /Users/wang/code/my-shipany-template |
| 基础框架 | ShipAny One 开源版（Next.js SaaS Boilerplate） |
| 定位 | 个人 AI SaaS 产品的通用模板，后续每个新产品基于此快速启动 |
| 部署目标 | Vercel（首选）/ Cloudflare Workers / Docker |

---

## 二、技术栈

### 2.1 当前技术栈（已落地）

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| **框架** | Next.js (App Router) | 16.3.1 | Turbopack 默认，RSC，Server Actions |
| **语言** | TypeScript | 5.7.2 | 业务层类型安全；数据层手写 Supabase Client，返回类型手工断言，无编译期 schema 校验（Drizzle 引入后升级，见 P-1 遗留项跟踪表） |
| **UI 框架** | React | 19.2.8 | |
| **CSS** | Tailwind CSS | 3.4.19 | v4 暂不升级，迁移成本大 |
| **组件库** | shadcn/ui (Radix UI) | - | 基于 radix-ui 原语，可定制 |
| **图标** | react-icons / lucide-react | - | |
| **动画** | framer-motion | 11.x | |
| **数据库** | Supabase (PostgreSQL) | - | 托管 PG，自带 Auth（项目未用其 Auth） |
| **ORM/客户端** | @supabase/supabase-js | 2.47.x | 直接用 Supabase Client，无 ORM |
| **鉴权** | NextAuth.js (Auth.js v5) | 5.0.0-beta.25 | Google / GitHub OAuth + One-Tap |
| **支付** | Stripe | 17.5.0 | 一次性 + 订阅，支持 CNY(微信/支付宝) |
| **i18n** | next-intl | 4.13.6 | en / zh，URL 前缀路由 |
| **AI SDK** | Vercel AI SDK | 4.1.x | OpenAI / DeepSeek / Replicate / OpenRouter |
| **AI 视频** | Kling 自定义 Provider | - | 文生视频 |
| **存储** | AWS S3 SDK | 3.740.x | 文件上传（有 SDK，无 UI） |
| **分析** | Google Analytics + OpenPanel | - | 双通道（⚠️ OpenPanel 待 PostHog 接入后移除，见 6.5） |
| **MDX** | @next/mdx | 16.3.1 | 博客内容渲染 |
| **编辑器** | @uiw/react-md-editor | 4.0.x | 后台博文编辑 |
| **包管理** | pnpm | 11.x | |
| **部署** | Vercel / Cloudflare / Docker | - | output: standalone |

### 2.2 待引入技术栈（规划中）

| 用途 | 技术 | 选型理由 |
|------|------|----------|
| **多支付渠道** | Creem + Waffo（后续 Stripe + PayPal） | 个人可申请 MoR 渠道起步，注册美国公司后无缝加 Stripe；详见 [支付架构](./docs/payment/provider-abstraction.md) |
| **邮件服务** | Resend + React Email | Vercel 生态首选，React Email 做模板，免费额度够用；详见 [邮件系统](./docs/10-email-system.md) |
| **反馈/客服** | Crisp | ShipAny 官网同款，免费版够用，接入简单 |
| **埋点与监控** | PostHog（主）+ Plausible（备选） | 分析+回放+错误一体化，秒级实时，可自托管；替代原 Sentry 方案；详见 [埋点方案](./docs/11-telemetry-analytics.md) |
| **限流** | Upstash Ratelimit | Vercel 生态，Redis-based，Serverless 友好 |
| **图表** | recharts 或 @tremor/react | 后台数据看板可视化 |
| **表单验证** | zod + react-hook-form | 已有 zod，补充表单场景 |
| **邮箱密码登录** | NextAuth Credentials Provider + bcrypt | 密码登录为主，验证码仅用于注册验证与密码重置 |

---

## 三、架构概览

```
┌─────────────────────────────────────────────────────┐
│                    Vercel (部署)                      │
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │            Next.js 16 (App Router)            │   │
│  │                                                │   │
│  │  app/[locale]/                                 │   │
│  │    ├── (default)/    ← Landing + 用户控制台    │   │
│  │    ├── (admin)/      ← 后台管理                │   │
│  │    ├── auth/         ← 登录注册                │   │
│  │    └── pay-success/  ← 支付回调                │   │
│  │  app/api/            ← API 路由                │   │
│  │  app/(legal)/        ← 法律页面                │   │
│  │                                                │   │
│  │  middleware.ts       ← next-intl 路由          │   │
│  └──────────────────────────────────────────────┘   │
│         │          │           │          │          │
│    ┌────┘    ┌─────┘     ┌─────┘    ┌─────┘          │
│    ▼         ▼           ▼          ▼                │
│  Supabase  Stripe     NextAuth   AI SDK              │
│  (PG 数据库) (支付)    (鉴权)    (OpenAI等)           │
│         │                                             │
│    ┌────┘                                             │
│    ▼                                                  │
│  AWS S3 (文件存储)                                    │
└─────────────────────────────────────────────────────┘
```

### 目录结构

```
my-shipany-template/
├── app/
│   ├── [locale]/
│   │   ├── (admin)/admin/        # 后台管理（用户/订单/文章）
│   │   ├── (default)/
│   │   │   ├── (console)/        # 用户控制台（API Key/积分/订单/邀请）
│   │   │   ├── posts/            # 博客
│   │   │   └── page.tsx          # Landing Page
│   │   ├── auth/signin/          # 登录页
│   │   ├── pay-success/          # 支付成功页
│   │   └── layout.tsx            # 全局 Layout
│   ├── (legal)/                  # 隐私政策 / 服务条款
│   └── api/                      # API 路由
│       ├── auth/[...nextauth]/   # NextAuth
│       ├── checkout/             # Stripe Checkout
│       ├── stripe-notify/        # Stripe Webhook
│       ├── demo/                 # AI 生成 demo
│       ├── get-user-info/        # 获取用户信息
│       ├── ping/                 # 积分扣减示例
│       └── update-invite*/       # 邀请码
├── auth/                         # NextAuth 配置
├── components/
│   ├── blocks/                   # Landing Page 区块
│   ├── console/                  # 用户控制台组件
│   ├── dashboard/                # 后台管理组件
│   ├── sign/                     # 登录组件
│   ├── ui/                       # shadcn/ui 基础组件
│   └── ...
├── models/                       # 数据模型 (Supabase 操作)
├── services/                     # 业务逻辑
├── types/                        # TypeScript 类型定义
├── lib/                          # 工具函数
├── i18n/                         # 国际化
├── aisdk/                        # AI SDK 自定义 Provider (Kling)
├── data/install.sql              # 数据库建表 SQL
├── middleware.ts                 # next-intl 中间件
└── next.config.mjs               # Next.js 配置
```

---

## 四、数据库 Schema

> 完整表结构、ER 图、字段说明、索引分析、多渠道表结构（stripe_orders/creem_orders/waffo_orders/payment_settings/payment_products）及待新增表，见 [docs/03-database-schema.md](./docs/03-database-schema.md)。

现有 6 张表：`users` / `orders` / `credits` / `apikeys` / `posts` / `affiliates`。多支付渠道改造时 `orders` 拆分为共享表 + 渠道专属表。

---

## 五、已有功能详细清单

### 5.1 登录鉴权 ✅

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| Google OAuth 登录 | ✅ 可用 | `auth/config.ts` | 通过环境变量开关 |
| GitHub OAuth 登录 | ✅ 可用 | `auth/config.ts` | 通过环境变量开关 |
| Google One-Tap 登录 | ✅ 可用 | `auth/config.ts` | 通过环境变量开关 |
| 邮箱密码登录 | ❌ 未实现 | - | 需补充 Credentials Provider |
| JWT Session | ✅ 可用 | `auth/config.ts` | jwt callback 自动建用户 |
| 登录页 UI | ✅ 可用 | `app/[locale]/auth/signin/` | 含 Modal 弹窗模式 |
| 登出 | ✅ 可用 | `components/sign/` | |
| 路由保护 | ✅ 可用 | 各 layout.tsx | admin 检查 ADMIN_EMAILS，console 检查登录状态 |
| API Key 认证 | ✅ 可用 | `services/user.ts` | Bearer token，sk- 前缀 |

**新用户注册流程**：OAuth 登录 -> jwt callback -> `saveUser()` -> 写入 users 表 -> `increaseCredits()` 赠送 10 积分（1 年有效）

### 5.2 积分系统 ✅

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| 积分增加 | ✅ 可用 | `services/credit.ts` | `increaseCredits()` |
| 积分扣减 | ✅ 可用 | `services/credit.ts` | `decreaseCredits()`，按 FIFO 从最早过期积分扣 |
| 积分过期 | ✅ 可用 | credit.expired_at | 查询时过滤 `gte(expired_at, now)` |
| 新用户赠送 | ✅ 可用 | `services/user.ts` | 10 积分，1 年有效 |
| 订单充值积分 | ✅ 可用 | `services/credit.ts` | `updateCreditForOrder()` |
| 积分余额查询 | ✅ 可用 | `services/credit.ts` | `getUserCredits()` |
| 积分流水记录 | ✅ 可用 | credits 表 | 每笔变动都有 trans_no |
| 后台积分管理 | ❌ 未实现 | - | 管理员无法查看/调整用户积分 |
| 积分不足提醒 | ❌ 未实现 | - | 需邮件通知 |

**积分交易类型** (`CreditsTransType`)：
- `new_user`: 新用户赠送
- `order_pay`: 订单支付充值
- `system_add`: 系统手动增加（代码有定义，后台无 UI）
- `ping`: API 调用消耗（示例）
- `ai_generate`: AI 调用扣费（规划，见 6.0 网关闭环）
- `ai_refund`: AI 失败退款（规划，见 6.0）

### 5.3 支付系统 ✅（Stripe 部分）

> ⚠️ **v1 范围**：只做一次性积分包，订阅代码虽存在但不启用（跨渠道订阅迁移是行业难题，见 6.1）。多渠道架构见 6.1。

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| Stripe Checkout | ✅ 可用 | `app/api/checkout/route.ts` | 创建 Stripe Session |
| 一次性付款 | ✅ 可用 | - | interval: "one-time" |
| 订阅（月/年） | ⚠️ 遗留代码，v1 不启用 | - | interval: "month"/"year" |
| CNY 支付（微信/支付宝） | ✅ 可用 | checkout route | currency=cny 时自动启用 |
| 优惠码 | ⚠️ 暂禁用 | stripe adapter | 打折后实付≠订单额，与 R1 金额精确比对互斥（迁移 0010）；订单模型支持折扣金额后恢复 |
| Webhook 处理 | ✅ 可用 | `app/api/stripe-notify/` | 处理 checkout.session.completed |
| 订单创建 | ✅ 可用 | `models/order.ts` | `insertOrder()` |
| 订单状态更新 | ✅ 可用 | `models/order.ts` | `updateOrderStatus()` |
| 订阅状态更新 | ✅ 可用 | `models/order.ts` | `updateOrderSubscription()` |
| 支付成功页 | ✅ 可用 | `app/[locale]/pay-success/` | |
| Creem 支付 | ❌ 未实现 | - | 用户需要（无海外卡） |
| 退款 | ❌ 未实现 | - | 后台无退款操作 |
| 订阅取消 | ❌ 未实现 | - | 用户无法自助取消 |
| Webhook 事件覆盖 | ⚠️ 部分 | - | 仅处理 checkout.session.completed，缺 subscription.deleted/updated 等 |

**当前定价方案**（i18n 配置）：
| 方案 | 价格 | 积分 | 有效期 | 类型 |
|------|------|------|--------|------|
| Starter | $99 | 100 | 1 个月 | 一次性 |
| Standard | $199 | 200 | 3 个月 | 一次性 |
| Premium | $299 | 300 | 12 个月 | 一次性 |

### 5.4 后台管理 ✅（P1 强化完成）

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| 管理员鉴权 | ✅ 可用 | `lib/auth.ts` + `(admin)/layout.tsx` | RBAC 角色 + ADMIN_EMAILS 白名单过渡（6.10） |
| 管理首页 | ✅ 数据看板 | `admin/page.tsx` + `services/stats.ts` | 6 指标卡 + 30 天用户/收入/积分趋势图（6.6） |
| 用户列表 | ✅ 搜索/分页 | `admin/users/` | 按邮箱/昵称/uuid 搜索，角色/状态标识（6.7） |
| 用户详情 | ✅ | `admin/users/[uuid]/page.tsx` | 角色修改、封禁/解封、调整积分、流水查看（6.7/6.9） |
| 付费订单列表 | ✅ 搜索/退款/导出 | `admin/paid-orders/` | 搜索 + 按渠道退款 + CSV 导出（6.8） |
| 文章管理 | ✅ 完整 | `admin/posts/` | 列表 + 新增 + 编辑（Markdown 编辑器） |
| 数据看板 | ✅ | `/api/admin/stats` | 总用户/今日新增/总收入/今日订单/积分消耗/活跃用户 |
| 用户编辑/封禁 | ✅ | `PUT /api/admin/user` | role/status/nickname |
| 手动调整积分 | ✅ | `POST /api/admin/user/credits` + `admin/credits/adjust` | system_add，可正可负带备注 |
| 订单退款 | ✅ 按渠道 | `POST /api/admin/refund` | Stripe/Waffo 自动；Creem Dashboard 手动 + webhook 同步 |
| 积分流水 | ✅ | `admin/credits/page.tsx` | 关联用户邮箱，分页 |
| 审计日志查看 | ✅ | `admin/audit-logs/` | 操作记录列表检索 |
| RBAC 角色管理 | ✅ 基础 | users.role + `lib/auth.ts` | super_admin/admin/operator/user（6.10） |
| 系统设置 | ❌ 未实现 | - | P3 后续 |
| 支付渠道管理页 | ✅ 已实现 | `/admin/payment` + `/api/admin/payment-settings` | 渠道开关/priority/定价映射（健康状态与 op_events 待 6.23 后半） |
| 事件日志/告警 | ✅ 已实现 | `op_events` + `/admin/logs` + `/api/admin/op-events` | 日志检索、支付健康统计、飞书/企微告警均已落地 |
| 操作日志 | ⚠️ 最小版 | `lib/audit.ts` + audit_logs 表 | 后台写操作已记录；完整审计（6.20）P3 |
| 数据导出 | ✅ 订单 CSV | `lib/csv.ts` | 用户导出 P3 |

### 5.5 用户控制台 ✅

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| API Key 管理 | ✅ 可用 | `(console)/api-keys/` | 创建/列表，哈希存储（P-1.5） |
| 我的积分 | ✅ 可用 | `(console)/my-credits/` | 查看余额和流水 |
| 我的订单 | ✅ 可用 | `(console)/my-orders/` | 查看历史订单 |
| 我的邀请 | ✅ 可用 | `(console)/my-invites/` | 邀请码和奖励 |
| 个人资料编辑 | ✅ 可用 | `(console)/settings/` | 昵称/语言偏好/头像上传（6.11） |
| 订阅管理 | ✅ v1 | `(console)/subscription/` | 订阅状态展示；订阅功能 v1 不启用（6.12） |
| 用量统计 | ✅ 可用 | `(console)/usage/` | 日/周/月聚合 + API 调用记录（6.13） |
| 通知中心 | ✅ v1 | `(console)/notifications/` | 30s 轮询，支付/积分事件触发（6.14） |

### 5.6 Landing Page ✅

| 区块 | 状态 | 配置位置 | 说明 |
|------|------|----------|------|
| Header 导航 | ✅ | `i18n/pages/landing/` | 含语言切换、主题切换、登录入口 |
| Hero | ✅ | `i18n/pages/landing/` | 标题 + 描述 + CTA + 背景 |
| Branding | ✅ | `i18n/pages/landing/` | 品牌展示 |
| Introduce | ✅ | `i18n/pages/landing/` | 产品介绍 |
| Benefit | ✅ | `i18n/pages/landing/` | 优势说明 |
| Usage | ✅ | `i18n/pages/landing/` | 使用步骤 |
| Feature | ✅ | `i18n/pages/landing/` | 功能特性（3 种样式） |
| Showcase | ✅ | `i18n/pages/landing/` | 案例展示 |
| Stats | ✅ | `i18n/pages/landing/` | 数据统计 |
| Pricing | ✅ | `i18n/pages/landing/` | 定价方案 |
| Testimonial | ✅ | `i18n/pages/landing/` | 用户评价 |
| FAQ | ✅ | `i18n/pages/landing/` | 常见问题 |
| CTA | ✅ | `i18n/pages/landing/` | 行动号召 |
| Footer | ✅ | `i18n/pages/landing/` | 页脚 |

所有内容通过 i18n JSON 配置，无需改代码即可修改文案。

### 5.7 国际化 ✅

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 支持语言 | en / zh | 可扩展 |
| URL 前缀路由 | ✅ | /en/... /zh/... |
| 默认语言 | en | localePrefix: "as-needed" |
| 语言检测 | ✅ 可配 | 环境变量控制 |
| Landing Page 双语 | ✅ | 完整 en/zh JSON |
| 博客多语言 | ✅ | posts 表有 locale 字段 |

### 5.8 AI SDK ✅

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| OpenAI | ✅ 可用 | `aisdk/` | 文本/图片/流式 |
| DeepSeek | ✅ 可用 | `aisdk/` | |
| Replicate | ✅ 可用 | `aisdk/` | 图片/音频 |
| OpenRouter | ✅ 可用 | `aisdk/` | 多模型聚合 |
| Kling 视频 | ✅ 可用 | `aisdk/kling/` | 自定义 Provider，文生视频 |
| Demo API | ✅ 可用 | `app/api/demo/` | gen-text/gen-image/gen-stream-text |
| 积分扣减示例 | ✅ 可用 | `app/api/ping/` | 每次调用扣 1 积分 |

### 5.9 其他已有功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 博客/CMS | ✅ | Markdown 文章，后台 CRUD |
| 联盟营销 | ⚠️ 记录完成，发放待设计 | 邀请码 + 20% 奖励（上限 $50）已记录到 affiliates 表，但奖励「发放」闭环（提现/转积分）未设计 |
| Google Analytics | ✅ | 环境变量配置（保留做广告归因） |
| OpenPanel 分析 | ✅ | 环境变量配置（⚠️ 待 PostHog 接入后移除，见 6.5） |
| S3 存储 SDK | ⚠️ | 有客户端封装，无上传 UI |
| 主题切换 | ✅ | 亮/暗色，next-themes |
| 法律页面 | ✅ | 隐私政策 + 服务条款 |
| Docker 部署 | ✅ | Dockerfile + standalone output |
| Cloudflare 部署 | ✅ | wrangler 配置 |

---

## 六、待完成功能详细方案

### P0 - 核心必须

#### 6.0 AI 网关闭环（核心收费闭环，最高优先）

> **完整设计**：[docs/13-ai-gateway.md](./docs/13-ai-gateway.md)。

| 项 | 说明 |
|----|------|
| **目标** | 连接「认证 + 积分 + AI SDK」三块积木，形成 AI 能力变现主干：鉴权 → 余额校验 → 原子扣减 → 模型路由 → 返回结果 |
| **现状缺口** | demo API 无认证无扣费，ping 只扣费不调 AI，收费闭环缺失 |
| **端点** | `/api/v1/ai/generate`（文本，非流式 v1）；v2 加流式 + 图片/视频 |
| **扣费模型** | 按 token 折算（`MODEL_PRICING` 常量，模型 ID 服务端白名单）；**预估一次扣清**（输入长度 + 输出上限），成功不退差额，失败全额退款 |
| **积分类型** | 新增 `ai_generate`（扣费）/ `ai_refund`（失败退款） |
| **前置依赖** | P-1.2（原子扣减）——预扣模式必须「检查+扣减」原子化 |
| **风险** | 模型白名单 v1 用常量表，v3 才入数据库；流式断连按已返回 token 结算 |

---

#### 6.0.1 免费试用额度（匿名演示 + 登录赠分）

> **完整设计**：[docs/14-anonymous-trial.md](./docs/14-anonymous-trial.md)。

| 项 | 说明 |
|----|------|
| **目标** | 未登录可试用 AI，登录送积分，用完提示充值 |
| **核心原则** | 匿名额度 ≠ 积分账户——匿名是**限流**（服务端 IP+指纹计数，清 cookie 无法刷），登录才是积分账户 |
| **未登录** | 每日 3 次演示（`anonymous_usage` 表 + RPC 原子递增），仅便宜模型 + 低输出上限，端点 `/api/v1/ai/demo` |
| **匿名识别** | 纯 IP 维度（S3 修正：x-device-id 头客户端可伪造，不作为额度键；IP 可信度由 TRUSTED_PROXY 保证）；清 cookie/换指纹无效，NAT 共享出口共享额度 |
| **登录** | 沿用现有 new_user 送 10 积分（1 年有效），无需新开发 |
| **用完提示** | 演示用完 → 429「登录送积分」；积分用完 → 402 + `credit_exhausted` 邮件 |
| **防刷边界** | 挡清 cookie/换 IP；伪造指纹有 IP 兜底；不防换 IP + 伪造指纹的代理池（模板阶段不做 Pro 指纹/验证码） |

---

#### 6.1 支付架构（Provider 抽象层 + 多渠道热切换）

> **完整设计**：[docs/payment/provider-abstraction.md](./docs/payment/provider-abstraction.md)；渠道对接：[stripe](./docs/payment/stripe-integration.md) / [creem](./docs/payment/creem-integration.md) / [waffo](./docs/payment/waffo-integration.md)。

| 项 | 说明 |
|----|------|
| **目标** | 多支付渠道架构，阶段 1 支持 Creem + Waffo，未来无缝加 Stripe/PayPal + 支付路由 |
| **演进路线** | 阶段 1（现在）Creem + Waffo → 阶段 2（美国公司后）+ Stripe + PayPal → 阶段 3（长期）支付路由自动 failover |
| **核心原则** | ① 用户只感知支付方式（Card/Alipay），不感知渠道；② 渠道热切换（`payment_settings` 表 + 后台一键）；③ 数据不绑定渠道；④ 一次性付款优先 |
| **关键设计** | `lib/payment/` Provider 抽象层（新增渠道只写一个 adapter + registry 加一行）；`/api/checkout` 收 `method` 不收藏道；各渠道差异（金额格式/验签/退款能力）由适配器消化 |
| **退款口径** | Stripe/Waffo 调 API 全自动；Creem 无退款 API → Dashboard 手动 + `refund.created` webhook 同步扣积分 |
| **订阅口径** | 续费充值 = 首付积分；退款扣回全部剩余积分；取消不扣回自然过期；跨渠道迁移靠 SOP |
| **风险** | MoR 费率偏高（阶段 2 切 Stripe 降本）；orders 表字段迁移需脚本 |

#### 6.2 邮件通知系统

> 完整设计见 [docs/10-email-system.md](./docs/10-email-system.md)。

| 项 | 说明 |
|----|------|
| **目标** | 关键事件发送邮件通知 |
| **技术** | Resend（API 发送）+ React Email（模板渲染），Provider 抽象与支付同构（换 SES/Postmark 只改一个文件） |
| **场景** | ① 欢迎邮件 ② 支付成功 ③ 积分不足提醒 ④ 积分耗尽 ⑤ 订阅续费提醒（预留，ROSCA/加州 ARL 合规必须） ⑥ 密码重置 |
| **合规** | 事务性（不可退订）与营销性（必须退订）物理分离；`email_marketing_opt_in` 字段控制 |
| **涉及文件** | 新增 `lib/email/*`（抽象层 + Resend 适配器）、`emails/` 目录（React Email 模板）、在 `services/order.ts` / `services/credit.ts` / `services/user.ts` 触发 |
| **环境变量** | `RESEND_API_KEY`、`EMAIL_FROM`、`CREDIT_LOW_THRESHOLD` |
| **依赖** | `resend`、`@react-email/components`、`@react-email/html` |
| **注意** | 事务性邮件 **fire-and-forget**（`void sendEmail(...)`），严禁同步 await 拖慢登录/支付主流程；发送失败不阻塞主流程 |

#### 6.3 反馈/客服按钮

| 项 | 说明 |
|----|------|
| **目标** | 网站右下角浮动反馈按钮，点击可在线沟通 |
| **技术** | Crisp（ShipAny 官网同款） |
| **涉及文件** | 新增 `components/feedback/crisp.tsx`，在 `app/[locale]/layout.tsx` 引入 |
| **环境变量** | `NEXT_PUBLIC_CRISP_WEBSITE_ID`（空值时不加载） |
| **进阶** | 登录用户自动传递 email/nickname 给 Crisp |
| **备选** | Tawk.to（完全免费）、Chatwoot（开源自部署） |

#### 6.4 邮箱密码登录

| 项 | 说明 |
|----|------|
| **目标** | 支持邮箱 + 密码登录（无 OAuth 依赖） |
| **技术** | NextAuth Credentials Provider + bcrypt 密码哈希；验证码仅用于注册验证与密码重置 |
| **涉及文件** | `auth/config.ts`（新增 Credentials Provider）、`app/api/send-verification/route.ts`（发送验证码）、`app/api/verify-code/route.ts`（验证码校验）、新增 `components/sign/email-form.tsx` |
| **新增表** | `verification_codes (id, email, code, expired_at, used, created_at)` |
| **users 表变更** | `ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)`（OAuth 用户为 NULL）+ `password_updated_at` |
| **流程** | 用户输入邮箱+密码 -> 注册时发送验证码验证邮箱 -> 验证通过写入 password_hash -> NextAuth 建用户 |
| **验证码并发** | 校验时原子标记 `used=true`（`UPDATE ... WHERE id=? AND used=false` 检查影响行数），防止一码多用 |

**密码安全设计**：

| 安全项 | 方案 |
|--------|------|
| 密码哈希 | 使用 `bcrypt`（成本因子 12）或 `argon2id` 哈希存储，绝不存明文 |
| 密码重置 | 通过邮箱验证码重置（复用 verification_codes 表），重置链接有效期 30 分钟 |
| 登录失败限制 | 同一邮箱 5 次失败后锁定 15 分钟，同一 IP 10 次失败后封禁 1 小时 |
| 邮箱验证 | 注册后必须验证邮箱才能使用（发送验证码，验证后才赠送新手积分） |
| 密码强度校验 | 最少 8 位，包含字母+数字（前端 zod 校验 + 后端二次校验） |
| 密码不纳入 JWT | 密码 hash 仅存数据库，不写入 JWT token 或 session |

**新增环境变量**：`BCRYPT_SALT_ROUNDS=12`

#### 6.5 埋点与监控（分析 + 回放 + 错误）

> 完整设计见 [docs/11-telemetry-analytics.md](./docs/11-telemetry-analytics.md)。

| 项 | 说明 |
|----|------|
| **目标** | 实时转化率漏斗 + 用户操作路径还原 + bug 复现 |
| **技术** | PostHog（主选，分析+回放+错误+feature flag 一体化，秒级实时，免费 100 万事件/月，可自托管）；Plausible（备选，可自部署）；GA4 保留仅做广告归因 |
| **三层拆解** | ① 产品分析（事件漏斗）② 会话回放（DOM 快照）③ 错误监控（异常+breadcrumb），后两者交叉实现「错误→用户操作录像」复现 |
| **追踪抽象** | `lib/telemetry/`（与支付/邮件同构的 Provider 抽象），业务代码只调 `track()`；服务端事件为真相源（webhook/API 事实），客户端事件仅辅助 |
| **身份缝合** | 匿名 ID → 登录后绑定 user_uuid，串联浏览与支付 |
| **支付漏斗埋点** | `pricing.viewed → checkout.started(t1) → checkout.url_redirected(t2) → payment.succeeded(t3)`；支付页停留时长 = t3-t2（托管页无法直接埋点，用 order_no 关联三个事件间接计算） |
| **涉及文件** | 新增 `lib/telemetry/*`、改造 `components/analytics/`、webhook/API 服务端 track 接入 |
| **环境变量** | `NEXT_PUBLIC_POSTHOG_KEY`、`NEXT_PUBLIC_POSTHOG_HOST` |
| **注意** | ① `trackServer` 必须 try-catch 吞错 + 在事务提交后调用，不阻塞主流程；② 回放遮罩输入框/邮箱/金额；③ 原 P3 Sentry 方案取消，由 PostHog 错误追踪替代 |

---

### P1 - 后台管理强化

#### 6.6 数据看板

| 项 | 说明 |
|----|------|
| **目标** | Admin 首页展示核心指标和趋势图 |
| **技术** | recharts（轻量）或 @tremor/react（SaaS 风格） |
| **指标** | 总用户数 / 今日新增 / 总收入 / 今日订单 / 积分消耗 / 活跃用户 |
| **图表** | 30 天用户增长折线图、30 天收入柱状图、积分消耗趋势 |
| **涉及文件** | 重写 `app/[locale]/(admin)/admin/page.tsx`，新增 `components/dashboard/stats/` |

#### 6.7 用户管理 CRUD

| 项 | 说明 |
|----|------|
| **目标** | 管理员可搜索、查看详情、封禁/解封、修改角色、手动加积分 |
| **涉及文件** | 重写 `admin/users/page.tsx`（加搜索+分页），新增 `admin/users/[uuid]/page.tsx`（详情页），新增 `app/api/admin/user/route.ts` |
| **新增 API** | PUT /api/admin/user（更新用户）、POST /api/admin/user/credits（手动加积分） |
| **权限** | 仅 admin 可访问，操作记录到 audit_logs |

#### 6.8 订单管理增强

| 项 | 说明 |
|----|------|
| **目标** | 订单搜索、筛选、退款、CSV 导出 |
| **涉及文件** | 重写 `admin/paid-orders/page.tsx`，新增 `app/api/admin/refund/route.ts` |
| **退款流程** | 按 `payment_provider` 分发：Stripe/Waffo 调退款 API 全自动；Creem 生成 Dashboard 退款指引 + `refund.created` webhook 同步扣回积分 |

#### 6.9 积分管理

| 项 | 说明 |
|----|------|
| **目标** | 后台查看用户积分流水，手动增减积分（带备注） |
| **涉及文件** | 新增 `admin/credits/page.tsx`（流水列表）、`admin/credits/adjust/page.tsx`（调整积分） |
| **API** | POST /api/admin/credits/adjust |

#### 6.10 RBAC 权限系统

| 项 | 说明 |
|----|------|
| **目标** | 从 email 白名单升级为角色系统 |
| **角色** | super_admin / admin / operator / user |
| **方案** | users 表加 `role` 字段（VARCHAR DEFAULT 'user'），middleware/layout 中检查角色 |
| **涉及文件** | `data/install.sql`（ALTER TABLE）、`(admin)/layout.tsx`、新增 `lib/auth.ts`（权限校验工具） |

---

### P2 - 用户体验增强

#### 6.11 用户个人资料

| 项 | 说明 |
|----|------|
| **目标** | 用户可修改昵称、头像、语言偏好、删除账号 |
| **涉及文件** | 新增 `(console)/settings/page.tsx`、`app/api/user/profile/route.ts` |
| **头像** | 接入 S3 上传 UI（当前只有 SDK 无 UI） |

#### 6.12 订阅管理

| 项 | 说明 |
|----|------|
| **目标** | 用户可查看/取消订阅、升级/降级套餐 |
| **涉及文件** | 新增 `(console)/subscription/page.tsx`；取消/门户走 Provider 接口 `cancelSubscription()` / `createPortal()`（见 provider-abstraction §3.1），不硬编码 Stripe 端点 |
| **Webhook 补充** | 处理各渠道订阅事件（Stripe `customer.subscription.deleted` / Creem `subscription.canceled` / Waffo `SUBSCRIPTION_STATUS_NOTIFICATION`） |

#### 6.13 用量统计

| 项 | 说明 |
|----|------|
| **目标** | 展示积分使用历史、API 调用记录、按日/周/月统计 |
| **涉及文件** | 新增 `(console)/usage/page.tsx`，查询 credits 表聚合统计 |

#### 6.14 通知中心

| 项 | 说明 |
|----|------|
| **目标** | 站内通知：支付成功、积分变动、系统公告 |
| **技术** | 轮询 + SSE（服务端推），**不用 Supabase Realtime** |
| **涉及文件** | 新增 `models/notification.ts`、`components/notifications/`、`(console)/notifications/page.tsx`、`app/api/notifications/stream/route.ts`（SSE） |
| **原因** | Supabase Realtime 需要客户端 anon key + RLS 策略，而当前架构全用 service role 且未配 RLS。引入 Realtime 必须先补客户端 Supabase SDK + RLS（与 P-1.8 联动），复杂度高。轮询（30s）+ SSE 足够覆盖站内通知场景 |
| **降级方案** | v1 先做「进入通知页时拉取 + 前端 30s 轮询」，SSE 作为 v2 优化 |

#### 6.15 搜索

| 项 | 说明 |
|----|------|
| **目标** | 全站博客搜索 + 后台用户/订单搜索 |
| **技术** | 简单方案：PostgreSQL LIKE / 全文索引；高级方案：Algolia |
| **涉及文件** | `app/api/search/route.ts`、后台各列表页加搜索框 |

#### 6.16 数据备份与灾难恢复

| 项 | 说明 |
|----|------|
| **目标** | 保障支付和用户数据安全，防止数据丢失 |
| **数据库备份** | ① Supabase 自动备份（免费版每日一次，保留 7 天）；② 定期导出关键表（users/orders/credits）到 S3，频率每日一次；③ 生产环境考虑 Supabase Pro（$25/月，30 天 PITR） |
| **Webhook 容错** | ① Webhook 重试机制：Stripe 最多 3 天、Creem 24h、Waffo 8 次，`handleOrderPayment` 必须幂等（已纳入 P-1.3）；② 增加定时任务扫描 status=created 超过 1 小时的订单，主动查询渠道确认支付状态 |
| **服务降级** | Supabase 宕机时，前端 Landing Page 仍可展示（静态），但登录/支付/控制台不可用，显示维护提示页 |
| **涉及文件** | 新增 `lib/backup.ts`（导出逻辑）、`app/api/health/route.ts`（健康检查）、Vercel Cron Job 配置 |
| **注意** | Vercel Cron 仅 Pro 计划支持，Hobby 需改用 GitHub Actions schedule 或外部定时服务 |

#### 6.17 GDPR 数据隐私合规

| 项 | 说明 |
|----|------|
| **目标** | 满足海外用户数据隐私要求 |
| **用户数据删除权** | 新增 `app/api/user/delete-account/route.ts`，用户可删除账号。删除时：① 软删除 users 表记录；② 保留 orders/credits 记录（财务合规要求）；③ 清除个人信息（nickname、avatar_url、email 改为 `deleted+{uuid}@deleted.com` 唯一值，避免违反 UNIQUE(email, provider) 约束） |
| **Cookie 同意** | Landing Page 加 Cookie 同意横幅，用户同意后才加载 GA/PostHog 追踪脚本 |
| **数据保留策略** | ① 用户数据保留至账号删除；② 订单/财务数据保留 7 年（税务合规）；③ 积分流水保留至过期后 1 年 |
| **隐私政策更新** | 当前隐私政策是静态页面，需改为动态内容，明确列出收集的数据类型、用途、保留期限、第三方服务（支付渠道/Supabase/GA/PostHog）的数据处理 |
| **涉及文件** | `app/[locale]/(default)/settings/`（删除账号入口）、`components/cookie-consent/`（Cookie 横幅）、`app/(legal)/`（隐私政策重写） |

---

### P3 - 工程化 & 安全

#### 6.18 API 限流

| 项 | 说明 |
|----|------|
| **目标** | 防止 AI API 滥用，按用户/IP 限流 |
| **技术** | Upstash Ratelimit（Redis-based，Serverless 友好） |
| **涉及文件** | 新增 `lib/ratelimit.ts`，在 `app/api/demo/` 和后续 AI API 中引入 |
| **策略** | 免费用户 10 次/天，付费用户 100 次/天，按积分另算 |
| **环境变量** | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` |

#### 6.19 错误监控

| 项 | 说明 |
|----|------|
| **目标** | 生产环境错误自动上报 |
| **技术** | 已并入 6.5 埋点方案：PostHog 错误追踪（异常 + breadcrumb + 崩溃前回放）替代原 Sentry 方案，减少一个系统 |
| **涉及文件** | `lib/telemetry/*`（复用 6.5 的追踪抽象层） |

#### 6.20 操作审计日志

| 项 | 说明 |
|----|------|
| **目标** | 后台所有操作可追溯 |
| **涉及文件** | 新增 `models/audit_log.ts`、`lib/audit.ts`（装饰器/中间件），在所有 admin API 中调用 |
| **记录内容** | 操作人、操作类型、目标对象、详情、IP、时间 |

#### 6.21 Webhook 安全增强

| 项 | 说明 |
|----|------|
| **目标** | 各渠道 Webhook 签名验证 + 事件覆盖 |
| **涉及文件** | `app/api/stripe-notify/route.ts`（补充事件）、`app/api/creem-notify/route.ts`、`app/api/waffo-notify/route.ts` |
| **补充事件** | Stripe：`customer.subscription.deleted` / `invoice.paid` / `charge.refunded`；Creem：`subscription.canceled` / `subscription.paid` / `refund.created`；Waffo：`REFUND_NOTIFICATION` / `SUBSCRIPTION_STATUS_NOTIFICATION` |
| **注意** | 各渠道验签方式不同（Stripe constructEventAsync / Creem HMAC / Waffo RSA），适配器 `parseWebhook()` 内消化 |

#### 6.22 CSRF 防护

| 项 | 说明 |
|----|------|
| **目标** | 非 GET API 请求需 CSRF token |
| **技术** | NextAuth 自带 CSRF（Auth.js v5），自定义 API 需补充 |
| **方案** | 使用 `next/headers` cookies + Origin 校验 |
| **注意** | **必须排除 webhook 端点**（`/api/*-notify` 是服务端到服务端 POST，无 cookie/Origin，已靠签名验证保护）；CSRF 中间件误伤会导致支付回调失败 |
| **状态** | ✅ 已落地并加固（第十九批，2026-09-01）：middleware Origin 校验 + 豁免精确化 + `NEXT_PUBLIC_WEB_URL` 钉死 + 生产 http 降级拒绝；防护矩阵成文 docs/02；测试 `__tests__/middleware-csrf.test.ts`（另见 docs/02 §认证机制 P3-4 关闭注记） |

#### 6.23 可观测性与告警（日志采集 + 支付告警 + 飞书/企微机器人）

> 设计文档：[docs/16-observability-alerting.md](./docs/16-observability-alerting.md)（2026-08 新增）

| 项 | 说明 |
|----|------|
| **目标** | ① 运营事件日志自有化（op_events 表），后台可检索可绘图；② 支付渠道异常实时告警 + 自动切换闭环；③ 飞书/企微机器人推送 critical 事件 |
| **日志底座** | `op_events` 表（迁移 0012）+ `lib/oplog.ts`（fire-and-forget，与 telemetry 同纪律）；8 类资金/安全事件接入 |
| **支付告警闭环** | health.ts 标记 unhealthy 时 -> op_events + 机器人告警（含剩余渠道与处置指引）；**自动摘除已实现，永久禁用人工决定**（防自己代码 bug 误杀渠道） |
| **通知** | `lib/notify/`：Notifier 抽象 + 飞书（卡片消息，可选 HMAC 签名）+ 企微（markdown）+ 抑制（同 key 30min 一次）；环境变量 `FEISHU_WEBHOOK_URL` / `WECOM_WEBHOOK_URL` / `NOTIFY_MIN_SEVERITY` |
| **后台** | `/admin/payment`（渠道开关/priority/健康状态/24h 成败计数 + payment_products 编辑）+ `/admin/logs`（事件检索） |
| **明确不做** | 通用 event bus 框架、多实例 Redis 抑制（v1 内存，注释标升级路径）、Slack/Telegram、ELK 式全文检索 |

---

## 六-补、安全修复（P-1：功能开发之前必须完成）

> 以下问题来自三轮对抗式审查（审查报告已全部合并至本文档，临时审查文档已删除），经评估全部合理。
> 这些是现有代码的安全漏洞和架构缺陷，必须在任何新功能开发之前修复。

> ⚠️ **P-1 阶段的管理员鉴权**：本阶段涉及管理员操作（P-1.1 定价管理、6.1 支付渠道热切换、6.9 积分补偿）。RBAC 在 P1（6.10）才落地，P-1 阶段沿用现状 `ADMIN_EMAILS` 环境变量白名单 + session email 校验作为过渡方案，RBAC 落地后替换（见 docs/01-architecture.md §4.3）。

### P-1.1 定价架构修复（根因）

| 项 | 说明 |
|----|------|
| **问题** | 定价数据放在 i18n JSON 中，服务端无法校验价格。Checkout API 信任客户端传入的 amount/credits，可被 0 成本攻击 |
| **方案** | 新增 `data/pricing.ts` 服务端定价常量表（或数据库 products 表），Checkout API 根据 product_id 从服务端查询真实价格，忽略客户端传入值 |
| **涉及文件** | 新增 `data/pricing.ts`、修改 `app/api/checkout/route/route.ts`、i18n pricing 节点改为引用服务端数据 |
| **额外修复** | `cn_amount` 字段定义了但从未使用（checkout 不读它），给人支持人民币定价的假象。定价架构修复时**删除**：i18n JSON 的 cn_amount 字段 + `types/blocks/pricing.d.ts` 的 cn_amount 类型。v1 明确单一 USD 价，多币种/地区定价不做 |
| **优先级** | **最高，其他安全修复的前置条件** |

### P-1.2 积分扣减安全

| 项 | 说明 |
|----|------|
| **问题 1** | decreaseCredits 不检查余额，并发请求可透支。显示时 Math.max(0) 遮盖负数但 DB 层面已透支 |
| **方案 1** | 扣减前检查余额，不足时返回错误；用 Supabase RPC + 行锁实现原子性「检查+扣减」 |
| **问题 2** | FIFO 扣减算法将原始积分的 expired_at 复制到负数记录上。当原始积分过期后，负数记录同时过期被排除查询，导致已消耗的积分"复活"，余额凭空增加 |
| **方案 2** | 负数扣减记录不设 expired_at（设为 NULL 或远期时间），扣减是永久消费行为，不应随原始积分过期而消失。查询有效积分时对负数记录不做 expired_at 过滤 |
| **问题 3** | 文档（docs/03-database-schema.md）描述积分查询含 `credits > 0` 过滤，但实际代码无此过滤。需同步修正文档 |
| **方案 3** | 修正文档，删除 `credits > 0` 过滤条件说明。实际代码累加正负记录计算净余额是正确的
| **涉及文件** | `services/credit.ts`、`app/api/ping/route.ts`、新增 Supabase 存储过程 |
| **优先级** | **最高** |

### P-1.3 支付处理事务化

| 项 | 说明 |
|----|------|
| **问题** | Webhook 处理三步（更新订单+充值积分+记录联盟）无事务，中间失败导致数据不一致 |
| **方案** | 用 PostgreSQL 存储过程包在一个事务中，或用 Supabase rpc() 调用（依赖 P-1.12 最小迁移机制落地存储过程） |
| **额外修复 1** | `updateOrderStatus` 未检查订单是否已为 paid 状态，Stripe Webhook 重试时 paid_at/paid_detail 被覆盖。事务化时一并加入幂等检查 |
| **额外修复 2** | `models/order.ts` 的 `OrderStatus` 枚举只有 created/paid/deleted，补 `expired`（超时未支付）和 `refunded`（退款），供 6.16 定时任务与退款流程使用 |
| **涉及文件** | `services/order.ts`、`models/order.ts`、新增 Supabase 存储过程 `handle_order_payment()` |
| **优先级** | **最高** |

### P-1.4 认证安全修复

| 项 | 说明 |
|----|------|
| **问题 1** | /api/update-invite 无认证，依赖请求体 user_uuid |
| **方案 1** | 从 NextAuth session 获取 user_uuid，删除请求体参数 |
| **问题 2** | Demo AI 接口无认证无限流无积分检查 |
| **方案 2** | 废弃 `/api/demo/*`，重构为 `/api/v1/ai/demo` 匿名演示端点（IP+指纹限次）+ `/api/v1/ai/generate` 正式端点（登录+积分）。见 docs/13、docs/14 |
| **涉及文件** | `app/api/update-invite/route.ts`、`app/api/demo/*/route.ts` |
| **优先级** | **高** |

### P-1.5 API Key hash 存储

| 项 | 说明 |
|----|------|
| **问题** | API Key 明文存储，DB 泄露即全部密钥泄露 |
| **方案** | 存储 SHA-256 hash，查询时 hash 匹配；创建时仅展示一次完整密钥 |
| **涉及文件** | `models/apikey.ts`、`types/apikey.d.ts`、控制台 API Key 页面 |
| **优先级** | **中高** |

### P-1.6 配置安全修复

| 项 | 说明 |
|----|------|
| **问题 1** | reactStrictMode: false |
| **方案 1** | 改为 true |
| **问题 2** | images.hostname: "*" |
| **方案 2** | 限制为已知域名（Google/GitHub 头像、S3 CDN） |
| **问题 3** | Middleware 语言列表含 14 种但实际只支持 en/zh |
| **方案 3** | matcher 只列 en/zh |
| **问题 4** | output: "standalone" 与 next start 冲突 |
| **方案 4** | Vercel 部署去掉 standalone，或环境变量条件控制 |
| **涉及文件** | `next.config.mjs`、`middleware.ts` |
| **优先级** | **中** |

### P-1.7 环境变量校验 + 日志封装

| 项 | 说明 |
|----|------|
| **问题 1** | 无环境变量校验，缺失必填项启动不报错 |
| **方案 1** | 用 zod 在启动时校验，缺失直接 fail fast |
| **问题 2** | console.log 作为唯一日志手段 |
| **方案 2** | 封装 lib/logger.ts，为 PostHog 错误追踪 / 结构化日志做准备 |
| **涉及文件** | 新增 `lib/env.ts`、`lib/logger.ts` |
| **优先级** | **中高** |

### P-1.8 基础设施补齐（不含 ORM 迁移）

| 项 | 说明 |
|----|------|
| **问题 1** | 无外键约束 + 缺索引 |
| **方案 1** | 通过 SQL `ALTER TABLE` 添加外键约束和高频查询索引（不依赖 ORM） |
| **问题 2** | Supabase Client 每次调用都新建 |
| **方案 2** | 改为模块级单例，避免重复创建 HTTP 连接池 |
| **问题 3** | UserCredits 幽灵字段（one_time_credits 等始终 undefined） |
| **方案 3** | 删除未实现的字段，保持类型与实际行为一致 |
| **问题 4** | 联盟奖励逻辑错误（reward_amount 固定 $50 而非按比例计算） |
| **方案 4** | 改为 `reward_amount = min(order.amount * reward_percent / 100, max_reward)`，明确语义；`AffiliateRewardPercent.Paied` 拼写改 `Paid` |
| **问题 5** | orders 表两种时间格式混用（ISO 字符串 vs Unix 秒），脆弱易错；`getTimestamp`(秒) 与 `getMillisecond`(毫秒) 并存 |
| **方案 5** | 统一 timestamptz + ISO 字符串；若必须存 Unix 时间戳则在 types 注释标注单位，废弃 `getMillisecond` |
| **问题 6** | 死代码与拼写：`getPaiedOrders` 拼错、`models/order.ts` 三个函数含被注释的过期过滤、`lib/resp.ts` 冗余赋值 |
| **方案 6** | 清理死代码，重命名 `getPaidOrders`，移除误导性注释 |
| **问题 7** | S3 存储 key 硬编码 `"shipany/"` 前缀（`app/api/demo/gen-image/route.ts`），模板复用后多项目共用 bucket 时文件互相污染 |
| **方案 7** | 改为环境变量 `STORAGE_PREFIX` 动态前缀（默认项目名），图片上传 key 为 `${STORAGE_PREFIX}/${filename}` |
| **涉及文件** | `data/install.sql`（补充 ALTER）、`models/db.ts`、`types/user.d.ts`、`services/affiliate.ts`、`services/constant.ts`、`models/order.ts`、`lib/time.ts`、`lib/resp.ts`、`lib/storage.ts`、`app/api/demo/gen-image/route.ts` |
| **优先级** | **中高** |

> **Drizzle ORM + 数据库迁移系统**已降级到阶段 5（P3 工程化），当前阶段聚焦基础设施和功能完善。

### P-1.9 测试基础设施

| 项 | 说明 |
|----|------|
| **问题** | 零测试文件，核心业务逻辑无回归保障 |
| **方案** | 引入 Vitest，优先测试：FIFO 积分扣减、支付处理流程、用户创建幂等性、定价校验 |
| **E2E 补充** | 支付全链路（checkout→webhook→积分充值→联盟奖励）单测覆盖不了真实签名/重试/事务，补一条 E2E：Stripe test mode + `stripe listen` 转发 + playwright 全流程断言 |
| **涉及文件** | 新增 `vitest.config.ts`、`__tests__/` 目录、`e2e/` 目录 |
| **优先级** | **中** |

### P-1.12 最小数据库迁移机制

| 项 | 说明 |
|----|------|
| **问题** | P-1.3 需创建 PostgreSQL 存储过程（本身就是数据库迁移），但 Drizzle 迁移系统在 P3，形成循环依赖——P-1.3 无法独立落地 |
| **方案** | P-1 阶段先落地**最小迁移方案**：`data/migrations/` 目录 + 顺序执行 SQL 文件 + `schema_migrations` 版本表（~30 行代码），无回滚能力（向前迁移 + 手工回滚）。Drizzle 留 P3 做类型化升级 |
| **涉及文件** | 新增 `data/migrations/`、`lib/migrate.ts`（启动时检查并执行未应用迁移） |
| **优先级** | **最高**（P-1.3 的前置条件） |

### P-1.10 CORS 配置

| 项 | 说明 |
|----|------|
| **问题** | API 支持通过 API Key 从外部调用，但未配置 CORS。浏览器跨域请求会被拦截 |
| **方案** | 新增 `middleware.ts` 中的 CORS 处理或独立 CORS 中间件，允许配置的域名访问 API 路由 |
| **涉及文件** | `middleware.ts` 或新增 `lib/cors.ts` |
| **环境变量** | `CORS_ALLOWED_ORIGINS`（逗号分隔的允许域名列表） |
| **优先级** | **中** |

### P-1.11 认证与 ID 生成安全

| 项 | 说明 |
|----|------|
| **问题 1** | Google One-Tap 验证不校验 `aud`（audience），攻击者用自己应用的合法 Google token 即可伪造任意 email 登录；且 `tokeninfo` 端点已被 Google deprecated |
| **方案 1** | 改用 `google-auth-library` 的 `verifyIdToken({ idToken, audience: googleClientId })`，内部校验 aud/iss/exp |
| **问题 2** | `getSnowId()` 的 workerId 硬编码为 1，Vercel serverless 多实例并发时同毫秒生成重复 ID，`order_no` 唯一约束冲突导致支付单创建失败 |
| **方案 2** | workerId 从环境变量注入（`SNOWFLAKE_WORKER_ID`），或订单号直接改用 `getUuid()`（碰撞概率可忽略） |
| **问题 3** | `findUserByEmail` 无 provider 维度，与「同邮箱多 provider」的 UNIQUE(email, provider) 设计冲突：同邮箱 Google+GitHub 登录被错误合并或触发唯一约束冲突 |
| **方案 3** | `findUserByEmail(email, provider)` 增加 provider 维度；saveUser 传 `user.signin_provider` |
| **问题 4** | 并发注册：两 tab 同时首次登录 → 双 insert → 一个违反唯一约束 → 用户 session 无 uuid，后续鉴权全部失败 |
| **方案 4** | insertUser 捕获唯一约束冲突后重查，或 Supabase `upsert` + `onConflict(email, signin_provider)` |
| **涉及文件** | `auth/config.ts`、`lib/hash.ts`、`services/user.ts`、`models/user.ts` |
| **优先级** | **最高**（问题 1 是认证致命漏洞） |

---

## 七、开发路线图

```
阶段 1：基础设施完善
├── ✅ Fork + 改名 + 克隆
├── ✅ Next.js 16 升级
├── ✅ Build 验证通过
├── ✅ 全套技术文档
├── 🔧 Supabase 项目创建 + 建表（代码侧就绪：data/install.sql + 迁移 0001~0009 + pnpm migrate；需用户创建 Supabase 项目并配置 DATABASE_URL）
├── 🔧 Google/GitHub OAuth 配置（代码侧就绪：auth/config.ts 全 Provider；需用户在 Google/GitHub 控制台创建应用并填入环境变量）
└── 🔧 本地 dev 跑通（登录 + Landing Page）（配置上述外部资源后 pnpm dev 即可）

阶段 1.5：安全修复（评审要求，功能开发前必须完成）
├── ✅ P-1.12 最小数据库迁移机制（data/migrations + schema_migrations + lib/migrate.ts + instrumentation 启动执行）
├── ✅ P-1.1 定价架构修复（data/pricing.ts 服务端定价 + Checkout 只信服务端 + 删 cn_amount）
├── ✅ P-1.2 积分扣减安全（decrease_credits 存储过程：行锁+余额校验+FIFO+负数 expired_at=NULL）
├── ✅ P-1.3 支付处理事务化（handle_order_payment 存储过程 + 幂等检查 + OrderStatus 补 expired/refunded）
├── ✅ P-1.4 认证安全（update-invite 改用 session + 删除 /api/demo/* 未认证端点）
├── ✅ P-1.5 API Key hash 存储（SHA-256 + 创建时仅展示一次）
├── ✅ P-1.6 配置安全（strictMode=true + images 白名单 + middleware en/zh + standalone 条件化）
├── ✅ P-1.7 环境变量校验（lib/env.ts zod fail fast）+ 日志封装（lib/logger.ts）
├── ✅ P-1.8 基础设施（单例 + 幽灵字段 + 联盟比例奖励 + 时间格式 + 死代码清理 + STORAGE_PREFIX + FK/索引迁移）
├── ✅ P-1.9 测试基础设施（Vitest 18 用例：FIFO RPC 契约/支付流程/定价/哈希/env；支付 E2E 见 docs/12 §2.6 补充说明）
├── ✅ P-1.10 CORS 配置（middleware API 路由 + CORS_ALLOWED_ORIGINS）
├── ✅ P-1.11 认证与 ID 生成安全（One-Tap aud 校验 + Snowflake 单例/workerId + provider 维度 + 并发注册兜底）
└── ✅ 阶段 1.5 完成（tsc 类型检查 + Vitest + next build 验证通过）

阶段 2：P0 核心功能
├── ✅ AI 网关闭环 v1（/api/v1/ai/generate：鉴权→限流→402→原子扣减→模型路由→生成→失败退款；data/model-pricing.ts 白名单 + lib/ai/registry.ts；流式/图片/视频 v2）
├── ✅ 免费试用额度 v1（/api/v1/ai/demo：匿名 IP+设备指纹限次，用完 429 提示登录；anonymous_usage 表 + 原子递增 RPC；登录赠 10 积分沿用现有逻辑）
├── ✅ 多支付渠道 阶段 1（6.1：lib/payment Provider 抽象 + stripe/creem/waffo 适配器 + payment_settings 热切换 + /api/checkout 统一入口 + /api/payment-methods + creem/waffo webhook）
├── ✅ 邮件通知系统 v1（6.2：lib/email Provider 抽象 + Resend + welcome/payment_success/credit_low/credit_exhausted 模板 + fire-and-forget 触发点）
├── ✅ 反馈按钮（6.3：components/feedback/crisp.tsx + NEXT_PUBLIC_CRISP_WEBSITE_ID）
├── ✅ 邮箱密码登录 v1（6.4：Credentials Provider + bcryptjs + 验证码注册/重置 + 登录失败锁定）
└── ✅ 埋点与监控 v1（6.5：lib/telemetry 抽象 + PostHog Provider + 漏斗埋点 t1/t2/t3 + 身份缝合）

阶段 3：P1 后台强化
├── ✅ 数据看板（6.6：services/stats.ts + /api/admin/stats + SVG 图表 6 指标卡 + 30 天趋势）
├── ✅ 用户管理 CRUD（6.7：搜索/分页/详情/角色/封禁/调积分 + PUT /api/admin/user + POST /api/admin/user/credits）
├── ✅ 订单管理增强（6.8：搜索/退款（按渠道分发）/CSV 导出 + POST /api/admin/refund）
├── ✅ 积分管理（6.9：流水列表 + 调整页 + adjustCreditsByAdmin）
└── ✅ RBAC 权限系统（6.10：users.role + lib/auth.ts + 迁移 0008）

阶段 4：P2 体验增强
├── ✅ 用户个人资料（6.11：settings 页 + PUT /api/user/profile + S3 头像上传）
├── ✅ 订阅管理 v1（6.12：订阅页展示状态，取消/门户走 Provider 接口预留；订阅功能 v1 不启用）
├── ✅ 用量统计（6.13：usage 页按日/周/月聚合 + API 调用记录）
├── ✅ 通知中心 v1（6.14：notifications 表 + API + 30s 轮询页；SSE v2）
├── ✅ 搜索（6.15：/api/search 博客模糊搜索 + 帖子页搜索框；后台搜索已随 6.7/6.8 落地）
├── ✅ 数据备份与灾难恢复（6.16：lib/backup.ts + /api/health + /api/cron/daily + vercel.json Cron + 超时订单扫描）
└── ✅ GDPR 数据隐私合规（6.17：删除账号 API + Cookie 同意横幅 + GA/PostHog 同意后加载）

阶段 5：P3 工程化
├── ✅ Drizzle ORM 基础（db/schema.ts 类型化定义 + drizzle.config.ts + pnpm db:generate；数据访问层渐进升级，见 2.1 诚实标注）
├── ✅ API 限流（6.18：Upstash Ratelimit + 内存降级 + 用户分级配额 免费 10/天 付费 100/天）
├── ✅ 错误监控（PostHog，已并入 6.5，6.19）
├── ✅ 审计日志（6.20：admin/audit-logs 查看页 + lib/audit.ts 写操作记录）
├── ✅ Webhook 安全增强（6.21：stripe charge.refunded / creem refund.created + subscription 事件记录 + services/refund.ts 共用退款）
├── ✅ CSRF 防护（6.22：middleware Origin 校验，豁免 webhook/cron 端点）
└── ✅ 支付路由（自动 failover，6.1 阶段 3：lib/payment/health.ts 健康检测 + unhealthy 跳过）
```

### 文档同步约定（重要）

> 总纲改动必须同步对应子文档，反之亦然。每完成一个 P-1 / P0 项，检查并更新下列映射，避免现状文档持续漂移。

| 总纲章节 | 同步的子文档 |
|----------|-------------|
| 四、数据库 Schema | docs/03-database-schema.md |
| 5.1~5.9 功能清单 | docs/01/02/04/05/06 |
| 6.1 支付架构 | docs/payment/provider-abstraction.md + 渠道对接文档 |
| 6.2 邮件 | docs/10-email-system.md |
| 6.4 密码登录 | docs/04-auth-flow.md |
| 6.5 埋点 | docs/11-telemetry-analytics.md |
| 八、环境变量 | docs/08-config-env.md（单一真相源） |
| 部署相关 | docs/07-deployment.md |

### 审查结论跟踪约定（重要）

> 历轮架构审查的结论统一维护在 [docs/12-architecture-adversarial-review.md](./docs/12-architecture-adversarial-review.md)（遗留项跟踪表）。每轮审查完成后：

1. 已采纳的建议 → 落地到对应文档，跟踪表标注 ✅ + 指向
2. 未采纳的建议 → 跟踪表标注 ❌ + 理由，或 ⬜ 待落地 + 优先级
3. 审查结论若被后续修改推翻 → 更新跟踪表，**不允许留过时结论**
4. 所有待落地项 → 同步进 DEVELOPMENT_PLAN 的 P-1/P0/P1 对应章节

---

## 八、环境变量清单

> **完整清单（单一真相源）见 [docs/08-config-env.md](./docs/08-config-env.md)**，含已有变量、待新增变量（WAFFO_*/POSTHOG_*/CREDIT_LOW_THRESHOLD 等）及废弃变量说明。新文档引入变量时须同步登记到 docs/08，避免多源漂移。

---

## 九、已知问题 & 风险

> ⚠️ 三轮对抗式审查的发现已全部合并入本文档：第一轮（P-1.1~P-1.10）、第二轮（支付架构/退款/订阅口径）、第三轮（P-1.11 认证与 ID 安全）。以下为未纳入 P-1 的其余风险。

| # | 问题 | 影响 | 应对 |
|---|------|------|------|
| 1 | `next dev` 在沙箱内 EMFILE 循环重启 | 仅影响 Codex 沙箱调试 | 用户本地终端运行不受影响；沙箱内用 `next build && next start` |
| 2 | next-auth 5.0.0-beta.25 是 beta 版 | 可能有 breaking change | 持续关注 Auth.js v5 正式版发布 |
| 3 | Supabase Client 无 ORM | 数据模型无类型推导 | 阶段 5 引入 Drizzle ORM |
| 4 | Tailwind v3（非 v4） | 功能差异 | 暂不升级，v4 迁移成本大且无紧急需求 |
| 5 | 订阅跨渠道迁移无法自动化 | 渠道被封时订阅用户需重绑卡 | 主推积分包；订阅迁移走「邮件 + 重绑 + 积分补偿」SOP（见 6.1） |
| 6 | MoR 渠道费率偏高（Creem 3.9% / Waffo 4.5%） | 利润率低 | 阶段 2 注册美国公司后切 Stripe 降本 |
| 7 | S3 有 SDK 无 UI | 用户无法上传文件 | 6.11 个人资料时补 UI |
| 8 | `output: standalone` 与 `next start` 冲突 | production 启动方式 | **P-1.6 已纳入**（配置安全修复） |
| 9 | Cloudflare 部署兼容性 | @cloudflare/next-on-pages 可能不支持 Next 16 | 暂以 Vercel 为首选 |
| 10 | 通知中心依赖 Realtime | 需客户端 anon key + RLS，当前架构未配 | 6.14 改用轮询 + SSE，避开 Realtime 依赖 |
| 11 | 联盟奖励只记录不发放 | 邀请人拿不到奖励 | 5.9 已标注待设计，发放闭环见 docs/05 §3.4 |

---

## 十、评审要点（供 LLM 评估）

1. **技术栈合理性**：Next.js 16 + Tailwind 3 + shadcn/ui + Supabase + NextAuth + 多支付渠道（Creem/Waffo）是否是 AI SaaS 的最优选型？
2. **架构可扩展性**：models/services/types 三层 + Provider 抽象层（支付/邮件/埋点同构）能否支撑后续功能扩展？
3. **支付渠道架构**：Provider 抽象层 + payment_settings 热切换 + payment_products 定价映射，能否支撑「Creem/Waffo → Stripe/PayPal → 支付路由」三阶段演进？
4. **渠道战略定位**：阶段 1 用 Creem+Waffo 双 MoR 的 Card 能力重叠，主推 Waffo（内置智能路由 + 有退款 API）是否合理？
5. **邮件系统选型**：Resend 是否优于 AWS SES / Postmark？事务/营销分离与续费提醒合规（ROSCA/ARL）是否完整？
6. **埋点选型**：PostHog 单工具替代「GA4 产品分析 + Sentry 错误监控」是否合理？GA4 仅做广告归因的边界是否清晰？
7. **RBAC 方案**：users 表加 role 字段 vs 独立 user_roles 表，哪个更合适？
8. **订阅 + 积分模型**：续费充值、取消回收、退款扣回的口径是否清晰？跨渠道迁移 SOP 是否可接受？
9. **优先级排序**：P-1（安全修复）→ P0 → P3 的划分是否合理？有无遗漏的关键功能？
10. **部署策略**：Vercel 首选 + Cloudflare 备选的方案是否可靠？Vercel Cron 需 Pro 计划、standalone 冲突等工程细节是否已覆盖？

# my-shipany-template 开发方案

> 基于 ShipAny 开源版（ShipAny One）打造的 AI SaaS 模板项目。
> 本文档梳理已有功能、待完成功能、技术选型及开发路线，供团队和 LLM 评审。

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
| **语言** | TypeScript | 5.7.2 | 全量类型安全 |
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
| **分析** | Google Analytics + OpenPanel | - | 双通道 |
| **MDX** | @next/mdx | 16.3.1 | 博客内容渲染 |
| **编辑器** | @uiw/react-md-editor | 4.0.x | 后台博文编辑 |
| **包管理** | pnpm | 11.x | |
| **部署** | Vercel / Cloudflare / Docker | - | output: standalone |

### 2.2 待引入技术栈（规划中）

| 用途 | 技术 | 选型理由 |
|------|------|----------|
| **Creem 支付** | Creem API | 用户无海外卡，Creem 支持支付宝；与 Stripe 共存 |
| **邮件服务** | Resend + React Email | Vercel 生态首选，React Email 做模板，免费额度够用 |
| **反馈/客服** | Crisp | ShipAny 官网同款，免费版够用，接入简单 |
| **限流** | Upstash Ratelimit | Vercel 生态，Redis-based，Serverless 友好 |
| **错误监控** | Sentry | Next.js 官方支持，免费额度 |
| **图表** | recharts 或 @tremor/react | 后台数据看板可视化 |
| **表单验证** | zod + react-hook-form | 已有 zod，补充表单场景 |
| **邮箱密码登录** | NextAuth Credentials Provider + Resend 验证码 | 补充非 OAuth 登录方式 |

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

### 4.1 现有表（6 张）

```sql
-- 用户表
users (id, uuid, email, nickname, avatar_url, locale,
       signin_type, signin_ip, signin_provider, signin_openid,
       invite_code, invited_by, is_affiliate, created_at, updated_at)

-- 订单表
orders (id, order_no, user_uuid, user_email, amount, interval,
        credits, currency, status, stripe_session_id,
        sub_id, sub_interval_count, sub_cycle_anchor,
        sub_period_end, sub_period_start, sub_times,
        product_id, product_name, valid_months,
        order_detail, paid_at, paid_email, paid_detail, created_at, expired_at)

-- 积分流水表
credits (id, trans_no, user_uuid, trans_type, credits, order_no,
         expired_at, created_at)

-- API Key 表
apikeys (id, api_key, title, user_uuid, status, created_at)

-- 博客文章表
posts (id, uuid, slug, title, description, content, status,
       cover_url, author_name, author_avatar_url, locale,
       created_at, updated_at)

-- 联盟营销表
affiliates (id, user_uuid, invited_by, status, paid_order_no,
            paid_amount, reward_percent, reward_amount, created_at)
```

### 4.2 表结构变更（多支付渠道）

现有 `orders` 表包含 Stripe 专属字段（stripe_session_id, sub_id 等），无法适配多渠道。拆分为共享表 + 渠道专属表：

```sql
-- orders 表变更：新增 payment_provider，移除 Stripe 专属字段
ALTER TABLE orders ADD COLUMN payment_provider VARCHAR(50) DEFAULT 'stripe';
-- stripe_session_id, sub_id, sub_interval_count, sub_cycle_anchor,
-- sub_period_end, sub_period_start, sub_times 迁移到 stripe_orders 表

-- Stripe 专属表
CREATE TABLE stripe_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,
    stripe_session_id VARCHAR(255),
    sub_id VARCHAR(255),
    sub_interval_count INT,
    sub_cycle_anchor INT,
    sub_period_end INT,
    sub_period_start INT,
    sub_times INT,
    created_at timestamptz
);

-- Creem 专属表
CREATE TABLE creem_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,
    creem_checkout_id VARCHAR(255),
    creem_subscription_id VARCHAR(255),
    creem_payment_method VARCHAR(100),
    created_at timestamptz
);

-- 未来新增渠道只需加对应的 xxx_orders 表
```

### 4.3 待新增表

```sql
-- 站内通知
notifications (id, uuid, user_uuid, type, title, content,
               is_read, created_at)

-- 操作审计日志
audit_logs (id, admin_uuid, action, target_type, target_uuid,
            detail, ip, created_at)

-- 邮箱验证码
verification_codes (id, email, code, expired_at, used, created_at)

-- users 表加 role 字段（RBAC）
-- ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';
```

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

### 5.3 支付系统 ✅（Stripe 部分）

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| Stripe Checkout | ✅ 可用 | `app/api/checkout/route.ts` | 创建 Stripe Session |
| 一次性付款 | ✅ 可用 | - | interval: "one-time" |
| 订阅（月/年） | ✅ 可用 | - | interval: "month"/"year" |
| CNY 支付（微信/支付宝） | ✅ 可用 | checkout route | currency=cny 时自动启用 |
| 优惠码 | ✅ 可用 | - | `allow_promotion_codes: true` |
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

### 5.4 后台管理 ⚠️（基础版）

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| 管理员鉴权 | ✅ 可用 | `(admin)/layout.tsx` | ADMIN_EMAILS 环境变量 |
| 管理首页 | ⚠️ 空白 | `admin/page.tsx` | 只显示 "Admin System"，无数据 |
| 用户列表 | ⚠️ 只读 | `admin/users/` | 50 条分页，无搜索/编辑/封禁 |
| 付费订单列表 | ⚠️ 只读 | `admin/paid-orders/` | 无退款/导出 |
| 文章管理 | ✅ 完整 | `admin/posts/` | 列表 + 新增 + 编辑（Markdown 编辑器） |
| 数据看板 | ❌ 未实现 | - | 无用户数/收入/趋势统计 |
| 用户编辑/封禁 | ❌ 未实现 | - | |
| 手动调整积分 | ❌ 未实现 | - | |
| 订单退款 | ❌ 未实现 | - | |
| 系统设置 | ❌ 未实现 | - | |
| 操作日志 | ❌ 未实现 | - | |
| RBAC 角色管理 | ❌ 未实现 | - | 仅 email 白名单 |
| 数据导出 | ❌ 未实现 | - | |

### 5.5 用户控制台 ✅

| 功能点 | 状态 | 实现文件 | 说明 |
|--------|------|----------|------|
| API Key 管理 | ✅ 可用 | `(console)/api-keys/` | 创建/列表 |
| 我的积分 | ✅ 可用 | `(console)/my-credits/` | 查看余额和流水 |
| 我的订单 | ✅ 可用 | `(console)/my-orders/` | 查看历史订单 |
| 我的邀请 | ✅ 可用 | `(console)/my-invites/` | 邀请码和奖励 |
| 个人资料编辑 | ❌ 未实现 | - | 无法修改昵称/头像 |
| 订阅管理 | ❌ 未实现 | - | 无法查看/取消订阅 |
| 用量统计 | ❌ 未实现 | - | 只有积分余额，无使用趋势 |
| 通知中心 | ❌ 未实现 | - | |

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
| 联盟营销 | ✅ | 邀请码 + 20% 奖励（上限 $50） |
| Google Analytics | ✅ | 环境变量配置 |
| OpenPanel 分析 | ✅ | 环境变量配置 |
| S3 存储 SDK | ⚠️ | 有客户端封装，无上传 UI |
| 主题切换 | ✅ | 亮/暗色，next-themes |
| 法律页面 | ✅ | 隐私政策 + 服务条款 |
| Docker 部署 | ✅ | Dockerfile + standalone output |
| Cloudflare 部署 | ✅ | wrangler 配置 |

---

## 六、待完成功能详细方案

### P0 - 核心必须

#### 6.1 多支付渠道集成（Stripe + Creem + 未来扩展）

**设计原则**：支付渠道会持续增加（Stripe、Creem、PayPal、微信支付等），不同渠道的 Session ID、订阅模型、Webhook 格式、退款 API 各不相同。不能强行塞进一张表，采用**共享订单表 + 渠道专属表**的分离设计。

**数据库表设计**：

```sql
-- 1. orders 表（共享，去掉 Stripe 专属字段）
ALTER TABLE orders
  ADD COLUMN payment_provider VARCHAR(50) DEFAULT 'stripe',
  -- 删除 stripe 专属字段：stripe_session_id, sub_id, sub_interval_count,
  -- sub_cycle_anchor, sub_period_end, sub_period_start, sub_times
  -- 保留共享字段：order_no, user_uuid, amount, credits, currency,
  -- status, product_id, product_name, valid_months, created_at, expired_at,
  -- paid_at, paid_email, order_detail, paid_detail

-- 2. stripe_orders 表（Stripe 专属）
CREATE TABLE stripe_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,  -- 关联 orders.order_no
    stripe_session_id VARCHAR(255),
    sub_id VARCHAR(255),
    sub_interval_count INT,
    sub_cycle_anchor INT,
    sub_period_end INT,
    sub_period_start INT,
    sub_times INT,
    created_at timestamptz
);

-- 3. creem_orders 表（Creem 专属）
CREATE TABLE creem_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,  -- 关联 orders.order_no
    creem_checkout_id VARCHAR(255),
    creem_subscription_id VARCHAR(255),
    creem_payment_method VARCHAR(100),
    created_at timestamptz
);
```

**架构分层**：

```
                         前端 Pricing 区块
                              │
                              ▼
                    POST /api/checkout
                    （统一入口）
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
           Stripe 分支    Creem 分支   未来渠道分支
                 │            │            │
                 ▼            ▼            ▼
          创建 Stripe    创建 Creem    创建 XXX
          Session       Checkout      Session
                 │            │            │
                 ▼            ▼            ▼
          INSERT orders (payment_provider = 'stripe'/'creem'/'xxx')
          INSERT stripe_orders / creem_orders / xxx_orders
                 │            │            │
                 ▼            ▼            ▼
          /api/stripe-   /api/creem-   /api/xxx-
          notify         notify        notify
                 │            │            │
                 └────────────┼────────────┘
                              ▼
                    services/order.ts
                    handleOrderSession()
                    （统一：更新订单状态 + 充值积分 + 联盟奖励）
```

**前端渠道选择策略**：
- 环境变量 `NEXT_PUBLIC_PAYMENT_PROVIDER` 配置可用渠道：`stripe` / `creem` / `stripe,creem`
- 若多渠道可用，前端 Pricing 区块显示支付方式选择（或根据用户地区自动推荐）
- 若单渠道，直接跳转该渠道 Checkout

**Webhook 统一处理**：
- 每个渠道有独立的 `/api/{provider}-notify` 端点（签名验证方式不同）
- 验签通过后，统一调用 `services/order.ts` 的 `handleOrderSession()` 处理订单
- `handleOrderSession` 只操作共享的 `orders` + `credits` + `affiliates` 表，不关心渠道

**退款处理**：
- 每个渠道的退款 API 不同，`services/order.ts` 新增 `refundOrder(order_no)` 函数
- 内部根据 `orders.payment_provider` 分发到对应渠道的退款逻辑
- 退款成功后统一扣回积分 + 更新订单状态

| 项 | 说明 |
|----|------|
| **目标** | 多支付渠道架构，当前支持 Stripe + Creem，未来可扩展 |
| **原因** | 用户无海外信用卡，Creem 支持支付宝；后续可能对接更多渠道 |
| **涉及文件** | 重构 `app/api/checkout/route.ts`（统一入口分发）、新增 `app/api/creem-checkout/route.ts`、新增 `app/api/creem-notify/route.ts`、重构 `services/order.ts`、重构 `models/order.ts`、新增 `models/stripe_order.ts`、新增 `models/creem_order.ts`、数据库迁移 SQL |
| **环境变量** | `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`NEXT_PUBLIC_PAYMENT_PROVIDER` |
| **风险** | ① Creem API 文档需确认 webhook 签名验证方式；② 现有 orders 表的 Stripe 专属字段需迁移到 stripe_orders 表，需编写数据迁移脚本 |

#### 6.2 邮件通知系统

| 项 | 说明 |
|----|------|
| **目标** | 关键事件发送邮件通知 |
| **技术** | Resend（API 发送）+ React Email（模板渲染） |
| **场景** | ① 欢迎邮件 ② 支付成功 ③ 积分不足提醒 ④ 订阅续费提醒 ⑤ 密码重置 |
| **涉及文件** | 新增 `lib/email.ts`（发送封装）、`emails/` 目录（React Email 模板）、在 `services/order.ts` 的 `handleOrderSession` 中触发邮件 |
| **环境变量** | `RESEND_API_KEY`、`EMAIL_FROM` |
| **依赖** | `resend`、`@react-email/components`、`@react-email/html` |

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
| **目标** | 支持邮箱 + 验证码注册/登录（无 OAuth 依赖） |
| **技术** | NextAuth Credentials Provider + Resend 发送验证码 |
| **涉及文件** | `auth/config.ts`（新增 Credentials Provider）、`app/api/send-verification/route.ts`（发送验证码）、`app/api/verify-code/route.ts`（验证码校验）、新增 `components/sign/email-form.tsx` |
| **新增表** | `verification_codes (id, email, code, expired_at, used, created_at)` |
| **流程** | 用户输入邮箱 -> 发送 6 位验证码 -> 验证码登录 -> NextAuth 建用户 |

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

---

### P1 - 后台管理强化

#### 6.5 数据看板

| 项 | 说明 |
|----|------|
| **目标** | Admin 首页展示核心指标和趋势图 |
| **技术** | recharts（轻量）或 @tremor/react（SaaS 风格） |
| **指标** | 总用户数 / 今日新增 / 总收入 / 今日订单 / 积分消耗 / 活跃用户 |
| **图表** | 30 天用户增长折线图、30 天收入柱状图、积分消耗趋势 |
| **涉及文件** | 重写 `app/[locale]/(admin)/admin/page.tsx`，新增 `components/dashboard/stats/` |

#### 6.6 用户管理 CRUD

| 项 | 说明 |
|----|------|
| **目标** | 管理员可搜索、查看详情、封禁/解封、修改角色、手动加积分 |
| **涉及文件** | 重写 `admin/users/page.tsx`（加搜索+分页），新增 `admin/users/[uuid]/page.tsx`（详情页），新增 `app/api/admin/user/route.ts` |
| **新增 API** | PUT /api/admin/user（更新用户）、POST /api/admin/user/credits（手动加积分） |
| **权限** | 仅 admin 可访问，操作记录到 audit_logs |

#### 6.7 订单管理增强

| 项 | 说明 |
|----|------|
| **目标** | 订单搜索、筛选、退款、CSV 导出 |
| **涉及文件** | 重写 `admin/paid-orders/page.tsx`，新增 `app/api/admin/refund/route.ts` |
| **退款流程** | 调 Stripe Refund API -> 更新 order status -> 扣回积分 |

#### 6.8 积分管理

| 项 | 说明 |
|----|------|
| **目标** | 后台查看用户积分流水，手动增减积分（带备注） |
| **涉及文件** | 新增 `admin/credits/page.tsx`（流水列表）、`admin/credits/adjust/page.tsx`（调整积分） |
| **API** | POST /api/admin/credits/adjust |

#### 6.9 RBAC 权限系统

| 项 | 说明 |
|----|------|
| **目标** | 从 email 白名单升级为角色系统 |
| **角色** | super_admin / admin / operator / user |
| **方案** | users 表加 `role` 字段（VARCHAR DEFAULT 'user'），middleware/layout 中检查角色 |
| **涉及文件** | `data/install.sql`（ALTER TABLE）、`(admin)/layout.tsx`、新增 `lib/auth.ts`（权限校验工具） |

---

### P2 - 用户体验增强

#### 6.10 用户个人资料

| 项 | 说明 |
|----|------|
| **目标** | 用户可修改昵称、头像、语言偏好、删除账号 |
| **涉及文件** | 新增 `(console)/settings/page.tsx`、`app/api/user/profile/route.ts` |
| **头像** | 接入 S3 上传 UI（当前只有 SDK 无 UI） |

#### 6.11 订阅管理

| 项 | 说明 |
|----|------|
| **目标** | 用户可查看/取消订阅、升级/降级套餐 |
| **涉及文件** | 新增 `(console)/subscription/page.tsx`、`app/api/stripe-portal/route.ts`（Stripe Customer Portal）或自建取消流程 |
| **Webhook 补充** | 处理 `subscription.deleted`、`subscription.updated` 事件 |

#### 6.12 用量统计

| 项 | 说明 |
|----|------|
| **目标** | 展示积分使用历史、API 调用记录、按日/周/月统计 |
| **涉及文件** | 新增 `(console)/usage/page.tsx`，查询 credits 表聚合统计 |

#### 6.13 通知中心

| 项 | 说明 |
|----|------|
| **目标** | 站内通知：支付成功、积分变动、系统公告 |
| **技术** | Supabase Realtime（实时推送） |
| **涉及文件** | 新增 `models/notification.ts`、`components/notifications/`、`(console)/notifications/page.tsx` |

#### 6.14 搜索

| 项 | 说明 |
|----|------|
| **目标** | 全站博客搜索 + 后台用户/订单搜索 |
| **技术** | 简单方案：PostgreSQL LIKE / 全文索引；高级方案：Algolia |
| **涉及文件** | `app/api/search/route.ts`、后台各列表页加搜索框 |

#### 6.15 数据备份与灾难恢复

| 项 | 说明 |
|----|------|
| **目标** | 保障支付和用户数据安全，防止数据丢失 |
| **数据库备份** | ① Supabase 自动备份（免费版每日一次，保留 7 天）；② 定期导出关键表（users/orders/credits）到 S3，频率每日一次；③ 生产环境考虑 Supabase Pro（$25/月，30 天 PITR） |
| **Webhook 容错** | ① Stripe Webhook 重试机制：Stripe 自动重试最多 3 天，`handleOrderSession` 必须幂等（已纳入 P-1.3）；② 增加定时任务扫描 status=created 超过 1 小时的订单，主动查询 Stripe/Creem 确认支付状态 |
| **服务降级** | Supabase 宕机时，前端 Landing Page 仍可展示（静态），但登录/支付/控制台不可用，显示维护提示页 |
| **涉及文件** | 新增 `lib/backup.ts`（导出逻辑）、`app/api/health/route.ts`（健康检查）、Vercel Cron Job 配置 |

#### 6.16 GDPR 数据隐私合规

| 项 | 说明 |
|----|------|
| **目标** | 满足海外用户数据隐私要求 |
| **用户数据删除权** | 新增 `app/api/user/delete-account/route.ts`，用户可删除账号。删除时：① 软删除 users 表记录；② 保留 orders/credits 记录（财务合规要求）；③ 清除个人信息（nickname、avatar_url、email 改为 deleted@deleted.com） |
| **Cookie 同意** | Landing Page 加 Cookie 同意横幅，用户同意后才加载 GA/OpenPanel 追踪脚本 |
| **数据保留策略** | ① 用户数据保留至账号删除；② 订单/财务数据保留 7 年（税务合规）；③ 积分流水保留至过期后 1 年 |
| **隐私政策更新** | 当前隐私政策是静态页面，需改为动态内容，明确列出收集的数据类型、用途、保留期限、第三方服务（Stripe/Supabase/GA）的数据处理 |
| **涉及文件** | `app/[locale]/(default)/settings/`（删除账号入口）、`components/cookie-consent/`（Cookie 横幅）、`app/(legal)/`（隐私政策重写） |

---

### P3 - 工程化 & 安全

#### 6.15 API 限流

| 项 | 说明 |
|----|------|
| **目标** | 防止 AI API 滥用，按用户/IP 限流 |
| **技术** | Upstash Ratelimit（Redis-based，Serverless 友好） |
| **涉及文件** | 新增 `lib/ratelimit.ts`，在 `app/api/demo/` 和后续 AI API 中引入 |
| **策略** | 免费用户 10 次/天，付费用户 100 次/天，按积分另算 |
| **环境变量** | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` |

#### 6.16 错误监控

| 项 | 说明 |
|----|------|
| **目标** | 生产环境错误自动上报 |
| **技术** | Sentry (@sentry/nextjs) |
| **涉及文件** | `next.config.mjs`（Sentry 配置）、`sentry.client.config.ts`、`sentry.server.config.ts` |
| **环境变量** | `SENTRY_DSN` |

#### 6.17 操作审计日志

| 项 | 说明 |
|----|------|
| **目标** | 后台所有操作可追溯 |
| **涉及文件** | 新增 `models/audit_log.ts`、`lib/audit.ts`（装饰器/中间件），在所有 admin API 中调用 |
| **记录内容** | 操作人、操作类型、目标对象、详情、IP、时间 |

#### 6.18 Webhook 安全增强

| 项 | 说明 |
|----|------|
| **目标** | 统一 Webhook 签名验证，补充 Stripe 事件处理 |
| **涉及文件** | `app/api/stripe-notify/route.ts`（补充事件）、新增 `app/api/creem-notify/route.ts`（Creem 签名验证） |
| **补充事件** | `subscription.deleted`、`subscription.updated`、`invoice.paid`、`refund.created` |

#### 6.19 CSRF 防护

| 项 | 说明 |
|----|------|
| **目标** | 非 GET API 请求需 CSRF token |
| **技术** | NextAuth 自带 CSRF（Auth.js v5），自定义 API 需补充 |
| **方案** | 使用 `next/headers` cookies + Origin 校验 |

---

## 六-补、安全修复（P-1：功能开发之前必须完成）

> 以下问题来自架构评审（评审报告已合并至本章节，原文件已删除），经评估全部合理。
> 这些是现有代码的安全漏洞和架构缺陷，必须在任何新功能开发之前修复。

### P-1.1 定价架构修复（根因）

| 项 | 说明 |
|----|------|
| **问题** | 定价数据放在 i18n JSON 中，服务端无法校验价格。Checkout API 信任客户端传入的 amount/credits，可被 0 成本攻击 |
| **方案** | 新增 `data/pricing.ts` 服务端定价常量表（或数据库 products 表），Checkout API 根据 product_id 从服务端查询真实价格，忽略客户端传入值 |
| **涉及文件** | 新增 `data/pricing.ts`、修改 `app/api/checkout/route/route.ts`、i18n pricing 节点改为引用服务端数据 |
| **额外修复** | `cn_amount` 字段定义了但从未使用（checkout 不读它），给人支持人民币定价的假象。定价架构修复时一并处理：服务端定价表按 currency 返回正确金额 |
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
| **方案** | 用 PostgreSQL 存储过程包在一个事务中，或用 Supabase rpc() 调用 |
| **额外修复** | `updateOrderStatus` 未检查订单是否已为 paid 状态，Stripe Webhook 重试时 paid_at/paid_detail 被覆盖。事务化时一并加入幂等检查 |
| **涉及文件** | `services/order.ts`、`models/order.ts`、新增 Supabase 存储过程 `handle_order_payment()` |
| **优先级** | **最高** |

### P-1.4 认证安全修复

| 项 | 说明 |
|----|------|
| **问题 1** | /api/update-invite 无认证，依赖请求体 user_uuid |
| **方案 1** | 从 NextAuth session 获取 user_uuid，删除请求体参数 |
| **问题 2** | Demo AI 接口无认证无限流无积分检查 |
| **方案 2** | 加登录认证 + 积分扣减 + IP 限流 |
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
| **方案 2** | 封装 lib/logger.ts，为 Sentry 接入做准备 |
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
| **方案 4** | 改为 `reward_amount = min(order.amount * reward_percent / 100, max_reward)`，明确语义 |
| **涉及文件** | `data/install.sql`（补充 ALTER）、`models/db.ts`、`types/user.d.ts`、`services/affiliate.ts`、`services/constant.ts` |
| **优先级** | **中高** |

> **Drizzle ORM + 数据库迁移系统**已降级到阶段 5（P3 工程化），当前阶段聚焦基础设施和功能完善。

### P-1.10 CORS 配置

| 项 | 说明 |
|----|------|
| **问题** | API 支持通过 API Key 从外部调用，但未配置 CORS。浏览器跨域请求会被拦截 |
| **方案** | 新增 `middleware.ts` 中的 CORS 处理或独立 CORS 中间件，允许配置的域名访问 API 路由 |
| **涉及文件** | `middleware.ts` 或新增 `lib/cors.ts` |
| **环境变量** | `CORS_ALLOWED_ORIGINS`（逗号分隔的允许域名列表） |
| **优先级** | **中** |

### P-1.9 测试基础设施

| 项 | 说明 |
|----|------|
| **问题** | 零测试文件，核心业务逻辑无回归保障 |
| **方案** | 引入 Vitest，优先测试：FIFO 积分扣减、支付处理流程、用户创建幂等性、定价校验 |
| **涉及文件** | 新增 `vitest.config.ts`、`__tests__/` 目录 |
| **优先级** | **中** |

---

## 七、开发路线图

```
阶段 1：基础设施完善（当前阶段）
├── ✅ Fork + 改名 + 克隆
├── ✅ Next.js 16 升级
├── ✅ Build 验证通过
├── ✅ 全套技术文档
├── ⬜ Supabase 项目创建 + 建表
├── ⬜ Google/GitHub OAuth 配置
└── ⬜ 本地 dev 跑通（登录 + Landing Page）

阶段 1.5：安全修复（评审要求，功能开发前必须完成）
├── ⬜ P-1.1 定价架构修复（data/pricing.ts + Checkout 校验）
├── ⬜ P-1.2 积分扣减安全（余额检查 + 并发锁）
├── ⬜ P-1.3 支付处理事务化（存储过程）
├── ⬜ P-1.4 认证安全（update-invite + Demo API）
├── ⬜ P-1.5 API Key hash 存储
├── ⬜ P-1.6 配置安全（strictMode + images + middleware + standalone）
├── ⬜ P-1.7 环境变量校验 + 日志封装
├── ⬜ P-1.8 基础设施（索引 + 外键 + 单例 + 幽灵字段 + 联盟逻辑）
├── ⬜ P-1.9 测试基础设施（Vitest）
└── ⬜ P-1.10 CORS 配置

阶段 2：P0 核心功能
├── ⬜ Creem 支付集成
├── ⬜ 邮件通知系统（Resend）
├── ⬜ 反馈按钮（Crisp）
└── ⬜ 邮箱密码登录

阶段 3：P1 后台强化
├── ⬜ 数据看板（图表）
├── ⬜ 用户管理 CRUD
├── ⬜ 订单管理增强（退款/导出）
├── ⬜ 积分管理
└── ⬜ RBAC 权限系统

阶段 4：P2 体验增强
├── ⬜ 用户个人资料
├── ⬜ 订阅管理
├── ⬜ 用量统计
├── ⬜ 通知中心
├── ⬜ 搜索
├── ⬜ 数据备份与灾难恢复
└── ⬜ GDPR 数据隐私合规

阶段 5：P3 工程化
├── ⬜ Drizzle ORM + 数据库迁移系统（从 P-1.8 降级至此）
├── ⬜ API 限流
├── ⬜ 错误监控（Sentry）
├── ⬜ 审计日志
├── ⬜ Webhook 安全增强
├── ⬜ CSRF 防护
├── ⬜ 数据备份/灾难恢复
└── ⬜ GDPR 数据隐私合规
```

---

## 八、环境变量清单

### 8.1 已有（.env.example）

| 变量 | 用途 | 必填 |
|------|------|------|
| `NEXT_PUBLIC_WEB_URL` | 网站 URL | ✅ |
| `NEXT_PUBLIC_PROJECT_NAME` | 项目名 | ✅ |
| `SUPABASE_URL` | Supabase URL | ✅ |
| `SUPABASE_ANON_KEY` | Supabase Anon Key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | ✅ |
| `AUTH_SECRET` | NextAuth 密钥 | ✅ |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth | 可选 |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | 启用 Google 登录 | 可选 |
| `NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED` | 启用 One-Tap | 可选 |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth | 可选 |
| `NEXT_PUBLIC_AUTH_GITHUB_ENABLED` | 启用 GitHub 登录 | 可选 |
| `STRIPE_PUBLIC_KEY` / `STRIPE_PRIVATE_KEY` | Stripe 支付 | 可选 |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook | 可选 |
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` | GA ID | 可选 |
| `NEXT_PUBLIC_OPENPANEL_CLIENT_ID` | OpenPanel ID | 可选 |
| `ADMIN_EMAILS` | 管理员邮箱 | 可选 |
| `STORAGE_*` | S3 存储配置 | 可选 |

### 8.2 待新增

| 变量 | 用途 | 阶段 |
|------|------|------|
| `CREEM_API_KEY` | Creem 支付 | P0 |
| `CREEM_WEBHOOK_SECRET` | Creem Webhook 验证 | P0 |
| `NEXT_PUBLIC_PAYMENT_PROVIDER` | 支付渠道选择 | P0 |
| `RESEND_API_KEY` | 邮件发送 | P0 |
| `EMAIL_FROM` | 发件人地址 | P0 |
| `NEXT_PUBLIC_CRISP_WEBSITE_ID` | Crisp 客服 | P0 |
| `UPSTASH_REDIS_REST_URL` | 限流 Redis | P3 |
| `UPSTASH_REDIS_REST_TOKEN` | 限流 Redis Token | P3 |
| `SENTRY_DSN` | 错误监控 | P3 |

---

## 九、已知问题 & 风险

> ⚠️ 架构评审发现 22 个问题，其中 6 个严重安全问题已纳入 P-1 安全修复阶段（见第六-补章），必须在功能开发前解决。


| # | 问题 | 影响 | 应对 |
|---|------|------|------|
| 1 | `next dev` 在沙箱内 EMFILE 循环重启 | 仅影响 Codex 沙箱调试 | 用户本地终端运行不受影响；沙箱内用 `next build && next start` |
| 2 | next-auth 5.0.0-beta.25 是 beta 版 | 可能有 breaking change | 持续关注 Auth.js v5 正式版发布 |
| 3 | Supabase Client 无 ORM | 数据模型无类型推导 | 可后续引入 Drizzle ORM 或保持手写 |
| 4 | Tailwind v3（非 v4） | 功能差异 | 暂不升级，v4 迁移成本大且无紧急需求 |
| 5 | Stripe Webhook 仅处理 1 种事件 | 订阅取消等场景缺失 | **P1 阶段补充**（评审提升优先级） |
| 6 | 无 Rate Limiting | Demo AI API 可被滥用 | **P-1.4 已纳入**（认证安全修复） |
| 7 | S3 有 SDK 无 UI | 用户无法上传文件 | P2 阶段补 UI |
| 8 | `output: standalone` 与 `next start` 冲突 | production 启动方式 | **P-1.6 已纳入**（配置安全修复） |
| 9 | Cloudflare 部署兼容性 | @cloudflare/next-on-pages 可能不支持 Next 16 | 暂以 Vercel 为首选 |

---

## 十、评审要点（供 LLM 评估）

1. **技术栈合理性**：Next.js 16 + Tailwind 3 + shadcn/ui + Supabase + NextAuth + Stripe 是否是 AI SaaS 的最优选型？
2. **架构可扩展性**：现有 models/services/types 三层结构能否支撑后续功能扩展？
3. **Creem + Stripe 共存方案**：统一入口分发是否合理？有无更好的抽象？
4. **邮件系统选型**：Resend 是否优于其他方案（如 AWS SES、Postmark）？
5. **RBAC 方案**：users 表加 role 字段 vs 独立 user_roles 表，哪个更合适？
6. **限流策略**：按用户/IP 双维度限流 + 积分扣减三层防护是否过度设计？
7. **优先级排序**：P0-P3 的划分是否合理？有无遗漏的关键功能？
8. **数据库设计**：现有 6 表 + 计划新增 3 表，结构是否规范？是否需要引入 Prisma/Drizzle ORM？
9. **安全风险**：当前无 CSRF、无限流、无审计日志，在 P0 阶段是否需要提前补齐部分安全项？
10. **部署策略**：Vercel 首选 + Cloudflare 备选的方案是否可靠？standalone output 模式的影响？

# 架构设计文档

> 本文档描述**目标架构**（含规划中的多渠道支付、AI 网关、免费试用）。现状实现与目标有差距处均标注「⚠️ 待实现」。
> 详细的演进路线见根目录 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md)，本文档是架构全貌的入口。

## 1. 总体架构

```
                          ┌─────────────────────────────────┐
                          │           用户浏览器             │
                          └───────────────┬─────────────────┘
                                          │ HTTPS
                          ┌───────────────▼─────────────────┐
                          │     Vercel Edge Network          │
                          │  (CDN + Edge Middleware)         │
                          │                                  │
                          │  middleware.ts                   │
                          │  └─ next-intl 路由匹配           │
                          │     /en/* /zh/* /→ locale 注入   │
                          └───────────────┬─────────────────┘
                                          │
                    ┌─────────────────────┼──────────────────────┐
                    │                     │                      │
             ┌──────▼──────┐     ┌────────▼────────┐    ┌───────▼───────┐
             │  静态页面    │     │  服务端渲染页面  │    │  API Routes   │
             │  (Static)   │     │  (SSR/RSC)      │    │  (Route       │
             │             │     │                 │    │   Handlers)   │
             │ • privacy   │     │ • Landing Page  │    │ • /api/auth   │
             │ • terms     │     │ • Console       │    │ • /api/checkout│
             │ • not-found │     │ • Admin         │    │ • /api/v1/ai/*│
             └─────────────┘     │ • Blog          │    │ • /api/*-notify│
                                 │ • Auth          │    │ • /api/ping    │
                                 └────────┬────────┘    └───────┬───────┘
                                          │                      │
                     ┌────────────────────┼──────────────────────┘
                     │                    │
             ┌───────▼───────┐    ┌───────▼────────┐    ┌───────────────┐
             │   NextAuth    │    │    Supabase     │    │  Provider 抽象层│
             │  (Auth.js v5) │    │  (PostgreSQL)   │    │  lib/integrations│
             │               │    │                 │    │                │
             │ • Google      │    │ Tables:         │    │ • payment      │
             │ • GitHub      │    │  users          │    │ • email        │
             │ • One-Tap     │    │  orders         │    │ • telemetry    │
             │ • JWT Token   │    │  credits        │    │ • ai           │
             │               │    │  apikeys        │    └───────┬───────┘
             └───────────────┘    │  posts          │            │
                                  │  affiliates     │            │
                                  │  anonymous_usage│            │
                                  │  payment_*      │            │
                                  └─────────────────┘            │
                                                                 ▼
                                                        ┌───────────────────┐
                                                        │    第三方服务      │
                                                        │                   │
                                                        │ 支付: Stripe/Creem│
                                                        │      /Waffo       │
                                                        │ 邮件: Resend      │
                                                        │ 埋点: PostHog     │
                                                        │ AI: OpenAI/DeepSeek│
                                                        │     /Replicate/Kling│
                                                        │ 存储: AWS S3      │
                                                        └───────────────────┘
```

---

## 2. 分层架构

项目采用四层分离架构。**关键变更**（相对早期三层设计）：Provider 抽象层从 `lib/` 独立为 `lib/integrations/` 分区，因为它会调用第三方 SDK 和 models 层，不再满足「纯工具函数」约束。

```
┌──────────────────────────────────────────────┐
│  app/          → 路由层 (Route Layer)         │
│  ├── page.tsx     页面组件，调用 services      │
│  └── route.ts     API 端点，调用 services      │
├──────────────────────────────────────────────┤
│  services/     → 业务层 (Service Layer)       │
│  ├── user.ts      用户业务逻辑                 │
│  ├── credit.ts    积分业务逻辑                 │
│  ├── order.ts     订单业务逻辑                 │
│  └── affiliate.ts 联盟业务逻辑                 │
├──────────────────────────────────────────────┤
│  models/       → 数据层 (Data Layer)           │
│  ├── db.ts        Supabase Client 工厂         │
│  ├── user.ts      users 表 CRUD                │
│  ├── order.ts     orders 表 CRUD               │
│  ├── credit.ts    credits 表 CRUD              │
│  ├── apikey.ts    apikeys 表 CRUD              │
│  ├── post.ts      posts 表 CRUD                │
│  └── affiliate.ts affiliates 表 CRUD           │
├──────────────────────────────────────────────┤
│  lib/          → 工具层（分区约定）            │
│  ├── *.ts         根目录文件 = 纯工具（无外部依赖）│
│  │   ├── resp.ts     统一响应格式              │
│  │   ├── hash.ts     ID 生成 (UUID/Snowflake)  │
│  │   ├── time.ts     时间工具                  │
│  │   ├── ip.ts       IP 获取                   │
│  │   ├── storage.ts  S3 存储封装               │
│  │   ├── cache.ts    浏览器端缓存              │
│  │   ├── browser.ts  浏览器检测                │
│  │   ├── env.ts      环境变量校验（P-1.7）     │
│  │   ├── logger.ts   日志封装（P-1.7）         │
│  │   └── utils.ts    cn() 等通用工具           │
│  ├── payment/     支付渠道抽象层（有外部依赖）  │
│  │                 见 docs/payment/            │
│  ├── email/       邮件服务抽象层                │
│  │                 见 docs/10-email-system.md  │
│  ├── telemetry/   埋点监控抽象层                │
│  │                 见 docs/11-telemetry-analytics.md │
│  └── ai/          模型路由抽象层（含 Kling）    │
│                    见 docs/13-ai-gateway.md    │
└──────────────────────────────────────────────┘
```

### 2.1 层间依赖规则（重新定义）

- **路由层** → 可调用 services、models、lib 子目录抽象层
- **services 层** → 可调用 models、lib 子目录抽象层、lib 根目录工具
- **models 层** → 仅调用 lib 根目录工具和 db.ts
- **lib 根目录 *.ts** → 纯工具函数，无外部依赖、不调 models
- **lib 子目录（payment/email/telemetry/ai）** → 可调用第三方 SDK、models（如 payment 查 payment_settings）、lib 根目录工具
- **types/** → 被所有层引用，无依赖

> ⚠️ 这是对早期「lib 无外部依赖」规则的修正：Provider 抽象层（payment/email/telemetry/ai 四个子目录）必然依赖第三方 SDK，与根目录纯工具分区管理，避免规则被事实打破。

### 2.2 aisdk 目录归属

| 目录 | 现状 | 归宿 |
|------|------|------|
| `aisdk/` | Kling 自定义 Provider（kling-provider、kling-image-model 等） | 迁入 `lib/ai/providers/kling/` |
| demo API 内联 switch-case | openai/deepseek/openrouter/siliconflow 路由 | 迁入 `lib/ai/registry.ts` + 各 provider 适配器 |

**分层区分**：
- `lib/ai/providers/*`：AI SDK 自定义 Provider（低层，模型能力封装，如 Kling）
- `lib/ai/registry.ts`：模型路由（高层，model id → 供应商，含白名单与定价）

---

## 3. 请求处理流程

### 3.1 页面请求 (SSR/RSC)

```
浏览器请求 /zh
  │
  ▼
middleware.ts (next-intl)
  │ 匹配 locale，注入请求头
  ▼
app/[locale]/(default)/page.tsx
  │ 1. await params → 获取 locale
  │ 2. getLandingPage(locale) → 加载 i18n JSON
  │ 3. getUserInfo() → 检查登录状态（可能 redirect）
  │ 4. 渲染 RSC 树 → 返回 HTML
  ▼
浏览器接收 HTML + Client JS hydration
```

### 3.2 对外 AI API 请求（核心收费闭环，⚠️ 待实现）

```
浏览器/第三方 POST /api/v1/ai/generate
  │
  ▼
app/api/v1/ai/generate/route.ts
  │ 1. getUserUuid() → 鉴权（session 或 sk-）
  │    └─ 未认证 → 401
  │ 2. 余额校验：预估费用 = (输入 token + 输出上限) × 单价
  │    └─ 余额不足 → 402 {required, balance}
  │ 3. decreaseCredits() → 原子扣减（P-1.2 RPC）
  │ 4. lib/integrations/ai/registry → 模型路由（白名单）
  │ 5. generateText() → 生成
  │    └─ 失败 → ai_refund 全额退款
  │ 6. trackServer("ai.generated") → 埋点（吞错不阻塞）
  ▼
返回 { text, reasoning, usage, credits_charged }
```

### 3.3 匿名演示请求（免费试用，⚠️ 待实现）

```
浏览器 POST /api/v1/ai/demo
  │
  ▼
app/api/v1/ai/demo/route.ts
  │ 1. 匿名识别：device_id（FingerprintJS）+ IP → sha256
  │ 2. increment_anonymous_usage(key, date, limit) → RPC 原子递增
  │    └─ 超过每日上限 → 429「登录送 10 积分」
  │ 3. 只用便宜模型 + 低输出上限
  │ 4. 生成 → 返回结果 + 剩余次数
  ▼
（详见 docs/14-anonymous-trial.md）
```

### 3.4 支付 Webhook（⚠️ 待重构为多渠道）

```
渠道服务器 → POST /api/{provider}-notify
  │   Stripe: stripe-signature 验签
  │   Creem:  creem-signature HMAC
  │   Waffo:  X-SIGNATURE RSA
  ▼
app/api/{provider}-notify/route.ts
  │ 1. Provider.parseWebhook() → 验签 + 归一化 PaymentEvent
  │ 2. handleOrderPayment(order) → 统一处理
  │    ├─ 幂等检查（订单是否已 paid）
  │    ├─ 事务化：更新订单 + 充值积分 + 联盟奖励（P-1.3）
  │    └─ 服务端埋点 trackServer("payment.succeeded")
  │ 3. 返回渠道要求的响应体（Waffo 需 {"message":"success"}）
  ▼
渠道收到成功响应，不重试
```

---

## 4. 认证体系

### 4.1 认证流程

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  浏览器   │     │ NextAuth │     │  OAuth   │     │ Supabase │
│          │     │  (Auth)  │     │ Provider │     │   DB     │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │ 1.点击登录    │                │                 │
     │──────────────>│                │                 │
     │               │ 2.重定向到OAuth │                 │
     │<──────────────│                │                 │
     │ 3.跳转Google  │                │                 │
     │─────────────────────────────────>│                │
     │ 4.用户授权     │                │                 │
     │<─────────────────────────────────│                │
     │ 5.callback    │                │                 │
     │──────────────>│                │                 │
     │               │ 6.jwt callback │                 │
     │               │  saveUser()    │                 │
     │               │───────────────────────────────────>│
     │               │                │  insertUser()   │
     │               │                │  + increaseCredits()
     │               │ 7.生成JWT      │                 │
     │ 8.set-cookie  │                │                 │
     │<──────────────│                │                 │
     │ session token │                │                 │
```

> ⚠️ Google One-Tap 存在不校验 aud 的致命漏洞（P-1.11），详见 docs/04-auth-flow.md §3.2。

### 4.2 双模式认证（同一账户语义）

API 端点支持两种认证方式，通过 `getUserUuid()` 统一处理：

| 方式 | 标识 | 流程 |
|------|------|------|
| Session 认证 | NextAuth JWT cookie | `auth()` → 读取 session → `session.user.uuid` |
| API Key 认证 | `Authorization: Bearer sk-xxx` | `headers()` → 提取 token → 查询 apikeys 表 |

```typescript
// services/user.ts
export async function getUserUuid() {
  const token = await getBearerToken();
  if (token && token.startsWith("sk-")) {
    // API Key 认证
    return await getUserUuidByApiKey(token) || "";
  }
  // Session 认证
  const session = await auth();
  return session?.user?.uuid || "";
}
```

> ⚠️ **语义声明**：两种认证方式都映射到**同一个 user_uuid 账户**。第三方用 API Key 调用 AI 时，积分从该账户余额扣减，与浏览器 session 调用共享同一积分池。这是有意的设计（第三方代调用 = 账户授权），不是独立计费单元。

### 4.3 管理员鉴权（过渡方案，⚠️ 待 RBAC 替换）

| 阶段 | 鉴权方式 |
|------|----------|
| P-1 阶段（现状） | `ADMIN_EMAILS` 环境变量白名单 + session email 校验 |
| P1（6.10 RBAC） | users.role 字段（super_admin/admin/operator/user） |

> P-1 阶段涉及的管理员操作（payment_settings 切换、积分补偿）沿用现状 `ADMIN_EMAILS` 白名单，RBAC 落地后替换。

---

## 5. 国际化架构

```
i18n/
├── locale.ts          # 语言列表、默认语言、前缀策略
├── routing.ts         # next-intl 路由定义
├── request.ts         # next-intl 请求配置
├── messages/          # UI 翻译文案
│   ├── en.json        # 英文 UI 文案
│   └── zh.json        # 中文 UI 文案
└── pages/             # 页面内容配置
    └── landing/
        ├── en.json    # 英文 Landing Page 配置
        └── zh.json    # 中文 Landing Page 配置
```

**策略**：
- `localePrefix: "as-needed"` — 默认语言 (en) 不带 URL 前缀，非默认语言 (zh) 带前缀
- `localeDetection: false` — 不自动检测浏览器语言（可通过环境变量开启）
- Landing Page 内容完全由 JSON 配置驱动，无需修改代码

---

## 6. 前端组件体系

### 6.1 组件分层

```
components/
├── ui/               # shadcn/ui 基础组件（28 个）
│   ├── button.tsx    # 按钮
│   ├── dialog.tsx    # 对话框
│   ├── form.tsx      # 表单
│   ├── table.tsx     # 表格
│   └── ...
├── blocks/           # Landing Page 区块组件
│   ├── header/       # 导航栏
│   ├── hero/         # 英雄区
│   ├── pricing/      # 定价
│   ├── faq/          # 常见问题
│   └── ...
├── console/          # 用户控制台组件
│   ├── layout.tsx    # 控制台布局
│   ├── sidebar/      # 侧边栏导航
│   └── slots/        # 表单/表格插槽
├── dashboard/        # 后台管理组件
│   ├── layout.tsx    # 管理后台布局
│   ├── sidebar/      # 管理侧边栏
│   └── slots/        # 表单/表格插槽
├── sign/             # 登录组件
│   ├── sign_in.tsx   # 登录入口
│   ├── form.tsx      # 登录表单
│   ├── modal.tsx     # 登录弹窗
│   └── user.tsx      # 用户头像/菜单
├── analytics/        # 分析组件
├── theme/            # 主题切换
├── locale/           # 语言切换
├── invite/           # 邀请组件
└── icon/             # 图标
```

### 6.2 Slot 模式

控制台和后台管理使用统一的 Slot 模式，通过配置驱动 UI：

```typescript
// 表格 Slot
interface TableSlot {
  title?: string;
  columns: TableColumn[];   // 列定义（含 callback 自定义渲染）
  data: any[];              // 数据
  empty_message?: string;
}

// 表单 Slot
interface FormSlot {
  title?: string;
  fields: FormField[];      // 字段定义（含验证规则）
  submit: FormSubmit;       // 提交按钮 + handler
}
```

---

## 7. 数据流总结

| 操作 | 前端 | 后端 | 数据库 |
|------|------|------|--------|
| 用户登录 | OAuth 重定向 | jwt callback → saveUser | INSERT users + INSERT credits |
| 查看积分 | fetch /api/get-user-info | getUserCredits | SELECT credits WHERE expired_at > now |
| 购买积分 | POST /api/checkout | 查 payment_products → 渠道 createCheckout | INSERT orders (status=created) |
| 支付成功 | 渠道 Webhook | handleOrderPayment（事务化） | UPDATE orders + INSERT credits + INSERT affiliates |
| **调用 AI（正式）** | POST /api/v1/ai/generate | 鉴权 → 余额校验 → 原子扣减 → 模型路由（⚠️ 待实现 6.0） | INSERT credits (负数 ai_generate) |
| **匿名演示** | POST /api/v1/ai/demo | 设备指纹+IP 限次（⚠️ 待实现 6.0.1） | INSERT/UPSERT anonymous_usage |
| 调用 Ping | POST /api/ping | decreaseCredits | INSERT credits (负数) |
| 创建 API Key | 控制台表单 | insertApikey | INSERT apikeys |
| 写博文 | 后台表单 | insertPost | INSERT posts |
| 发送邮件 | 服务端触发 | sendEmail（fire-and-forget） | —（失败仅日志） |
| 埋点上报 | 客户端 track() | 服务端 trackServer()（真相源） | —（PostHog） |

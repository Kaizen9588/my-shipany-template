# 架构设计文档

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
             │ • not-found │     │ • Admin         │    │ • /api/stripe  │
             └─────────────┘     │ • Blog          │    │ • /api/demo    │
                                 │ • Auth          │    │ • /api/ping    │
                                 └────────┬────────┘    └───────┬───────┘
                                          │                      │
                    ┌─────────────────────┼──────────────────────┘
                    │                     │
             ┌──────▼──────┐     ┌────────▼────────┐    ┌───────▼───────┐
             │  NextAuth    │     │  Supabase       │    │  第三方服务    │
             │  (Auth.js v5)│     │  (PostgreSQL)   │    │               │
             │              │     │                 │    │ • Stripe API  │
             │ • Google     │     │ Tables:         │    │ • OpenAI API  │
             │ • GitHub     │     │  users          │    │ • DeepSeek    │
             │ • One-Tap    │     │  orders         │    │ • Replicate   │
             │ • JWT Token  │     │  credits        │    │ • OpenRouter  │
             │              │     │  apikeys        │    │ • AWS S3      │
             │              │     │  posts          │    │ • Google GA   │
             │              │     │  affiliates     │    │               │
             └──────────────┘     └─────────────────┘    └───────────────┘
```

## 2. 分层架构

项目采用三层分离架构：

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
│  lib/          → 工具层 (Utility Layer)        │
│  ├── resp.ts      统一响应格式                  │
│  ├── hash.ts      ID 生成 (UUID/Snowflake)     │
│  ├── time.ts      时间工具                      │
│  ├── ip.ts        IP 获取                       │
│  ├── storage.ts   S3 存储封装                   │
│  ├── cache.ts     浏览器端缓存                  │
│  ├── browser.ts   浏览器检测                    │
│  └── utils.ts     cn() 等通用工具               │
└──────────────────────────────────────────────┘
```

### 层间依赖规则

- **路由层** → 可调用 services 和 models
- **services 层** → 可调用 models 和 lib
- **models 层** → 仅调用 lib 和 db.ts
- **lib 层** → 无外部依赖（纯工具函数）
- **types/** → 被所有层引用，无依赖

> ⚠️ 当前代码中 services 层偶尔直接调用 models 层而非通过自身封装，属于可接受的灵活性。

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

### 3.2 API 请求

```
浏览器 POST /api/ping
  │
  ▼
app/api/ping/route.ts
  │ 1. 解析请求体 { message }
  │ 2. getUserUuid() → 鉴权
  │    ├─ 检查 Authorization header (API Key)
  │    └─ 检查 NextAuth session
  │ 3. decreaseCredits() → 扣减积分
  │ 4. respData({ pong }) → 返回 JSON
  ▼
浏览器接收 { code: 0, message: "ok", data: { pong } }
```

### 3.3 支付 Webhook

```
Stripe → POST /api/stripe-notify
  │
  ▼
app/api/stripe-notify/route.ts
  │ 1. 验证 Stripe 签名 (stripe.webhooks.constructEventAsync)
  │ 2. 判断 event.type === "checkout.session.completed"
  │ 3. handleOrderSession(session)
  │    ├─ updateOrderStatus() → 标记订单为 paid
  │    ├─ updateCreditForOrder() → 充值积分
  │    └─ updateAffiliateForOrder() → 记录联盟奖励
  │ 4. respOk() → 返回 200
  ▼
Stripe 收到 200，不重试
```

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

### 4.2 双模式认证

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

## 7. 数据流总结

| 操作 | 前端 | 后端 | 数据库 |
|------|------|------|--------|
| 用户登录 | OAuth 重定向 | jwt callback → saveUser | INSERT users + INSERT credits |
| 查看积分 | fetch /api/get-user-info | getUserCredits | SELECT credits WHERE expired_at > now |
| 购买积分 | POST /api/checkout | 创建 Stripe Session | INSERT orders (status=created) |
| 支付成功 | Stripe Webhook | handleOrderSession | UPDATE orders + INSERT credits + INSERT affiliates |
| 调用 AI | POST /api/demo/gen-text | (无积分校验) | — |
| 调用 Ping | POST /api/ping | decreaseCredits | INSERT credits (负数) |
| 创建 API Key | 控制台表单 | insertApikey | INSERT apikeys |
| 写博文 | 后台表单 | insertPost | INSERT posts |

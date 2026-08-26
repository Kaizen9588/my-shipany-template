# API 接口文档

## 通用约定

### 基础信息

| 项 | 说明 |
|----|------|
| Base URL | `http://localhost:3000`（开发）/ `https://your-domain.com`（生产） |
| 内容类型 | `application/json` |
| 认证方式 | Cookie (NextAuth Session) 或 `Authorization: Bearer sk-xxx` (API Key) |

### 统一响应格式

所有 API 返回统一的 JSON 结构：

```typescript
{
  "code": number,      // 0 = 成功, -1 = 业务错误, -2 = 未认证
  "message": string,   // 状态描述
  "data": any          // 业务数据（成功时返回）
}
```

**状态码说明**：

> ⚠️ **文档与实现不一致（已知）**：早期设计约定所有错误 HTTP 200 + body code 字段，
> 但实际实现已大量使用真实 HTTP 状态码（401/402/403/429/500）。
> 以下为当前实际运行时的契约，调用方应以 HTTP 状态码 + body 错误码双重判断。

| HTTP 状态 | body.code | 含义 | 常见场景 |
|-----------|-----------|------|----------|
| 200 | 0 | 成功 | 正常响应 |
| 400 | -1 | 请求参数错误 | 校验失败、缺少必填字段 |
| 401 | -2 | 未认证 / 认证失败 | token 无效、session 过期、API key 不存在 |
| 402 | -3 | 余额不足 | 积分不够，需充值 |
| 403 | -4 | 无权限 | 管理员权限不足、越权访问 |
| 409 | -5 | 冲突 | 幂等键冲突、重复操作 |
| 429 | -6 | 限流 | 请求过于频繁 |
| 500 | -99 | 服务端错误 | 数据库异常、第三方服务不可用 |

> `/api/v1/ai/*` 端点严格遵循真实 HTTP 状态码（见 docs/13）。
> 部分旧端点可能仍返回 HTTP 200 + body code，属于历史遗留，逐步迁移。

### 幂等性（Idempotency）

> ⚠️ **当前状态**：仅 `/api/v1/ai/generate` 规划支持，其余端点未实现。
> 真实收费前，所有扣费、退款、支付创建端点必须支持幂等。

| 项 | 说明 |
|----|------|
| Header | `Idempotency-Key: <uuid-or-client-generated-key>` |
| 作用域 | 同一用户 + 同一 key = 同一请求，只执行一次 |
| 有效期 | 24 小时（过期后清理但保留审计记录） |
| 冲突响应 | 409 Conflict（第一个请求仍在处理中时） |
| 已完成响应 | 返回原始结果，不重复执行 |

**适用端点（生产必须）**：
- `POST /api/checkout` — 防止重复创建订单
- `POST /api/admin/refund` — 防止重复退款
- `POST /api/admin/user/credits` — 防止重复调账
- `POST /api/v1/ai/generate` — 防止重复扣费

> ⚠️ **P1-5（第九轮，2026-08-26）——幂等键作用域自相矛盾，需按用户隔离**：本表写「作用域 = 同一用户 + 同一 key」，
> 但 `docs/03` 的落地是 `request_id VARCHAR(128) UNIQUE`（**全局唯一 + 客户端可控**）。全局唯一会让键空间变成公共资源：
> 批量抢注 `"1"`、`"test"`、常见客户端库默认键，受害者用同名键请求时要么被永久拒服（无 TTL、无自助恢复），
> 要么在「冲突返回已有记录」的实现下读到别人的结果。
> **修法**：`UNIQUE(user_uuid, request_id)`（匿名端点用 `anonymous_key` 作租户维度）+ 补齐键的必填性/字符集/长度
> + 存请求体指纹 `hash(model+prompt+max_tokens)`、同键不同体返 422 + 用 `created_at` 落地 24h 口径与清理任务。

### 认证机制

```
┌─────────────────────────────────────────────────────┐
│  请求到达 API Route                                   │
│                                                      │
│  1. getUserUuid() 被调用                             │
│     ├─ 检查 Authorization header                     │
│     │  └─ 若以 "sk-" 开头 -> 查询 apikeys 表         │
│     └─ 若无 header -> 检查 NextAuth session          │
│        └─ session.user.uuid                          │
│                                                      │
│  2. 返回 user_uuid 或空字符串                        │
│     └─ 空字符串 = 未认证                              │
└─────────────────────────────────────────────────────┘
```

> ⚠️ **同一账户语义**：API Key 认证与 Session 认证都映射到**同一个 user_uuid**。第三方用 API Key 调用 AI 时，积分从该账户余额扣减，与浏览器 session 调用共享同一积分池。API Key 是账户的授权凭证，不是独立计费单元。

---

## 接口清单

### 1. POST /api/auth/[...nextauth]

NextAuth.js 自动处理的认证端点，不是自定义 API。

| 项 | 说明 |
|----|------|
| 路径参数 | `...nextauth` -> signin / signout / callback / session |
| 用途 | OAuth 登录回调、登出、Session 查询 |
| 认证 | 无需 |
| 实现 | `auth/config.ts` + `auth/index.ts` |

**支持的 Provider**：

| Provider | ID | 环境变量开关 |
|----------|----|-------------|
| Google | `google` | `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` |
| Google One-Tap | `google-one-tap` | `NEXT_PUBLIC_AUTH_GOOGLE_ONE_TAP_ENABLED=true` |
| GitHub | `github` | `NEXT_PUBLIC_AUTH_GITHUB_ENABLED=true` |

**登录页路径**：`/[locale]/auth/signin`

---

### 2. POST /api/checkout

创建支付订单并发起支付（多渠道统一入口）。

> ✅ P-1.1 已落地：客户端金额不再被信任，checkout 只收 `product_id`（+可选 method/cancel_url），
> 金额/积分/有效期由服务端从 payment_products 表（回退 data/pricing.ts）查询。

> ⚠️ **P1-8（第九轮，2026-08-26）——定价真相源矛盾**：此处写「`payment_products` 表优先、`data/pricing.ts` 回退」，
> 但 `docs/05:27`、`docs/15:45` 宣称 `data/pricing.ts` 是「单一真相源」，7 处表优先 vs 2 处文件唯一真相源互相打架。
> 需先钉死哪个是真相源（建议：表为运行时权威、文件为初始化种子/回退），再据此重定级「管理员定价更新」的风险等级。

| 项 | 说明 |
|----|------|
| 认证 | ✅ 必须登录 |
| 实现 | `app/api/checkout/route.ts`（统一入口，内部按 payment_settings 路由到渠道） |

**请求体**：

```typescript
{
  product_id: string,     // 产品 ID（如 "starter"），服务端据此查真实价格
  method: string,         // 支付方式："card" | "alipay" | "wechat_pay"（前端只传方式，不传渠道）
  cancel_url?: string     // 取消支付跳转 URL（可选）
}
```

**关键原则**：
- **不信任客户端金额**：`amount`/`credits`/`currency` 由服务端从 `payment_products` 表查询
- **前端只传 `method`，不传 `provider`**：渠道选择是服务端的事，按 `payment_settings.priority` 路由
- 可用支付方式由 `GET /api/payment-methods` 提供（见下文）

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: {
    checkout_url: string,  // 重定向用户到渠道托管支付页
    order_no: string,      // 内部订单号
    provider: string       // 实际路由到的渠道 id（stripe/creem/waffo）
  }
}
```

**业务流程**：
1. 鉴权获取 user_uuid + user_email
2. 查 `payment_products` 表获取真实金额/积分/有效期
3. 按 method 路由到渠道（`getEnabledProviders()`）
4. 生成 order_no，INSERT orders（status="created", payment_provider=渠道）
5. 调渠道 Provider `createCheckout()`（Stripe 传 price_data、Creem 传 product_id、Waffo 传动态金额）
6. 渠道 session id 回写订单行（如 `orders.stripe_session_id`，无渠道专属表）
7. 返回 checkout_url 给前端跳转

---

### 2.1 GET /api/payment-methods

返回可用支付方式列表（前端渲染用，不暴露渠道名）。

| 项 | 说明 |
|----|------|
| 认证 | 无需 |
| 实现 | `app/api/payment-methods/route.ts` |
| 缓存 | 60s TTL（避免高频查库） |

**响应**：

```typescript
{
  code: 0,
  data: {
    methods: [
      { method: "card",       available: true, providers: ["creem", "waffo"] },
      { method: "alipay",     available: true, providers: ["creem", "waffo"] },
      { method: "wechat_pay", available: true, providers: ["waffo"] }
    ]
  }
}
```

`available=false` 时前端隐藏该按钮而非报错。

---

### 3. POST /api/stripe-notify

Stripe Webhook 回调端点，处理支付完成事件。

| 项 | 说明 |
|----|------|
| 认证 | Stripe 签名验证 |
| 实现 | `app/api/stripe-notify/route.ts` |

**请求**：Stripe 原始 Webhook 体（非 JSON 解析，用 `req.text()`）

**处理逻辑**（多渠道统一，现状）：

```
1. 验签 + 归一化（stripeProvider.parseWebhook：constructEventAsync）
   └─ 验签/解析失败 → 400 + 发射 payment.webhook_invalid_signature 告警（docs/16）
2. 归一化事件类型:
   ├─ "checkout.session.completed"（payment_status=paid）→ payment_succeeded
   └─ "charge.refunded" → refund_succeeded（经 payment_intent 反查 session 拿 order_no）
3. handlePaymentEvent → handle_order_payment / process_order_refund RPC
   （行锁 + 幂等 + 金额/币种比对，mismatch 不充值并告警）
4. 返回 200
```

> ✅ 退款事件已处理（6.21）；订阅类事件（subscription.*）仍不在 v1 范围（docs/05 §1.6）。

**环境变量**：`STRIPE_PRIVATE_KEY`、`STRIPE_WEBHOOK_SECRET`

---

### 4. POST /api/get-user-info

获取当前登录用户的完整信息。

| 项 | 说明 |
|----|------|
| 认证 | ✅ 必须登录 |
| 实现 | `app/api/get-user-info/route.ts` |

**请求体**：空

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: {
    uuid: string,
    email: string,
    nickname: string,
    avatar_url: string,
    created_at: string,       // ISO 8601
    locale: string,
    invite_code: string,
    invited_by: string,
    is_affiliate: boolean
  }
}
```

> ✅ **2.8 已修复**：响应经 `toSafeUser()` 白名单出口（services/user.ts），
> `password_hash` / `role` / `signin_ip` / `signin_openid` / `status` 不再离开服务端。
> 上表即实际字段。注意：本接口同时接受 session 与 sk- API key。

**未认证响应** (code=-2)：

```typescript
{ code: -2, message: "no auth", data: [] }
```

---

### 5. POST /api/ping

积分扣减示例接口。演示如何调用需要消耗积分的 API。

| 项 | 说明 |
|----|------|
| 认证 | ✅ 必须登录 |
| 积分消耗 | 1 积分 (CreditsAmount.PingCost) |
| 实现 | `app/api/ping/route.ts` |

**请求体**：

```typescript
{ message: string }   // 任意消息
```

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: { pong: "received message: {message}" }
}
```

**业务流程**：
1. 鉴权获取 user_uuid
2. `decreaseCredits({ user_uuid, trans_type: "ping", credits: 1 })`
3. 返回 echo 消息

---

### 6. POST /api/update-invite-code

设置或更新当前用户的邀请码。

| 项 | 说明 |
|----|------|
| 认证 | ✅ 必须登录 |
| 实现 | `app/api/update-invite-code/route.ts` |

**请求体**：

```typescript
{ invite_code: string }   // 2-16 字符
```

**校验规则**：
- `invite_code` 长度 2-16
- 不能与已有邀请码重复（除自己的外）

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: { /* 更新后的 User 对象 */ }
}
```

---

### 7. POST /api/update-invite

绑定邀请关系（被邀请用户调用）。

> ✅ **P-1.4 已落地**：user_uuid 一律从 NextAuth session 获取，请求体不再接受 user_uuid。

| 项 | 说明 |
|----|------|
| 认证 | ✅ 必须登录（从 NextAuth session 获取 user_uuid） |
| 实现 | `app/api/update-invite/route.ts` |

**请求体**：

```typescript
{
  invite_code: string    // 邀请人的邀请码
}
```

**校验规则**（P-1.4 下放服务端）：
- 邀请人必须存在
- 不能邀请自己
- 被邀请人不能已有邀请人
- 注册 2 小时内才可绑定（仅前端提示，服务端无时效校验）

> ⚠️ **已知风险（P1）**：
> 1. **竞态条件**：「读取 invited_by → UPDATE → INSERT affiliates」不是事务，
>    并发请求可能产生重复邀请记录。应使用数据库唯一约束 `(invited_by, user_uuid)` + 单事务函数。
> 2. **2 小时时效仅前端校验**：服务端不校验 `created_at`，任何时候都能绑定。
>    应在服务端基于 `users.created_at` 判断时效。

**业务流程**：
1. 从 session 获取被邀请人 user_uuid（**不接受客户端传入**）
2. 查找邀请人 (findUserByInviteCode)
3. 校验（不能自邀、不能重复；2 小时时效仅前端提示，服务端不校验）
4. UPDATE users.invited_by
5. INSERT affiliates (status="pending")

---

### 8~10. POST /api/demo/*（已废弃）

> ❌ **P-1.4 已废弃**：`/api/demo/gen-text`、`/api/demo/gen-stream-text`、`/api/demo/gen-image`
> 三个未认证、无限流的 AI 端点已删除。由 P0 的正式端点替代：
> - `/api/v1/ai/generate` — 登录 + 积分收费（见 [docs/13-ai-gateway.md](./13-ai-gateway.md)）
> - `/api/v1/ai/demo` — 匿名演示限流（见 [docs/14-anonymous-trial.md](./14-anonymous-trial.md)）

---

## 接口认证总结

> 阶段 1.5（P-1 安全修复）已全部落地，下表为当前状态。

| 接口 | 认证 | 积分消耗 | 风险点 |
|------|------|----------|--------|
| /api/auth/[...nextauth] | - | - | One-Tap aud 已校验（P-1.11 ✅） |
| /api/checkout | ✅ Session | - | 金额服务端定价表决定（P-1.1 ✅）；按 payment_settings 路由渠道并写入 payment_provider |
| /api/payment-methods | - | - | ✅ 已实现（可用支付方式聚合） |
| /api/{stripe,creem,waffo}-notify | 渠道签名 | - | 验签后归一化 PaymentEvent 统一处理；金额/币种比对（0010）；refund 事件原子扣积分（0011） |
| /api/get-user-info | ✅ Session/ApiKey | - | - |
| /api/ping | ✅ Session/ApiKey | 1 积分 | 余额不足返回明确错误（P-1.2 ✅） |
| /api/update-invite-code | ✅ Session | - | - |
| /api/update-invite | ✅ Session（P-1.4 ✅） | - | - |
| /api/send-verification | 限流 | - | 60s/邮箱冷却 + 10 次/天/IP + 生产环境必须有 RESEND_API_KEY（S2 ✅） |
| /api/verify-code | 限流 | - | 5 次/分/邮箱 + 20 次/分/IP（防验证码爆破，S2 ✅） |
| /api/demo/* | ❌ 已废弃删除（P-1.4 ✅） | - | 由 /api/v1/ai/* 替代（P0） |
| /api/v1/ai/generate | ✅ Session/ApiKey | 按模型扣费 | 鉴权->余额->一次扣清->失败退款（见 docs/13） |
| /api/v1/ai/demo | 匿名（IP 限流） | 免费 | 模型服务端固定、额度按纯 IP（S3 ✅，见 docs/14） |
| /api/admin/* | ✅ requireAdmin | - | stats / user / user/credits / refund（RBAC，见后台管理） |
| /api/user/profile,avatar,delete-account | ✅ Session | - | 个人资料 / 头像 / GDPR 注销 |
| /api/notifications(+/read) | ✅ Session | - | 站内通知中心（6.14） |
| /api/search | ✅ | - | 全站搜索（6.15） |
| /api/health, /api/cron/daily | - | - | 健康检查 / 定时任务（订单过期等） |

## 待新增接口（规划中）

| 接口 | 方法 | 用途 | 优先级 |
|------|------|------|--------|
| /api/unsubscribe | GET | 营销邮件退订 | P2 |

> 已落地（曾列于本表）：`/api/admin/payment-settings`（GET/PUT，渠道启用/优先级热切换）、
> `/api/admin/op-events`（运营事件查询，docs/16）。

> 已废弃：`/api/creem-checkout`（多渠道后 checkout 统一入口，渠道不设独立 checkout 端点）。

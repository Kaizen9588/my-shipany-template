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

| code | 含义 | HTTP Status |
|------|------|-------------|
| 0 | 成功 | 200 |
| -1 | 业务错误（参数无效、操作失败等） | 200 |
| -2 | 未认证 | 200 |

> ⚠️ 注意：即使 code 非 0，HTTP 状态码仍为 200。调用方需检查 JSON body 中的 code 字段。

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

创建 Stripe Checkout Session，发起支付。

| 项 | 说明 |
|----|------|
| 认证 | ✅ 必须登录 |
| 实现 | `app/api/checkout/route.ts` |

**请求体**：

```typescript
{
  credits: number,        // 购买积分数
  currency: string,       // "USD" | "CNY" | "EUR" 等
  amount: number,         // 金额（分），如 9900 = $99.00
  interval: string,       // "one-time" | "month" | "year"
  product_id: string,     // 产品 ID（如 "starter"）
  product_name: string,   // 产品名称
  valid_months: number,   // 积分有效月数（1/3/12）
  cancel_url?: string     // 取消支付跳转 URL（可选）
}
```

**校验规则**：
- `amount`、`interval`、`currency`、`product_id` 必填
- `interval` 必须是 `year` / `month` / `one-time` 之一
- `year` 对应 `valid_months=12`，`month` 对应 `valid_months=1`

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: {
    public_key: string,    // Stripe 公钥
    order_no: string,      // 内部订单号
    session_id: string     // Stripe Session ID
  }
}
```

**业务流程**：
1. 获取 user_uuid + user_email
2. 生成 order_no (Snowflake ID)
3. 计算过期时间（valid_months + 订阅延迟 24h）
4. INSERT orders (status="created")
5. 创建 Stripe Checkout Session
6. UPDATE orders (stripe_session_id, order_detail)
7. 返回 session_id 给前端跳转

**CNY 特殊处理**：
- `currency === "cny"` 时，启用 `wechat_pay` + `alipay` + `card` 三种支付方式

---

### 3. POST /api/stripe-notify

Stripe Webhook 回调端点，处理支付完成事件。

| 项 | 说明 |
|----|------|
| 认证 | Stripe 签名验证 |
| 实现 | `app/api/stripe-notify/route.ts` |

**请求**：Stripe 原始 Webhook 体（非 JSON 解析，用 `req.text()`）

**处理逻辑**：

```
1. 验证签名 (stripe.webhooks.constructEventAsync)
2. 判断 event.type:
   ├─ "checkout.session.completed" -> handleOrderSession()
   │   ├─ 更新订单状态为 paid
   │   ├─ 充值积分 (updateCreditForOrder)
   │   └─ 记录联盟奖励 (updateAffiliateForOrder)
   └─ 其他事件 -> 仅日志，不处理
3. 返回 200
```

> ⚠️ 当前仅处理 `checkout.session.completed` 一种事件。缺少 `subscription.deleted`、`subscription.updated`、`refund.created` 等事件处理。

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

| 项 | 说明 |
|----|------|
| 认证 | ❌ 无需认证（但需要 user_uuid 参数） |
| 实现 | `app/api/update-invite/route.ts` |

**请求体**：

```typescript
{
  invite_code: string,   // 邀请人的邀请码
  user_uuid: string      // 被邀请人的 UUID
}
```

**校验规则**：
- 邀请人必须存在
- 不能邀请自己
- 被邀请人不能已有邀请人

**业务流程**：
1. 查找邀请人 (findUserByInviteCode)
2. 查找被邀请人 (findUserByUuid)
3. 校验（不能自邀、不能重复）
4. UPDATE users.invited_by
5. INSERT affiliates (status="pending")

> ⚠️ 此接口不需要认证，仅依赖请求体中的 user_uuid。存在被伪造的风险。

---

### 8. POST /api/demo/gen-text

AI 文本生成 Demo。

| 项 | 说明 |
|----|------|
| 认证 | ❌ 无需认证 |
| 积分消耗 | ❌ 不消耗 |
| 实现 | `app/api/demo/gen-text/route.ts` |

**请求体**：

```typescript
{
  prompt: string,     // 提示词
  provider: string,   // "openai" | "deepseek" | "openrouter" | "siliconflow"
  model: string       // 模型名，如 "gpt-4o"
}
```

**支持的 Provider**：

| Provider | 环境变量 | 特殊处理 |
|----------|----------|----------|
| openai | `OPENAI_API_KEY` | - |
| deepseek | `DEEPSEEK_API_KEY` | - |
| openrouter | `OPENROUTER_API_KEY` | deepseek-r1 模型启用 reasoning 提取 |
| siliconflow | `SILICONFLOW_API_KEY` + `SILICONFLOW_BASE_URL` | DeepSeek-R1 模型启用 reasoning 提取 |

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: {
    text: string,       // 生成文本
    reasoning: string   // 推理过程（如有）
  }
}
```

---

### 9. POST /api/demo/gen-stream-text

AI 流式文本生成 Demo。

| 项 | 说明 |
|----|------|
| 认证 | ❌ 无需认证 |
| 积分消耗 | ❌ 不消耗 |
| 响应格式 | AI SDK Data Stream（非标准 JSON） |
| 实现 | `app/api/demo/gen-stream-text/route.ts` |

**请求体**：同 `/api/demo/gen-text`

**响应**：`result.toDataStreamResponse({ sendReasoning: true })`，返回 Vercel AI SDK 流式协议。

---

### 10. POST /api/demo/gen-image

AI 图片生成 Demo。

| 项 | 说明 |
|----|------|
| 认证 | ❌ 无需认证 |
| 积分消耗 | ❌ 不消耗 |
| 实现 | `app/api/demo/gen-image/route.ts` |

**请求体**：

```typescript
{
  prompt: string,     // 图片描述
  provider: string,   // "openai" | "replicate" | "kling"
  model: string       // 模型名
}
```

**支持的 Provider**：

| Provider | 模型示例 | 环境变量 |
|----------|----------|----------|
| openai | dall-e-3 | `OPENAI_API_KEY` |
| replicate | stability-ai/sdxl | `REPLICATE_API_TOKEN` |
| kling | kling-v1 | `KLING_API_KEY` + `KLING_BASE_URL` |

**业务流程**：
1. 调用 AI SDK 生成图片
2. 将图片上传到 S3 存储 (`storage.uploadFile`)
3. 返回图片 URL

**成功响应** (code=0)：

```typescript
{
  code: 0,
  message: "ok",
  data: [{
    location: string,    // S3 原始 URL
    bucket: string,
    key: string,
    filename: string,
    url: string,         // 通过 STORAGE_DOMAIN 拼接的 CDN URL
    provider: string
  }]
}
```

---

## 接口认证总结

| 接口 | 认证 | 积分消耗 | 风险点 |
|------|------|----------|--------|
| /api/auth/[...nextauth] | - | - | - |
| /api/checkout | ✅ Session | - | - |
| /api/stripe-notify | Stripe签名 | - | 仅处理1种事件 |
| /api/get-user-info | ✅ Session/ApiKey | - | - |
| /api/ping | ✅ Session/ApiKey | 1 积分 | - |
| /api/update-invite-code | ✅ Session | - | - |
| /api/update-invite | ❌ 无 | - | ⚠️ 无认证，依赖参数 |
| /api/demo/gen-text | ❌ 无 | - | ⚠️ 可被滥用 |
| /api/demo/gen-stream-text | ❌ 无 | - | ⚠️ 可被滥用 |
| /api/demo/gen-image | ❌ 无 | - | ⚠️ 可被滥用 |

## 待新增接口（规划中）

| 接口 | 方法 | 用途 | 优先级 |
|------|------|------|--------|
| /api/creem-checkout | POST | Creem 支付创建订单 | P0 |
| /api/creem-notify | POST | Creem Webhook 回调 | P0 |
| /api/send-verification | POST | 发送邮箱验证码 | P0 |
| /api/admin/user | PUT | 更新用户信息/状态 | P1 |
| /api/admin/user/credits | POST | 管理员手动调整积分 | P1 |
| /api/admin/refund | POST | Stripe 退款 | P1 |
| /api/admin/stats | GET | 后台数据统计 | P1 |
| /api/user/profile | PUT | 用户修改个人资料 | P2 |
| /api/stripe-portal | POST | Stripe Customer Portal | P2 |
| /api/search | GET | 全站搜索 | P2 |
| /api/notifications | GET | 站内通知列表 | P2 |

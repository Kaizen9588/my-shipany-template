# Stripe 支付对接文档

> 文档来源：Stripe 官方 API 文档 (https://docs.stripe.com/api)
> 对接版本：stripe npm 17.5.0
> 最后更新：2025-08-14

---

## 1. 概述

Stripe 是国际标准支付网关，支持信用卡、微信支付、支付宝等。本项目使用 **Checkout Session**（托管支付页）模式。

### 1.1 核心概念

| 概念 | 说明 |
|------|------|
| Checkout Session | Stripe 托管的支付页面，创建后返回 URL 供用户跳转 |
| Payment Intent | 一次性支付的底层对象 |
| Subscription | 订阅对象，自动周期扣款 |
| Customer | Stripe 客户对象，关联支付方式 |
| Webhook | Stripe 服务器主动通知你的服务器事件 |
| Test Mode | 沙箱环境，使用测试密钥，不产生真实扣款 |

### 1.2 环境与密钥

| 环境 | 密钥前缀 | Webhook Secret |
|------|----------|----------------|
| Test | `sk_test_` / `pk_test_` | `whsec_...` |
| Live | `sk_live_` / `pk_live_` | `whsec_...` |

**环境变量**：

```
STRIPE_PUBLIC_KEY=pk_test_xxx        # 前端使用
STRIPE_PRIVATE_KEY=sk_test_xxx       # 后端使用
STRIPE_WEBHOOK_SECRET=whsec_xxx      # Webhook 签名验证
```

---

## 2. 需要对接的接口

### 2.1 创建 Checkout Session（已有）

**接口**：`POST /v1/checkout/sessions`（Stripe API）

**本项目封装**：`app/api/checkout/route.ts` -> `stripe.checkout.sessions.create()`

**请求参数**：

```typescript
const options: Stripe.Checkout.SessionCreateParams = {
  payment_method_types: ["card"],        // CNY 时加 "wechat_pay", "alipay"
  line_items: [{
    price_data: {
      currency: "usd",                    // 货币代码
      product_data: {
        name: "Product Name",             // 产品名称
      },
      unit_amount: 9900,                  // 金额（分），$99.00 = 9900
      recurring: is_subscription          // 订阅模式
        ? { interval: "month" }           // "month" | "year"
        : undefined,
    },
    quantity: 1,
  }],
  allow_promotion_codes: false,           // 禁用优惠码（R1：与「实付=订单额精确比对」互斥，docs/05 §1.4）
  metadata: {                              // 自定义元数据（Webhook 回调时可用）
    order_no: "xxx",
    user_uuid: "xxx",
    user_email: "xxx",
    credits: "100",
  },
  mode: "payment",                         // "payment"(一次性) | "subscription"(订阅)
  success_url: "https://domain/pay-success/{CHECKOUT_SESSION_ID}",
  cancel_url: "https://domain/#pricing",
  customer_email: "user@example.com",     // 预填邮箱
};
```

**CNY 特殊配置**：

```typescript
if (currency === "cny") {
  options.payment_method_types = ["wechat_pay", "alipay", "card"];
  options.payment_method_options = {
    wechat_pay: { client: "web" },
    alipay: {},
  };
}
```

**响应**：

```typescript
{
  id: "cs_test_xxx",          // Session ID（存入 orders.stripe_session_id）
  url: "https://checkout.stripe.com/c/pay/cs_test_xxx",
  payment_status: "unpaid",
  // ...
}
```

> ⚠️ **安全修复（P-1.1）**：当前 `amount` 和 `credits` 来自客户端，必须改为从服务端定价表查询。

### 2.2 Webhook 签名验证（已有）

**接口**：`POST /api/stripe-notify`（本项目端点）

**签名验证**：

```typescript
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY);

// Stripe 签名在 stripe-signature header
const sign = req.headers.get("stripe-signature");
const body = await req.text();  // 必须用原始 text，不能用 JSON 解析

const event = await stripe.webhooks.constructEventAsync(
  body,
  sign,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

### 2.3 需处理的 Webhook 事件

| 事件 | 当前状态 | 处理逻辑 |
|------|----------|----------|
| `checkout.session.completed` | ✅ 已处理 | 更新订单 paid -> 充值积分 -> 联盟奖励 |
| `customer.subscription.deleted` | ❌ 未处理 | 用户取消订阅 -> 标记订单 expired -> 停止积分 |
| `customer.subscription.updated` | ❌ 未处理 | 订阅升级/降级 -> 更新订单信息 |
| `invoice.paid` | ❌ 未处理 | 订阅续费成功 -> 充值新周期积分 |
| `invoice.payment_failed` | ❌ 未处理 | 订阅扣款失败 -> 通知用户 |
| `charge.refunded` | ✅ 已处理（6.21） | 经 payment_intent 反查 session 拿 order_no → process_order_refund（扣回积分 → 更新订单状态） |

> ⚠️ **P2-2（第九轮，2026-08-26）——争议/拒付事件缺失**：上表 6 个待处理事件里根本没有
> `charge.dispute.created` / `charge.dispute.closed`（以及 `charge.dispute.updated`）。争议与订阅无关，v1 一次性付款同样会发生。
> 需把 `dispute_opened / dispute_lost / dispute_won` 归一化进 `PaymentEventType`，订单加 `disputed / charged_back` 状态，
> 并在 Stripe Dashboard 订阅争议事件（处理路径见 provider-abstraction §3.1 与 docs/05 §7.2）。

**Webhook 事件处理代码模板**：

```typescript
// app/api/stripe-notify/route.ts（补充后）

switch (event.type) {
  case "checkout.session.completed": {
    const session = event.data.object;
    await handleOrderSession(session);  // 已有
    break;
  }
  case "customer.subscription.deleted": {
    const subscription = event.data.object;
    await handleSubscriptionDeleted(subscription);
    break;
  }
  case "invoice.paid": {
    const invoice = event.data.object;
    await handleInvoicePaid(invoice);  // 续费充值积分
    break;
  }
  case "charge.refunded": {
    const charge = event.data.object;
    await handleRefund(charge);  // 扣回积分
    break;
  }
  default:
    console.log("unhandled event:", event.type);
}
```

### 2.4 退款（✅ 已实现）

> 现状：两条入口——后台 `POST /api/admin/refund`（services/refund.ts `processRefund`）与
> 渠道 `charge.refunded`/`refund.created` webhook，均汇入 `process_order_refund` RPC
> （迁移 0011：行锁 + refunded 幂等 + 锁序与 decrease_credits 一致防死锁）。
> 口径：部分退款也扣回全部剩余积分（见 services/refund.ts 注释）。

**接口**：`POST /v1/refunds`（Stripe API）

```typescript
const refund = await stripe.refunds.create({
  payment_intent: "pi_xxx",     // 从订单的 paid_detail 中提取
  amount: 9900,                  // 退款金额（分），不填则全额退款
  reason: "requested_by_customer",
});
```

**退款后处理**：

```typescript
// 1. 更新订单状态为 refunded
// 2. 扣回对应积分（insertCredit 负数记录，无 expired_at）
// 3. 记录审计日志
```

### 2.5 Customer Portal（待实现）

**接口**：`POST /v1/billing_portal/sessions`（Stripe API）

让用户自助管理订阅（取消、更换支付方式、查看发票）：

```typescript
const session = await stripe.billingPortal.sessions.create({
  customer: "cus_xxx",                    // Stripe Customer ID
  return_url: "https://domain/my-orders",
});
// 返回 session.url，重定向用户
```

### 2.6 检索 Checkout Session（已有）

**接口**：`GET /v1/checkout/sessions/:id`（Stripe API）

用于支付成功页查询支付状态：

```typescript
const session = await stripe.checkout.sessions.retrieve(session_id);
// session.payment_status === "paid"
```

---

## 3. 数据库映射

### 3.1 orders 表（共享字段）

| Stripe 字段 | 本项目字段 | 说明 |
|-------------|-----------|------|
| - | order_no | 内部订单号（Snowflake ID） |
| - | user_uuid | 用户 UUID |
| amount_total | amount | 金额（分） |
| - | credits | 对应积分数 |
| currency | currency | 货币 |
| - | status | created / paid / deleted / refunded |
| metadata.order_no | order_no | 关联 |
| metadata.product_id | product_id | 产品 ID |

### 3.2 Stripe 专属字段（留在 orders 表，无 stripe_orders 物理表）

> 迁移 0007 只为 Creem/Waffo 建了专属表；Stripe 特有字段仍留在 orders 表（见 docs/03 §2「Stripe 专属字段未做物理拆分」），订阅相关 sub_* 字段**未实现**。

| Stripe 字段 | 本项目字段 | 说明 |
|-------------|-----------|------|
| id | stripe_session_id | Checkout Session ID（orders 表列） |
| subscription | - | 订阅 ID（未实现） |
| - | - | sub_* 订阅周期字段均未实现（本模板无订阅产品） |

---

## 4. 本项目代码位置

| 功能 | 文件 | 状态 |
|------|------|------|
| 创建 Checkout Session | `app/api/checkout/route.ts` | ✅ 已实现（P-1.1 服务端定价已落地） |
| Webhook 接收 | `app/api/stripe-notify/route.ts` | ✅ 支付成功 + 退款事件；验签失败发射告警 |
| 订单处理 | `handle_order_payment` / `process_order_refund` RPC | ✅ 已实现（迁移 0010/0011/0017） |
| 订单数据操作 | `models/order.ts` | ✅ 已实现 |
| 支付成功页 | `app/[locale]/pay-success/[session_id]/page.tsx` | ✅ 已实现（纯 redirect，不触发落账） |
| 退款 | `/api/admin/refund` + webhook | ✅ 已实现（6.21） |
| Customer Portal | - | ❌ 待实现 |
| 订阅取消 | - | ❌ 待实现 |
| 续费充值 | - | ❌ 待实现 |

---

## 5. Stripe CLI 本地测试

```bash
# 安装
brew install stripe/stripe-cli/stripe

# 登录
stripe login

# 转发 Webhook 到本地
stripe listen --forward-to localhost:3000/api/stripe-notify
# 输出: Ready! Your webhook signing secret is whsec_xxx
# 填入 .env.local 的 STRIPE_WEBHOOK_SECRET

# 触发测试事件
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
stripe trigger invoice.paid
```

---

## 6. Stripe vs Creem 关键差异

| 维度 | Stripe | Creem |
|------|--------|-------|
| 创建支付 | 动态传金额+产品名 | 传 product_id（需预先创建产品） |
| 密钥认证 | `Authorization: Bearer sk_xxx` | `x-api-key: creem_xxx` |
| Webhook 签名 | `stripe-signature` header + `constructEventAsync` | `creem-signature` header + HMAC-SHA256 |
| 金额单位 | 美分（整数） | 美分（整数） |
| 货币 | 小写 ISO（usd, cny） | 大写 ISO（USD, CNY） |
| 退款 API | `POST /v1/refunds` | `POST /v1/transactions/{id}/refund` |
| 税务 | 需自行处理或用 Stripe Tax | 自动处理（MoR 模式） |
| SDK | `stripe` | `creem` / `@creem_io/nextjs` |
| 订阅取消 | API 或 Customer Portal | API 或 Customer Portal |
| 测试模式 | `sk_test_` 密钥 | 独立的 test-api.creem.io 域名 |
| Webhook 重试 | 自动重试（约 3 天） | 5 次：30s/5min/30min/6h，最多 24h |

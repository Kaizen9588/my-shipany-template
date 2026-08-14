# Creem 支付对接文档

> 文档来源：Creem 官方文档 (https://docs.creem.io)
> SDK：creem (TypeScript) / @creem_io/nextjs (Next.js adapter)
> 最后更新：2025-08-14

---

## 1. 概述

Creem 是 Merchant of Record（MoR）支付平台，自动处理全球税务（VAT/GST）、支付处理、合规。支持支付宝等中国支付方式，适合无海外信用卡的开发者。

### 1.1 核心概念

| 概念 | 说明 |
|------|------|
| Merchant of Record | Creem 是法律意义上的卖方，负责税务、合规、退款 |
| Product | 必须在 Creem Dashboard 预先创建产品，获取 product_id |
| Checkout Session | 创建后返回 checkout_url 供用户跳转 |
| Subscription | 订阅对象，自动周期扣款 |
| Customer | Creem 客户对象 |
| Webhook | Creem 服务器主动通知事件，HMAC-SHA256 签名 |
| Test Mode | 独立的沙箱环境（test-api.creem.io），与生产完全隔离 |

### 1.2 与 Stripe 的关键区别

| 维度 | Stripe | Creem |
|------|--------|-------|
| 定价方式 | 创建 Session 时动态传金额 | 必须预先创建 Product，Checkout 只传 product_id |
| 税务 | 需自行处理 | 自动处理（MoR 模式，190+ 国家） |
| 费率 | 2.9% + 30¢ | 3.9% + 40¢ |
| 中国支付 | 需配置 CNY + 微信/支付宝 | 内置支持 |
| 密钥格式 | `sk_live_xxx` | `creem_xxx` |
| 测试环境 | 同域名，换 test 密钥 | 独立域名 test-api.creem.io |

### 1.3 环境与密钥

| 环境 | Base URL | API Key |
|------|----------|---------|
| Production | `https://api.creem.io/v1` | Dashboard > Developers |
| Test | `https://test-api.creem.io/v1` | Dashboard > Test Mode > Developers |

**环境变量**：

```
CREEM_API_KEY=creem_xxx                    # 后端使用
CREEM_WEBHOOK_SECRET=xxx                    # Webhook 签名验证
```

### 1.4 认证方式

所有 API 请求通过 `x-api-key` header 认证：

```bash
curl -X GET https://api.creem.io/v1/products \
  -H "x-api-key: creem_YOUR_API_KEY"
```

---

## 2. SDK 选型

### 2.1 方案对比

| SDK | 包名 | 适用场景 | 推荐 |
|-----|------|----------|------|
| TypeScript SDK | `creem` | 全量 API 访问，灵活控制 | ⭐ 推荐 |
| Next.js Adapter | `@creem_io/nextjs` | 快速接入，React 组件 + Webhook helper | 备选 |

### 2.2 TypeScript SDK 安装

```bash
pnpm add creem
```

### 2.3 初始化

```typescript
import { Creem } from "creem";

const creem = new Creem({
  apiKey: process.env.CREEM_API_KEY!,
  server: process.env.NODE_ENV === "production" ? "prod" : "test",
});
```

---

## 3. 需要对接的接口

### 3.1 创建产品（前置步骤）

> ⚠️ 与 Stripe 不同，Creem 必须先在 Dashboard 或通过 API 创建产品，获取 `product_id`。

**接口**：`POST /v1/products`

```typescript
const product = await creem.products.create({
  name: "Starter Plan",
  description: "100 credits, valid for 1 month",
  price: 9900,                    // 美分，$99.00
  currency: "USD",                // 大写 ISO 代码
  billingType: "one-time",        // "one-time" | "recurring"
  billingPeriod: undefined,       // recurring 时填："every-month" | "every-year"
});
// 返回 product.id = "prod_xxx"
```

**本项目定价方案对应**：

| 方案 | product_id（示例） | billingType | billingPeriod | price |
|------|---------------------|-------------|---------------|-------|
| Starter | `prod_starter_xxx` | one-time | - | 9900 ($99) |
| Standard | `prod_standard_xxx` | one-time | - | 19900 ($199) |
| Premium | `prod_premium_xxx` | one-time | - | 29900 ($299) |

> 产品的 `product_id` 需要写入 `data/pricing.ts` 服务端定价表（P-1.1 修复后）。

### 3.2 创建 Checkout Session

**接口**：`POST /v1/checkouts`

**SDK 调用**：

```typescript
const checkout = await creem.checkouts.create({
  productId: "prod_xxx",              // 必填：Creem 产品 ID
  successUrl: "https://domain/pay-success",  // 支付成功跳转
  metadata: {                          // 自定义元数据（Webhook 回调时可用）
    order_no: "xxx",
    user_uuid: "xxx",
    user_email: "xxx",
    credits: "100",
  },
  customer: {                          // 可选：预填客户信息
    email: "user@example.com",
  },
  units: 1,                            // 可选：数量（默认 1）
  discountCode: "SUMMER2024",          // 可选：折扣码
});

// 返回
console.log(checkout.checkoutUrl);     // 跳转用户到此 URL
console.log(checkout.id);              // Checkout Session ID
```

**本项目封装**（待实现）：`app/api/creem-checkout/route.ts`

```typescript
// app/api/creem-checkout/route.ts（待实现）

import { Creem } from "creem";
import { respData, respErr } from "@/lib/resp";
import { getUserUuid, getUserEmail } from "@/services/user";
import { insertOrder } from "@/models/order";
import { getPricingByProductId } from "@/data/pricing";  // P-1.1 后

const creem = new Creem({
  apiKey: process.env.CREEM_API_KEY!,
  server: process.env.NODE_ENV === "production" ? "prod" : "test",
});

export async function POST(req: Request) {
  // 1. 鉴权
  const user_uuid = await getUserUuid();
  if (!user_uuid) return respErr("no auth");

  // 2. 从服务端定价表查询（不信任客户端）
  const { product_id, credits, valid_months } = await req.json();
  const pricing = getPricingByProductId(product_id);
  if (!pricing) return respErr("invalid product");

  // 3. 创建内部订单
  const order_no = getSnowId();
  await insertOrder({
    order_no, user_uuid, user_email: await getUserEmail(),
    amount: pricing.amount, credits, currency: pricing.currency,
    status: "created", payment_provider: "creem",
    product_id, product_name: pricing.product_name, valid_months,
    // ... expired_at 计算
  });

  // 4. 创建 Creem Checkout
  const checkout = await creem.checkouts.create({
    productId: pricing.creem_product_id,  // Creem 的 product_id
    successUrl: `${process.env.NEXT_PUBLIC_WEB_URL}/pay-success`,
    metadata: { order_no, user_uuid, credits: String(credits) },
  });

  // 5. 存入 creem_orders 表
  await insertCreemOrder({
    order_no,
    creem_checkout_id: checkout.id,
  });

  return respData({ checkout_url: checkout.checkoutUrl, order_no });
}
```

### 3.3 检索 Checkout Session

**接口**：`GET /v1/checkouts/:id`

```typescript
const checkout = await creem.checkouts.retrieve("checkout_xxx");
// checkout.status === "completed" | "pending"
```

### 3.4 Webhook 接收与签名验证

**接口**：`POST /api/creem-notify`（本项目端点，待实现）

**签名验证**（HMAC-SHA256）：

```typescript
import { verifyWebhookSignature } from "creem/webhooks";

// Creem 签名在 creem-signature header
await verifyWebhookSignature(rawBody, request.headers, {
  secret: process.env.CREEM_WEBHOOK_SECRET!,
});
```

> ⚠️ 与 Stripe 不同：Creem 的签名验证使用 `creem-signature` header + HMAC-SHA256，
> Stripe 使用 `stripe-signature` header + 自有验证算法。

**本项目封装**（待实现）：`app/api/creem-notify/route.ts`

```typescript
// app/api/creem-notify/route.ts（待实现）

import { verifyWebhookSignature } from "creem/webhooks";
import { handleOrderSession } from "@/services/order";
import { respOk } from "@/lib/resp";

export async function POST(req: Request) {
  try {
    const body = await req.text();  // 原始 body

    // 1. 验证签名
    await verifyWebhookSignature(body, req.headers, {
      secret: process.env.CREEM_WEBHOOK_SECRET!,
    });

    const event = JSON.parse(body);

    // 2. 根据 eventType 处理
    switch (event.eventType) {
      case "checkout.completed":
        await handleCreemCheckoutCompleted(event.object);
        break;
      case "subscription.active":
        await handleCreemSubscriptionActive(event.object);
        break;
      case "subscription.paid":
        await handleCreemSubscriptionPaid(event.object);  // 续费充值
        break;
      case "subscription.canceled":
        await handleCreemSubscriptionCanceled(event.object);
        break;
      case "refund.created":
        await handleCreemRefund(event.object);
        break;
      default:
        console.log("unhandled creem event:", event.eventType);
    }

    return respOk();
  } catch (e) {
    return Response.json({ error: "creem webhook failed" }, { status: 500 });
  }
}
```

### 3.5 需处理的 Webhook 事件

| 事件 | 说明 | 对应处理 | Stripe 对应 |
|------|------|----------|-------------|
| `checkout.completed` | 支付完成 | 更新订单 paid -> 充值积分 -> 联盟奖励 | `checkout.session.completed` |
| `subscription.active` | 订阅创建 | 记录订阅信息 | `checkout.session.completed`(subscription) |
| `subscription.paid` | 订阅扣款成功 | 续费充值积分 | `invoice.paid` |
| `subscription.canceled` | 订阅取消 | 标记订单 expired | `customer.subscription.deleted` |
| `subscription.scheduled_cancel` | 计划取消 | 通知用户 | - |
| `subscription.past_due` | 扣款失败 | 通知用户 | `invoice.payment_failed` |
| `subscription.expired` | 订阅过期 | 停止积分 | - |
| `subscription.trialing` | 试用开始 | 标记试用 | - |
| `subscription.paused` | 订阅暂停 | 暂停积分 | - |
| `subscription.update` | 订阅更新 | 更新订单 | `customer.subscription.updated` |
| `refund.created` | 退款发生 | 扣回积分 | `charge.refunded` |
| `dispute.created` | 争议发生 | 记录日志 | `charge.dispute.created` |

**Webhook 重试策略**：

| 重试次数 | 间隔 |
|----------|------|
| 第 1 次 | 立即 |
| 第 2 次 | 30 秒后 |
| 第 3 次 | 5 分钟后 |
| 第 4 次 | 30 分钟后 |
| 第 5 次 | 6 小时后 |

> 24 小时后不再重试。Webhook handler 必须幂等。

### 3.6 Webhook 事件 payload 结构

**checkout.completed**：

```json
{
  "id": "evt_xxx",
  "eventType": "checkout.completed",
  "created_at": 1739963911073,
  "object": {
    "id": "checkout_xxx",
    "object": "checkout",
    "checkout_url": "https://checkout.creem.io/xxx",
    "customer": {
      "id": "cust_xxx",
      "email": "user@example.com",
      "name": "User Name",
      "country": "CN"
    },
    "product": {
      "id": "prod_xxx",
      "name": "Starter Plan",
      "price": 9900,
      "currency": "USD",
      "billing_type": "one-time"
    },
    "metadata": {
      "order_no": "xxx",
      "user_uuid": "xxx",
      "credits": "100"
    }
  }
}
```

> `metadata` 是创建 Checkout 时传入的自定义数据，用于关联内部订单。

### 3.7 退款

**接口**：`POST /v1/transactions/:transaction_id/refund`

```typescript
const refund = await creem.transactions.refund("txn_xxx", {
  amount: 9900,  // 可选，不填则全额退款
});
```

> 退款后 Creem 会发送 `refund.created` Webhook 事件。

### 3.8 订阅管理

| 操作 | 接口 | 说明 |
|------|------|------|
| 检索订阅 | `GET /v1/subscriptions/:id` | 获取订阅详情 |
| 取消订阅 | `POST /v1/subscriptions/:id/cancel` | 立即或周期末取消 |
| 暂停订阅 | `POST /v1/subscriptions/:id/pause` | 暂停扣款 |
| 恢复订阅 | `POST /v1/subscriptions/:id/resume` | 恢复扣款 |
| 升级订阅 | `POST /v1/subscriptions/:id/upgrade` | 升级到其他产品 |
| Customer Portal | Dashboard 链接或 `<CreemPortal>` 组件 | 用户自助管理 |

### 3.9 Customer Portal（Next.js Adapter）

```tsx
import { CreemPortal } from "@creem_io/nextjs";

<CreemPortal customerId="cust_xxx">
  <button>Manage Subscription</button>
</CreemPortal>
```

---

## 4. 数据库映射

### 4.1 orders 表（共享字段）

| Creem 字段 | 本项目字段 | 说明 |
|------------|-----------|------|
| - | order_no | 内部订单号（Snowflake ID） |
| metadata.order_no | order_no | 关联 |
| metadata.user_uuid | user_uuid | 用户 UUID |
| object.product.price | amount | 金额（分） |
| metadata.credits | credits | 对应积分数 |
| object.product.currency | currency | 货币 |
| - | status | created / paid / deleted / refunded |
| - | payment_provider | "creem" |

### 4.2 creem_orders 表（Creem 专属）

| Creem 字段 | 本项目字段 | 说明 |
|------------|-----------|------|
| object.id | creem_checkout_id | Checkout Session ID |
| object.subscription.id | creem_subscription_id | 订阅 ID |
| object.customer.id | creem_customer_id | Creem 客户 ID |

### 4.3 Creem 产品映射

Creem 的产品必须预先创建，`product_id` 存储在服务端定价表中：

```typescript
// data/pricing.ts（P-1.1 后）

export const PRICING = [
  {
    product_id: "starter",
    product_name: "Starter Plan",
    amount: 9900,
    currency: "USD",
    credits: 100,
    valid_months: 1,
    stripe_price_data: { /* Stripe 动态定价 */ },
    creem_product_id: "prod_xxx",  // Creem 预创建的产品 ID
  },
  // ...
];
```

---

## 5. 本项目实现计划

| 功能 | 文件 | 状态 | 优先级 |
|------|------|------|--------|
| Creem SDK 安装 | package.json | ❌ 待安装 | P0 |
| 服务端定价表 | `data/pricing.ts` | ❌ 待创建 | P-1.1 |
| 创建 Creem Checkout | `app/api/creem-checkout/route.ts` | ❌ 待实现 | P0 |
| Creem Webhook | `app/api/creem-notify/route.ts` | ❌ 待实现 | P0 |
| creem_orders 表 | SQL 迁移 | ❌ 待创建 | P0 |
| Creem 产品创建 | Dashboard 或 API | ❌ 待创建 | P0 |
| 统一 Checkout 入口 | `app/api/checkout/route.ts` | ❌ 待重构 | P0 |
| 退款 | `services/order.ts` -> `refundOrder()` | ❌ 待实现 | P1 |
| 订阅取消 | `services/order.ts` | ❌ 待实现 | P1 |
| Customer Portal | 组件 | ❌ 待实现 | P2 |

---

## 6. 统一支付入口设计

```
前端 Pricing 按钮
      │
      ▼
POST /api/checkout
      │
      ├─ 检查 NEXT_PUBLIC_PAYMENT_PROVIDER
      │
      ├─ provider === "stripe"
      │   └─> 创建 Stripe Session
      │       INSERT orders (payment_provider='stripe')
      │       INSERT stripe_orders
      │       返回 stripe checkout_url
      │
      ├─ provider === "creem"
      │   └─> 创建 Creem Checkout
      │       INSERT orders (payment_provider='creem')
      │       INSERT creem_orders
      │       返回 creem checkout_url
      │
      └─ provider === "stripe,creem"
          └─> 前端显示支付方式选择
              用户选择后重定向到对应 API
```

**环境变量控制**：

```
# 单渠道
NEXT_PUBLIC_PAYMENT_PROVIDER=stripe
NEXT_PUBLIC_PAYMENT_PROVIDER=creem

# 多渠道（前端显示选择）
NEXT_PUBLIC_PAYMENT_PROVIDER=stripe,creem
```

---

## 7. Creem Dashboard 配置步骤

1. **注册 Creem 账号**：https://creem.io
2. **创建产品**：Dashboard > Products > New Product
   - 设置名称、描述、价格、货币
   - 设置 billing type（one-time / recurring）
   - 记录 `product_id`（如 `prod_xxx`）
3. **获取 API Key**：Dashboard > Developers > API Keys
4. **配置 Webhook**：Dashboard > Developers > Webhook
   - URL: `https://your-domain.com/api/creem-notify`
   - 记录 Webhook Secret
5. **测试模式**：Dashboard 左下角切换 Test Mode
   - 使用 test-api.creem.io
   - 测试卡号：`4111 1111 1111 1111`（成功）

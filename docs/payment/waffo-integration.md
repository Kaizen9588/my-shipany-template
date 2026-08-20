# Waffo 支付对接文档

> 文档来源：Waffo 官方文档 (https://waffo.com/docs)
> SDK：@waffo/waffo-node（Node.js）
> Merchant Portal：https://pancake.waffo.ai/merchant/auth/signin
> 最后更新：2025-08-14
>
> ✅ **落地记录（2026-08）**：`lib/payment/providers/waffo.ts`（order.create 动态金额 + RSA webhook 验签 + 退款）、
> `/api/waffo-notify`（响应 {message:"success"}）、迁移 `0007` 建 waffo_orders 表。
> ⚠️ 需在 Waffo Merchant Portal 配置 API Key/RSA 密钥对/merchantId 后可用；webhook 响应签名（X-SIGNATURE 响应头）如沙箱要求再补。

---

## 1. 概述

Waffo 是 2023 年成立的全球支付平台，总部香港，团队来自蚂蚁集团、字节跳动、PayPal、GCash、DANA 等，HSBC 战略投资。定位与 Creem 类似（MoR），但能力更全。

### 1.1 核心事实

| 项 | 说明 |
|----|------|
| 模式 | MoR（默认）+ PSP 双模式，可切换 |
| 覆盖 | 162 国家 / 480+ 支付方式 / 135 币种 |
| 费率 | MoR：4.5% + $0.5/笔（限时，正常 5% + $0.5）；PSP 可谈 |
| 申请门槛 | 个人/公司均可，香港主体 |
| 内置能力 | 智能路由（自动选最优 processor）、智能重试、欺诈防护、chargeback 防御 |

### 1.2 与 Creem 的关键区别

| 维度 | Creem | Waffo |
|------|-------|-------|
| 定价方式 | 预建 Product，checkout 传 product_id | **动态传金额，无 product 概念** |
| 金额格式 | 整数分 | **字符串（"100.00"）** |
| 认证 | x-api-key 单 key | **API Key + RSA 密钥对 + merchantId** |
| 退款 API | ❌ 无（Dashboard 手动） | ✅ 有 |
| Webhook 签名 | HMAC-SHA256 | **RSA（X-SIGNATURE header）** |
| Webhook 响应 | HTTP 200 | **必须 `{"message":"success"}`** |
| 特殊能力 | - | Auth & Capture、x402 稳定币、Tokenization |
| 智能路由 | 无 | ✅ 内置（Success Rate Optimization） |

---

## 2. 环境与认证

### 2.1 环境变量

```
WAFFO_API_KEY=xxx          # Merchant Portal 获取
WAFFO_PRIVATE_KEY=xxx      # 商户 RSA 私钥（PEM）
WAFFO_PUBLIC_KEY=xxx       # Waffo 公钥（验签 webhook 用）
WAFFO_MERCHANT_ID=xxx      # 商户 ID
```

> ⚠️ 与 Creem/Stripe 最大的差异：需要 **RSA 密钥对**。商户生成密钥对，公钥上传给 Waffo；Waffo 的公钥用于验证 webhook 签名。

### 2.2 SDK 初始化

```typescript
import { Waffo, Environment } from '@waffo/waffo-node';

const waffo = new Waffo({
  apiKey: process.env.WAFFO_API_KEY,
  privateKey: process.env.WAFFO_PRIVATE_KEY,
  waffoPublicKey: process.env.WAFFO_PUBLIC_KEY,
  merchantId: process.env.WAFFO_MERCHANT_ID,
  environment: Environment.SANDBOX,  // SANDBOX / PRODUCTION
});
```

---

## 3. 核心 API

### 3.1 创建订单

**接口**：`POST /api/v1/order/create`

```typescript
const response = await waffo.order().create({
  paymentRequestId: order_no,          // 必填：幂等键，≤32 位
  merchantOrderId: order_no,           // 必填：商户订单号，≤64 位
  orderCurrency: "USD",                // 必填：大写 ISO
  orderAmount: "99.00",                // 必填：字符串格式！
  orderDescription: "Starter Plan",    // 必填
  orderRequestedAt: new Date().toISOString(),
  notifyUrl: `${WEB_URL}/api/waffo-notify`,   // 必填：异步通知
  successRedirectUrl: `${WEB_URL}/pay-success`,
  failedRedirectUrl: `${WEB_URL}/pricing`,
  cancelRedirectUrl: `${WEB_URL}/pricing`,
  userInfo: {
    userId: user_uuid,                 // 必填
    userEmail: user_email,             // 必填：真实邮箱，防欺诈
    userTerminal: "WEB",               // 必填
  },
  paymentInfo: {
    productName: "ONE_TIME_PAYMENT",   // 必填
    // payMethodName 不传 → 用户跳 Waffo cashier 页自选支付方式
    // 传 "DANA"/"ALIPAY" 等 → 直接走指定支付方式
  },
  goodsInfo: {
    goodsName: "Starter Plan",         // 必填
    goodsUrl: `${WEB_URL}/#pricing`,   // 必填：合规要求
    appName: "my-saas",                // 必填：goodsUrl 或 appName 至少一个
  },
  extendInfo: JSON.stringify({         // 预留字段：自定义元数据
    order_no, user_uuid, credits,
  }),
});

if (response.isSuccess()) {
  const data = response.getData();
  // data.acquiringOrderId: Waffo 订单 ID
  // data.orderAction.webUrl: 重定向用户到此 URL
  // data.orderStatus: PAY_IN_PROGRESS 等
  redirect(data.orderAction.webUrl);
}
```

### 3.2 响应字段

| 字段 | 说明 |
|------|------|
| `acquiringOrderId` | Waffo 侧订单 ID（存渠道专属表） |
| `orderStatus` | `PAY_IN_PROGRESS` / `PAY_SUCCESS` / `ORDER_CLOSE` / `AUTHED_WAITING_CAPTURE` |
| `orderAction.webUrl` | 重定向用户到 Waffo cashier |

### 3.3 订单查询

**接口**：`POST /api/v1/order/inquiry`

```typescript
const result = await waffo.order().inquiry({
  merchantOrderId: order_no,
});
// result.orderStatus: 订单状态
```

### 3.4 退款

**接口**：`POST /api/v1/order/refund`

```typescript
const refund = await waffo.order().refund({
  merchantOrderId: order_no,
  refundAmount: "99.00",              // 字符串；不传或传全额 = 全额退款
  refundReason: "requested_by_customer",
  refundNotifyUrl: `${WEB_URL}/api/waffo-notify`,
});
```

> 退款完成会触发 `REFUND_NOTIFICATION` webhook。

### 3.5 订阅

| 操作 | 接口 |
|------|------|
| 创建订阅 | `POST /api/v1/subscription/create` |
| 查询 | `POST /api/v1/subscription/inquiry` |
| 取消 | `POST /api/v1/subscription/cancel` |
| 升降级 | `POST /api/v1/subscription/change` |
| 管理页 | `POST /api/v1/subscription/manage`（生成管理 URL，1 天有效） |

---

## 4. Webhook

### 4.1 签名验证（RSA）

```typescript
// Waffo 用 X-SIGNATURE header + RSA 签名，与 Creem(HMAC) / Stripe(constructEventAsync) 都不同
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = req.body.toString();
  const signature = req.headers['x-signature'] as string;

  // SDK 自动完成验签 + 事件路由 + 响应体构造
  const result = await waffo.webhook().handleWebhook(body, signature);
  res.status(200).send(result.responseBody);
});
```

### 4.2 事件类型

| eventType | 说明 | 对应处理 |
|-----------|------|----------|
| `PAYMENT_NOTIFICATION` | 支付完成/失败 | 更新订单 paid → 充值积分 → 联盟奖励 |
| `REFUND_NOTIFICATION` | 退款完成/失败 | 扣回积分 → 更新订单 refunded |
| `SUBSCRIPTION_STATUS_NOTIFICATION` | 订阅状态变化（激活/取消/扣款结果） | 订阅生命周期 |
| `SUBSCRIPTION_PERIOD_CHANGED_NOTIFICATION` | 订阅周期终态（续费结果） | 续费充值 |
| `SUBSCRIPTION_CHANGE_NOTIFICATION` | 订阅升降级完成 | 更新套餐 |

### 4.3 响应格式（与 Creem/Stripe 不同）

> ⚠️ **必须**返回 HTTP 200 + body `{"message":"success"}`。只返回 200 但 body 不对，Waffo 视为失败并重试。

- `{"message":"success"}` → 处理成功
- `{"message":"failed"}` → 处理失败，重试（最多 8 次，30s 到 8h 递增间隔）

---

## 5. 三渠道对接差异总表

| 维度 | Stripe | Creem | Waffo |
|------|--------|-------|-------|
| 模式 | PSP | MoR | MoR + PSP |
| 定价方式 | 动态金额 | 预建 product | 动态金额 |
| 金额格式 | 整数分 | 整数分 | 字符串 "99.00" |
| 认证 | Bearer sk_ | x-api-key | API Key + RSA |
| 幂等键 | idempotency_key（可选） | request_id | paymentRequestId（必填） |
| 元数据 | metadata | metadata / request_id | extendInfo |
| Webhook 签名 | stripe-signature | creem-signature HMAC | X-SIGNATURE RSA |
| Webhook 响应 | 200 | 200 | 200 + {"message":"success"} |
| 退款 API | ✅ | ❌ | ✅ |
| 订阅 | ✅ | ✅ | ✅ |
| 支付方式选择 | payment_method_types | cashier 自动 | payMethodName 可选 |
| 智能路由 | ❌ | ❌ | ✅ 内置 |

> 这张表就是「必须做 Provider 抽象层」的铁证：没有任何两个渠道的对接细节是相同的。

---

## 6. 数据库映射

### 6.1 waffo_orders 表（渠道专属）

```sql
CREATE TABLE waffo_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,      -- 关联 orders.order_no
    acquiring_order_id VARCHAR(255),             -- Waffo 订单 ID
    payment_request_id VARCHAR(64),              -- 幂等键
    sub_id VARCHAR(255),                         -- 订阅 ID
    created_at timestamptz
);
```

### 6.2 与共享 orders 表的映射

| Waffo 字段 | 本项目字段 |
|-----------|-----------|
| merchantOrderId | order_no |
| orderAmount | amount（分，需转换） |
| orderCurrency | currency |
| extendInfo.order_no | order_no |
| - | payment_provider = 'waffo' |

---

## 7. 特殊能力（长期可启用）

| 能力 | 说明 | AI SaaS 价值 |
|------|------|-------------|
| **Auth & Capture** | 先授权冻结金额，后按实际消费扣款 | 按用量计费（AI token 消耗），比预购积分更灵活 |
| **Tokenization** | 卡数据 token 化，一键支付 + 自动更新过期卡 | 订阅续费成功率提升 |
| **智能路由** | Waffo 内部自动选最优 processor | 单渠道被封概率大幅降低 |
| **x402** | USDC 稳定币支付（AI Agent 支付） | 未来 AI Agent 经济 |
| **智能重试** | 订阅扣款失败自动择时重试 | 降低非自愿流失 |

> ⚠️ 注意区分两层「路由」：Waffo 内置的智能路由是 **processor 级**（Waffo 内部的通道选择）；本项目要做的路由是 **渠道级**（Stripe/Creem/Waffo 之间）。两者互补。

---

## 8. 本项目实现状态

| 功能 | 文件 | 状态 | 优先级 |
|------|------|------|--------|
| Waffo SDK 安装 | package.json | ✅ 已落地 | - |
| WaffoProvider | `lib/payment/providers/waffo.ts` | ✅ 已落地 | - |
| Waffo Webhook | `app/api/waffo-notify/route.ts` | ✅ 已落地（RSA 验签 + 失败告警） | - |
| waffo_orders 表 | 迁移 0007 | ✅ 已落地 | - |
| 退款 | `services/order.ts` + webhook | ✅ 已落地（6.21，与 Stripe/Creem 共用 processRefund） | - |
| 订阅 | `services/order.ts` | ❌ 未实现（本模板无订阅产品） | P2 |
| Auth & Capture | 待评估 | ❌ | P3 |

---

## 9. Merchant Portal 配置步骤

1. 注册：https://pancake.waffo.ai/merchant/auth/signin
2. 完成 KYC/KYB
3. **Integration** 菜单：
   - 获取 API Key、merchantId
   - 生成 RSA 密钥对，上传公钥，保存私钥
   - 复制 Waffo 公钥（验签用）
4. 配置 Webhook URL：`https://your-domain.com/api/waffo-notify`
5. 切 Sandbox 测试，测试卡可参考官网 Sandbox 文档

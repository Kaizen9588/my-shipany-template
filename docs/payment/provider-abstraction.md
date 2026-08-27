# 支付架构设计（Payment Provider Abstraction）

> 版本：v2（覆盖三阶段渠道演进诉求）
> 已验证事实：
> - ShipAny 官网 pricing 页仅展示「购买按钮 + USD▼ 货币下拉 + 优惠码入口」，不展示渠道名也不展示支付方式，支付方式在 checkout 页才出现。
> - Stripe / Creem / Waffo 三渠道的对接细节**零重合**（认证、金额格式、幂等键、webhook 签名、webhook 响应、退款能力全部不同），详见各渠道对接文档。
>
> ✅ **阶段 1 落地记录（2026-08）**：`lib/payment/*`（Provider 接口 + registry + stripe/creem/waffo 三适配器）、
> 迁移 `0007_multi_payment.sql`（orders.payment_provider + creem_orders/waffo_orders + payment_settings/种子）、
> `/api/checkout` 统一入口（method → 服务端渠道路由，前端不感知渠道）、`/api/payment-methods`、`/api/creem-notify` + `/api/waffo-notify`（归一化 handlePaymentEvent）。
> ✅ **阶段 2 落地记录（2026-08）**：Stripe 适配器已并入（写 adapter + registry 一行，验证了「加渠道不动核心代码」）。
> ✅ **阶段 3 落地记录（2026-08）**：`lib/payment/health.ts` 健康检测（连续 5 次失败/10 分钟标记 unhealthy，TTL 30 分钟）+
> `getEnabledProviders`/`routePaymentProvider` 路由时自动跳过 unhealthy 渠道。内存级实现（单实例），
> 多实例需 Redis，与限流同一升级路径。告警通知管理员一环目前仅 console.warn，
> 飞书/企微机器人告警见 [docs/16-observability-alerting.md](../16-observability-alerting.md)（6.23 待落地）。
> ✅ **资金安全加固（2026-08 架构审查 R1/R3）**：webhook 金额/币种精确比对（迁移 0010，不匹配置 mismatch）、
> 退款原子化（迁移 0011 process_order_refund）。

---

## 一、渠道演进路线（你的诉求）

| 阶段 | 渠道 | 时机 | 架构要求 |
|------|------|------|----------|
| **阶段 1（现在）** | Creem + Waffo | 个人可申请 | 双渠道并存，手动热切换 |
| **阶段 2（很久以后）** | + Stripe + PayPal | 注册美国公司后 | 无缝新增渠道，不动核心代码 |
| **阶段 3（长期）** | 支付路由 | A 被封自动路由 B | 健康检测 + 自动降级 |

**核心矛盾**：渠道会变（易申请 → 企业级），但用户永远不变（就是要能付款）。所以架构必须做到：

1. 渠道是**插件**，随时插拔
2. 用户只面对**支付方式**，永远无感知
3. 今天双渠道手动切换，明天自动路由，**代码结构不变，只是加逻辑**

---

## 二、核心原则

1. **用户只感知支付方式，不感知渠道**。Card / Alipay / WeChat Pay 是用户词汇；Stripe / Creem / Waffo 是开发者词汇，永不出现于 UI。
2. **渠道可热切换**：配置数据库化，后台一键切换，不重新部署。
3. **数据不绑定渠道**：订单 `payment_provider` 写入即冻结，切换不影响存量数据。
4. **一次性付款优先，订阅次要**：credits 模型天然适合「购买积分包」，降低渠道切换成本（订阅跨渠道迁移是行业难题）。
5. **所有渠道细节在适配器内消化**：金额格式（Waffo 字符串 vs 其他整数分）、幂等键、签名方式、响应格式，上层业务无感。

---

## 三、Provider 抽象层

### 3.1 接口定义

```typescript
// lib/payment/types.ts

export type PaymentMethod = "card" | "alipay" | "wechat_pay" | "paypal";

export interface CheckoutParams {
  order_no: string;        // 内部订单号（幂等键，全渠道统一用它生成）
  product_id: string;
  product_name: string;    // 产品名称（Waffo goodsInfo.goodsName 必填）
  user_uuid: string;
  user_email: string;
  amount: number;          // 统一为「分」（整数），适配器内部转字符串
  currency: string;        // 统一大写 ISO（如 "USD"）
  credits: number;
  goods_url: string;       // 产品 URL（Waffo goodsInfo.goodsUrl 必填，合规要求）
  success_url: string;
  cancel_url: string;
}

export interface CheckoutResult {
  checkout_url: string;          // 重定向用户
  provider_session_id: string;   // 存入渠道专属表（acquiringOrderId / checkout.id / session.id）
}

export interface PaymentEvent {
  type: PaymentEventType;  // 归一化事件
  order_no: string;
  user_uuid: string;
  credits: number;
  amount: number;
  raw: unknown;            // 原始 payload 存 order_detail
}

export type PaymentEventType =
  | "payment_succeeded"
  | "payment_failed"
  | "refund_succeeded"
  | "dispute_opened"      // 第九轮 P2-2 建议新增：争议/拒付链路
  | "dispute_lost"
  | "dispute_won"
  | "subscription_activated"
  | "subscription_canceled"
  | "subscription_renewed";

> ⚠️ **P2-2（第九轮，2026-08-26）——争议/拒付（chargeback）全链路缺失**：原 `PaymentEventType` 无争议类型，
> `orders.status`（created/paid/expired/refunded/mismatch/deleted）无 `disputed/charged_back`，即使收到渠道 dispute 事件也无处归一化。
> 修法：加 `dispute_opened / dispute_lost / dispute_won` + 订单加 `disputed / charged_back`；
> `dispute_opened` 立即冻结该用户积分消费（保留余额不删）+ 挂起联盟奖励 + 订单收入移出可确认收入；
> `dispute_lost` 复用退款债务化路径（docs/05 P0-1）；`dispute_won` 解冻。三份渠道文档的事件白名单显式列出争议事件。

export interface PaymentProvider {
  id: string;                       // "creem" | "waffo" | "stripe" | "paypal"
  supported_methods: PaymentMethod[];
  capabilities: {
    refund_api: boolean;            // Creem=false，Stripe/Waffo=true
    subscription: boolean;
    portal: boolean;                // 用户自助管理订阅
  };

  hasValidCredentials(): boolean;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  parseWebhook(req: Request): Promise<PaymentEvent | null>;  // 验签 + 归一化
  webhookResponseBody(success: boolean): object;             // Waffo 要求特定 body
  refund?(params: { order_no: string; amount?: number }): Promise<void>;
  cancelSubscription?(provider_sub_id: string): Promise<void>;
  createPortal?(customer_id: string): Promise<string>;
}
```

### 3.2 渠道差异消化表（适配器内部处理）

> ⚠️ Waffo 列已于 2026-08-27 按 Pancake 新模型重写（`@waffo/pancake-ts@0.19.1`，
> 迁移执行记录见 [waffo-operations-guide.md](./waffo-operations-guide.md) §九）；
> 旧代「动态金额 + X-SIGNATURE + {"message":"success"}」语义作废。

| 差异点 | Creem | Waffo（Pancake） | Stripe | 抽象层统一 |
|--------|-------|-------|--------|-----------|
| 定价模型 | 预建 product | **预建产品**（Store/Product + publish），金额真相在渠道目录 | 动态金额 | 查 payment_products 表 |
| 金额格式 | 整数分 | 显示字符串（webhook `"29.00"`），适配器 ×100 转分 | 整数分 | 统一「分」→ 适配器转 |
| 幂等键 | request_id（一等字段） | orderMerchantExternalId = order_no | idempotency_key | 统一用 order_no |
| 元数据 | metadata | orderMetadata（flat k-v） | metadata | 统一塞 order_no/user_uuid |
| Webhook 签名 | HMAC-SHA256（creem-signature） | RSA `x-waffo-signature`（t=,v1=，SDK 内置公钥+时间戳防重放） | constructEventAsync | parseWebhook 内消化 |
| Webhook 响应 | 200 | 200 + 纯文本 `"OK"` | 200 | webhookResponseBody 提供 |
| 退款 API | ❌ | ❌（Dashboard 手动 / 客户工单制） | ✅ | capabilities.refund_api 标记；❌ 渠道走手动指引 + refund webhook 扣回 |
| 收银台支付方式 | 按地区自动展示本地方式 | card/applepay/googlepay/wechat（**无 alipay**） | card/alipay/wechat_pay 等 | supported_methods 声明 → payment-methods 聚合自动反映 |
| session 时效 | 24h 级 | **45 分钟**（expiresInSeconds 默认 2700） | 24h 级 | checkout_expires_at 若落地须按渠道取最小值 |

### 3.3 注册表 + 运行时状态

```typescript
// lib/payment/registry.ts
const providers: Record<string, PaymentProvider> = {
  creem: creemProvider,
  waffo: waffoProvider,
  // stripe: stripeProvider,   // 阶段 2 加一行
  // paypal: paypalProvider,   // 阶段 2 加一行
};

// 运行时启用状态来自数据库 payment_settings，不来自环境变量
export async function getEnabledProviders(): Promise<PaymentProvider[]> {
  const settings = await getPaymentSettings();
  return Object.entries(providers)
    .filter(([id, p]) => settings[id]?.enabled && p.hasValidCredentials())
    .map(([id, p]) => p);
}
```

---

## 四、支付方式抽象（用户无感知的关键）

### 4.1 /api/payment-methods

服务端聚合「启用渠道 × 渠道支持方式」：

```
GET /api/payment-methods
→ {
  "methods": [
    { "method": "card",   "available": true, "providers": ["creem", "waffo"] },
    { "method": "alipay", "available": true, "providers": ["creem", "waffo"] },
    { "method": "wechat_pay", "available": true, "providers": ["waffo"] }
  ]
}
```

- 前端渲染的是 `method`（Card/Alipay），**完全不出现 provider**
- `available=false` → 前端隐藏按钮，而非报错
- 也可学 ShipAny：只放一个 Buy 按钮 + 货币下拉，让渠道 checkout 页自己展示支付方式（Waffo/Creem 的 cashier 都有「按地区自动展示本地支付方式」能力）

### 4.2 路由逻辑（method → provider）

```
用户点击 "Alipay"
  │
  ▼
POST /api/checkout { product_id, method: "alipay" }
  │
  ├─ 查 payment_settings：enabled 且支持 alipay 的渠道，按 priority 排序
  ├─ 取第一个凭据有效的渠道
  ├─ 渠道不可用（health check 失败）→ 尝试下一个（failover，阶段 3）
  │
  └─ provider.createCheckout() → 返回 checkout_url 重定向
```

**前端永远只传 `method`，不传 `provider`。** 渠道选择是服务端的事，切换对前端完全透明。

---

## 五、配置数据库化（热切换的根基）

### 5.1 payment_settings 表

```sql
CREATE TABLE payment_settings (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) UNIQUE NOT NULL,       -- 'creem' / 'waffo' / 'stripe'
    enabled BOOLEAN NOT NULL DEFAULT true,      -- 是否启用
    priority INT NOT NULL DEFAULT 100,          -- 路由优先级（小者优先，priority 最小 = 默认渠道）
    updated_at timestamptz
);
```

### 5.2 凭据走环境变量（不进数据库）

| 渠道 | 环境变量 |
|------|----------|
| Creem | `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` |
| Waffo（Pancake，2026-08 迁移后收敛为 2 项） | `WAFFO_MERCHANT_ID` / `WAFFO_PRIVATE_KEY`（或 `WAFFO_PRIVATE_KEY_BASE64`）；~~WAFFO_API_KEY / WAFFO_PUBLIC_KEY~~ 已废弃 |
| Stripe（阶段2） | `STRIPE_PRIVATE_KEY` / `STRIPE_WEBHOOK_SECRET` |

`hasValidCredentials()` 检查环境变量是否存在，**避免「配置了渠道但 key 没配」导致 checkout 失败**。

### 5.3 payment_products 表（兼容预建/动态两种定价）

Creem 必须预建 product，Waffo/Stripe 动态金额。统一用映射表：

```sql
CREATE TABLE payment_products (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) UNIQUE NOT NULL,   -- 'starter' / 'standard' / 'premium'
    amount INT NOT NULL,                       -- 分
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    credits INT NOT NULL,
    valid_months INT NOT NULL,
    creem_product_id VARCHAR(255),             -- Creem 预建产品 ID（可空）
    stripe_price_id VARCHAR(255),              -- Stripe 预建 price（可空，阶段2）
    waffo_product_id VARCHAR(255)              -- Waffo Pancake 预建产品 ID（可空，迁移 0018）
    -- 注意：Pancake 迁移后 Waffo 也是预建产品模型，「动态传 amount」语义作废
    created_at timestamptz
);
```

> ⚠️ **渠道扩展决策**（docs/12 已删除，遗留项见 [ADVERSARIAL-REVIEW-2026-08-26.md](../ADVERSARIAL-REVIEW-2026-08-26.md)）：v1 只有 Creem + Waffo，Waffo 动态金额不需要 channel_product_id，仅 Creem 需要一列，稀疏矩阵不成立，故 v1 保持单表。**阶段 2 加 Stripe/PayPal 时**拆为 `payment_products`（渠道无关）+ `channel_products(channel, product_id, channel_product_id)` 两张表，避免渠道列持续膨胀。

Checkout 流程：查 `payment_products` 拿可信金额 → 按渠道适配（Creem 传 product_id，Waffo/Stripe 传 amount）。

> ⚠️ **P1-8（第九轮，2026-08-26）——定价真相源矛盾**：本节「查 `payment_products` 拿可信金额」属「表优先」阵营，
> 与 `docs/05:27` / `docs/15:45` 宣称 `data/pricing.ts` 是「单一真相源」互相矛盾。需先钉死真相源，再重定级管理员定价写入的风险等级。

---

## 六、风控切换 SOP

### 6.1 渠道被封（手动切换，阶段 1 即可用）

```
Creem 被风控
  │
  ├─ 1. 后台 payment_settings：creem.enabled = false
  ├─ 2. /api/payment-methods 实时变化：
  │     支持 alipay 的渠道只剩 waffo → 自动路由 waffo
  ├─ 3. 新订单 payment_provider = waffo；历史订单不动
  └─ 4. 订阅用户迁移见 §7
```

### 6.2 自动降级（✅ failover 已落地，lib/payment/health.ts）

```
createCheckout() 连续 N 次失败（5 次 / 10 分钟）
  │
  ├─ 标记渠道 unhealthy（内存/Redis 缓存，TTL 30 分钟）
  ├─ 同支付方式请求自动路由下一优先级渠道
  └─ 告警通知管理员，人工决定永久禁用
```

### 6.3 两层「路由」的区分（对抗式审查发现）

| 层 | 谁做 | 粒度 | 本项目 |
|----|------|------|--------|
| processor 级 | Waffo 内置 Success Rate Optimization | Waffo 内部通道 | 白嫖，不开发 |
| 渠道级 | 本项目 payment_settings + failover | Stripe/Creem/Waffo 之间 | ✅ 已落地（health.ts + registry 路由） |

> 选 Waffo 还有个隐藏好处：它自己就带 processor 级智能路由 + 欺诈防护，单渠道被封概率本身就低。

---

## 七、订阅跨渠道迁移（最难点，坦诚应对）

### 7.1 问题本质

订阅在渠道 A 扣款，渠道 A 被封 → 无法自动迁移到渠道 B（各渠道不提供跨渠道订阅迁移）。

### 7.2 应对策略

1. **架构降权**：主推一次性积分包，订阅是可选高级功能。积分包无需迁移，新订单走新渠道即可。
2. **迁移 SOP**（订阅用户少时可全手动）：
   - 邮件通知：渠道更换，请重新订阅
   - 用户在新渠道重新下单
   - 服务端检测旧订阅 → 按剩余天数折算积分补偿
3. **长期**：不追求订阅自动迁移，追求「订阅用户占比低」+「积分包承接 90% 需求」。

---

## 八、三阶段实施路线

### 阶段 1（现在）：双渠道 + 手动切换

```
1. Provider 接口 + registry（creem + waffo 两个实现）
2. payment_settings 表 + 后台切换 UI
3. payment_products 表（替代 i18n 定价，P-1.1 一并完成）
4. /api/checkout 统一入口 + /api/payment-methods
5. 独立 webhook 端点：/api/creem-notify + /api/waffo-notify
6. handleOrderPayment(统一 Order) 事务化（P-1.3）
```

### 阶段 2（美国公司后）：无缝加渠道

```
1. 写 lib/payment/providers/stripe.ts 实现接口
2. registry 加一行
3. .env 加 STRIPE_* 凭据
4. payment_settings 插一条
→ 完成，不碰 checkout/webhook/前端代码
```

### 阶段 3（✅ 已落地基础版）：支付路由

```
1. 渠道健康检测（health check + 失败计数）
2. failover 自动降级
3. 可选：按地区/币种/金额的智能路由规则
→ 复用同一 Provider 接口，只加路由层
```

---

## 九、对抗式审查结论（本轮）

### 已吸收的优化点

1. ✅ Waffo 金额字符串 → Provider 接口统一「分」，适配器转
2. ✅ Waffo webhook 响应必须 {"message":"success"} → `webhookResponseBody()` 抽象
3. ✅ Waffo 需 RSA 密钥对 → 环境变量清单补齐
4. ✅ Waffo 幂等键必填 → 统一用 order_no 生成
5. ✅ Waffo userEmail 必填且反欺诈 → checkout 传真实邮箱（getUserEmail 已支持）
6. ✅ Waffo goodsUrl 必填 → CheckoutParams 传产品 URL
7. ✅ Creem 无退款 API / Waffo 有 → `capabilities.refund_api` 标记，退款分发时区分
8. ✅ 两层路由（processor 级 vs 渠道级）区分
9. ✅ payment_products 兼容「预建产品(Creem) vs 动态金额(Waffo/Stripe)」

### 遗留风险（如实标注）

| 风险 | 说明 | 应对 |
|------|------|------|
| Waffo/Creem 费率偏高（4.5%/3.9%） | 比 Stripe(2.9%) 贵 1-1.6 个点 | 阶段 1 接受，阶段 2 切 Stripe 降本 |
| Waffo MoR 模式下税费含在价内 | 定价需考虑含税价 | payment_products 的 amount 定义为含税价 |
| 阶段 2 切 Stripe 后 Card 用户迁移 | Stripe 是 PSP，需自己处理税务 | 美区定价免税州；其余地区仍走 MoR 渠道 |
| PayPal 尚未研究 | 接口细节未知 | 接前先调研，大概率也是动态金额 + 独立签名 |

---

## 十、渠道接入形态与「无缝切换」评估（2026-08-27）

> 背景：渠道风控不确定性（Creem/Stripe 账号可能被限）催生「后台点按钮换渠道、前端用户无感」的诉求。
> 本节给出三渠道官方接入形态对照与无感切换的可行性结论，作为切渠道决策与
> [channel-switch-sop.md](./channel-switch-sop.md) 的依据。接入方式均经官方文档核实（2026-08-27）。

### 10.1 三渠道接入形态对照

| | 托管页跳转（本项目现行） | 站内嵌入 | 原生组件表单（Elements 式） | 白标能力 |
|---|---|---|---|---|
| Stripe | ✅ Checkout Session | ✅ 嵌入式 Checkout（iframe） | ✅ **有**：Payment Element 直接在我方 DOM 渲染卡输入框，Wallets/本地方式一并支持 | 最强：logo/配色 + **自定义收银域名** checkout.你域名.com |
| Creem | ✅ 默认（checkout_url） | ✅ **Embedded Checkout**（overlay 弹层 / inline iframe）：`@creem_io/react`（≥18）/ vue / svelte 组件、`useCreemCheckout()` hook、script loader、声明式属性；`onComplete` 回调可拿到 orderId 且不外跳 | ❌ iframe 方案（页面仍由 Creem 渲染），非真表单 | logo/配色/locale；域名固定 creem.io |
| Waffo Pancake | ✅ 仅此一种（checkoutUrl） | ❌ | ❌ | 深度白标（logo/四色/亮暗/19 语言）；域名固定 waffo 收银域 |

结论：Stripe 是唯一能把「卡输入框长在我方页面上」做成的渠道；Creem 的嵌入只是把 Creem 页面装进我方弹窗；
Waffo 只能跳转。三家的 MoR/PSP 身份差异见 §遗留风险表——这决定了无论嵌入与否，
卡账单商户名与退款政策主体都会随渠道变化，「绝对无感」在法律层面不存在。

### 10.2 无感切换在本模板的可行性结论

**技术上和架构上都成立，且基建已就绪约九成**——这正是本架构的设计目标：

1. `/api/checkout` 只收 `product_id + method`，前端永不感知渠道名；
2. `payment_settings.enabled/priority` 数据库热切换，后台 `/admin/payment` 点按钮即生效、不重部署；
3. `getEnabledProviders` 按 priority 排序 + health.ts 连续失败自动摘除 30 分钟，紧急故障连按钮都不用点；
4. `orders.payment_provider` 下单即冻结：新订单走新渠道，存量在途订单各回各家 webhook（三个 notify 端点并存）；
5. Webhook 归一化为统一 `PaymentEvent` → 所有渠道共用同一套落账 RPC，切渠道零业务代码改动；
6. `GET /api/payment-methods` 聚合可用支付方式，渠道下线时对应按钮自动消失而非报错。

### 10.3 「无感」的真实边界（如实声明，管理预期）

| 边界 | 说明 | 缓解 |
|------|------|------|
| 跳转域名藏不住 | Waffo/Creem 固定自家收银域名，白标只盖住品牌观感 | 切到 Stripe 后配自定义域反而是无感度升级 |
| 支付方式清单随渠道变 | 如 Waffo(Pancake) 无 alipay——/payment-methods 自动反映，按钮增减可见 | 属功能性变化；定价页文案不要写死「支持支付宝」 |
| 卡账单商户名变 | statement descriptor 随 MoR/公司主体变化 | 一次性现象，客服话术预备即可 |
| 订阅不可跨渠道迁移 | 行业难题；订阅用户只能在原渠道续费至到期 | v1 仅一次性积分包，天然绕开；若开订阅按 §七 SOP 折算补偿 |
| 税费口径切换 | MoR 价内税 ↔ Stripe 价外税，语义必须同步调整 | 切换 checklist 强制项：定价页文案 + 本地订单额与实付的比对口径一起改，否则 0010 稳定 mismatch |

### 10.4 切渠道前置条件（已完成状态跟踪）

1. ✅ Waffo 迁移 Pancake（2026-08-27，见 waffo-operations-guide §九）——否则首选渠道本身无官方背书；
2. ✅ `payment_products.waffo_product_id` 加列 + 后台回填入口（迁移 0018 + /admin/pricing）；
3. ✅ 渠道切换 SOP 成文（[channel-switch-sop.md](./channel-switch-sop.md)：沙箱最小闭环 + 灰度分流 + 回滚步骤）。

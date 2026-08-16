# 支付与积分流程文档

> 本文档描述**现状实现**：多渠道（Stripe/Creem/Waffo，Provider 抽象 + 健康检测自动降级）、
> Webhook 金额/币种精确比对（迁移 0010）、退款原子化（迁移 0011）。
> 渠道架构设计见 [payment/provider-abstraction.md](./payment/provider-abstraction.md)；
> 各渠道对接细节见 docs/payment/ 专题文档。

## 1. 支付系统

### 1.1 技术选型

| 项 | 选型 | 版本 |
|----|------|------|
| 支付网关 | Stripe + Creem + Waffo（Provider 抽象，`lib/payment/`） | stripe 17.5.0 |
| 前端 SDK | @stripe/stripe-js | 5.4.0 |
| 支付模式 | Checkout / 托管支付页（各渠道统一抽象为 createCheckout） | - |
| 支付类型 | 一次性付款（v1 启用）；订阅代码存在但不启用（跨渠道订阅迁移是行业难题） | - |
| 渠道路由 | `payment_settings`（数据库热切换）+ 健康检测自动降级（`lib/payment/health.ts`） | - |

### 1.2 定价方案配置

**现状**：定价方案 i18n JSON 仅做文案展示；**金额/积分/有效期以服务端 `data/pricing.ts` 为单一真相源**。

> ✅ **P-1.1 已修复**：Checkout API 只接收 `product_id`，从服务端 `data/pricing.ts` 查价，
> 忽略客户端传入的 `amount`/`credits`/`currency`/`valid_months`，杜绝 0 成本攻击。
> `cn_amount` 字段已从 i18n JSON 与类型定义删除，v1 单一 USD 价。

```typescript
// PricingItem 结构 (types/blocks/pricing.d.ts) —— 展示字段
interface PricingItem {
  title: string;           // "Starter"
  price: string;           // "$99"（展示用）
  original_price: string;  // "$199"（划线价）
  currency: string;        // "USD"
  interval: "one-time" | "month" | "year";
  product_id: string;      // "starter"
  product_name: string;    // "ShipAny Boilerplate Starter"
  is_featured: boolean;    // 是否高亮
  features: string[];      // 功能列表
}
// 金额/积分等收费字段由服务端 data/pricing.ts 决定（P-1.1）
```

**当前方案**：

| 方案 | 价格 | 积分 | 有效期 | 类型 | product_id |
|------|------|------|--------|------|------------|
| Starter | $99 | 100 | 1 个月 | 一次性 | starter |
| Standard | $199 | 200 | 3 个月 | 一次性 | standard |
| Premium | $299 | 300 | 12 个月 | 一次性 | premium |

### 1.3 支付流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  用户     │    │  前端    │    │  API     │    │  Stripe  │
│  浏览器   │    │          │    │  Route   │    │          │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │ 1.点击购买     │               │                 │
     │──────────────>│               │                 │
     │               │ 2.POST /api/checkout            │
     │               │   {credits, amount, interval,   │
     │               │    product_id, currency, ...}   │
     │               │──────────────>│                 │
     │               │               │ 3.鉴权          │
     │               │               │   getUserUuid() │
     │               │               │   getUserEmail()│
     │               │               │                 │
     │               │               │ 4.生成 order_no │
     │               │               │   getSnowId()   │
     │               │               │                 │
     │               │               │ 5.计算过期时间   │
     │               │               │   now + valid_months
     │               │               │   + (订阅? 24h : 0)
     │               │               │                 │
     │               │               │ 6.INSERT orders │
     │               │               │   status=created│
     │               │               │                 │
     │               │               │ 7.创建 Stripe   │
     │               │               │   Session       │
     │               │               │────────────────>│
     │               │               │ 8.session.id    │
     │               │               │<────────────────│
     │               │               │                 │
     │               │               │ 9.UPDATE orders │
     │               │               │   stripe_session_id
     │               │               │   order_detail  │
     │               │               │                 │
     │               │ 10.返回       │                 │
     │               │   {session_id,│                 │
     │               │    public_key,│                 │
     │               │    order_no}  │                 │
     │               │<──────────────│                 │
     │               │               │                 │
     │ 11.重定向到    │               │                 │
     │  Stripe 支付页 │               │                 │
     │──────────────>│               │                 │
     │               │──────────────────────────────────>│
     │ 12.用户输入卡号/支付            │                 │
     │<─────────────────────────────────────────────────│
     │               │               │                 │
     │ 13.支付成功，重定向到           │                 │
     │  /pay-success/{session_id}     │                 │
     │<──────────────│               │                 │
```

### 1.4 Webhook 处理（多渠道统一）

各渠道 webhook（`/api/stripe-notify`、`/api/creem-notify`、`/api/waffo-notify`）
验签方式不同（Stripe HMAC / Creem HMAC / Waffo RSA），但验签后都归一化为
`PaymentEvent`，统一交给 `handlePaymentEvent`（`lib/payment/index.ts`）：

```
渠道服务器            API Route（验签）        handlePaymentEvent         Supabase
     │                    │                        │                      │
     │ POST /api/xxx-notify                        │                      │
     │───────────────────>│ 验签 + parseWebhook    │                      │
     │                    │──归一化 PaymentEvent──>│                      │
     │                    │                        │ payment_succeeded:   │
     │                    │                        │ RPC handle_order_    │
     │                    │                        │ payment（含金额比对）│
     │                    │                        │─────────────────────>│
     │                    │                        │ 'mismatch'? -> 告警  │
     │                    │                        │  人工核查，不充值     │
     │                    │                        │ 'ok'? -> 站内通知 +  │
     │                    │                        │  埋点 + 邮件         │
     │                    │                        │ refund_succeeded:    │
     │                    │                        │ RPC process_order_   │
     │                    │                        │ refund（原子扣积分） │
     │                    │                        │─────────────────────>│
     │ 5.返回 200          │                        │                      │
     │<───────────────────│                        │                      │
```

**金额/币种比对（R1，迁移 0010）**：适配器从渠道原始事件提取实付 `amount`（分）与
`currency`，传入 `handle_order_payment` 与本地订单精确比对。不符时订单置
`status='mismatch'`：不充值、不发联盟奖励、不抛错（抛错会引发渠道无限重试），
应用层 `console.error` + 埋点 `payment.amount_mismatch` 告警，人工核查后可把订单
改回 `created` 重新处理。关联决策：Stripe `allow_promotion_codes` 已禁用
（打折后实付 < 订单额，与精确比对互斥）。

**退款（R3，迁移 0011）**：`process_order_refund` 存储过程单事务完成
「状态检查 + 扣回积分 + 置 refunded」（行锁 + 已退款幂等返回 0）。
两个入口共用：管理后台 `/api/admin/refund`（Stripe/Waffo 走渠道退款 API；
Creem 无退款 API，提示去 Dashboard 手动退）和 `refund.created` webhook
（渠道侧退款完成后回调同步扣积分）。

### 1.5 CNY 支付特殊处理

当 `currency === "cny"` 时，Checkout Session 自动启用中国支付方式：

```typescript
if (currency === "cny") {
  options.payment_method_types = ["wechat_pay", "alipay", "card"];
  options.payment_method_options = {
    wechat_pay: { client: "web" },
    alipay: {},
  };
}
```

### 1.6 订阅模式

| 项 | 一次性付款 | 订阅（月/年） |
|----|-----------|--------------|
| Stripe mode | `payment` | `subscription` |
| interval | `one-time` | `month` / `year` |
| valid_months | 1/3/12 | 1(月) / 12(年) |
| 过期延迟 | 0 | +24h（防止订阅周期间隙） |
| recurring | 无 | `{ interval: interval }` |
| subscription_data | 无 | `{ metadata: options.metadata }` |

### 1.7 支付成功页

```
/pay-success/{CHECKOUT_SESSION_ID}
```

前端通过 `CHECKOUT_SESSION_ID` 查询 Stripe Session 状态，展示支付成功信息。

---

## 2. 积分系统

### 2.1 数据模型

积分不是独立的余额表，而是通过 `credits` 表的流水记录计算得出：

```
用户当前积分 = SUM(credits.credits)
  WHERE user_uuid = ?
    AND ( (credits > 0 AND expired_at >= now()) OR credits <= 0 )
    -- 负数记录 expired_at 为 NULL 永不过期（P-1.2）
```

> ✅ **P-1.2 已修复**：扣减由存储过程 `decrease_credits` 原子执行（行锁 + 余额校验 + FIFO），
> 余额不足抛 `InsufficientCreditsError`，不再透支；负数扣减记录 `expired_at` 为 NULL，
> 杜绝"积分复活"；`getUserCredits` 保留 `Math.max(0)` 仅作展示兜底。

### 2.2 积分交易类型

| 类型 | 枚举值 | 方向 | 数量 | 触发场景 |
|------|--------|------|------|----------|
| 新用户赠送 | `new_user` | +增加 | 10 | 首次 OAuth 登录 |
| 订单充值 | `order_pay` | +增加 | N（按定价方案） | Stripe 支付成功 |
| 系统增加 | `system_add` | +增加 | N | 管理员手动（代码有定义，无 UI） |
| API 消耗 | `ping` | -扣减 | 1 | 调用 /api/ping |
| AI 调用扣费 | `ai_generate` | -扣减 | 预估一次扣清 | 调用 /api/v1/ai/generate（规划，见 [AI 网关](./13-ai-gateway.md)） |
| AI 失败退款 | `ai_refund` | +回补 | 全额 | AI 服务端异常时（规划） |

### 2.3 积分增加流程

```typescript
// services/credit.ts
async function increaseCredits({ user_uuid, trans_type, credits, expired_at, order_no }) {
  const new_credit: Credit = {
    trans_no: getSnowId(),         // Snowflake ID，唯一
    created_at: getIsoTimestr(),
    user_uuid,
    trans_type,
    credits,                       // 正数
    order_no: order_no || "",
    expired_at: expired_at || "",
  };
  await insertCredit(new_credit);  // INSERT credits 表
}
```

### 2.4 积分扣减流程（FIFO 算法）

```typescript
// services/credit.ts
async function decreaseCredits({ user_uuid, trans_type, credits }) {
  // 1. 查询所有有效积分（未过期），按 expired_at 升序（最早过期优先扣）
  const userCredits = await getUserValidCredits(user_uuid);

  // 2. 累加直到找到足够的积分
  let left_credits = 0;
  let order_no = "";
  let expired_at = "";

  for (const credit of userCredits) {
    left_credits += credit.credits;
    if (left_credits >= credits) {
      order_no = credit.order_no;
      expired_at = credit.expired_at || "";
      break;
    }
  }

  // 3. 插入一条负数记录
  const new_credit: Credit = {
    trans_no: getSnowId(),
    created_at: getIsoTimestr(),
    user_uuid,
    trans_type,
    credits: 0 - credits,          // 负数
    order_no,
    expired_at,
  };
  await insertCredit(new_credit);
}
```

**FIFO 策略图示**：

```
用户有 3 笔有效积分：
  ┌──────────────────────────────────────────────────────┐
  │ Credit A: +50  过期: 2024-09-01  (最早过期)          │
  │ Credit B: +100 过期: 2024-12-01                      │
  │ Credit C: +150 过期: 2025-03-01                      │
  └──────────────────────────────────────────────────────┘

需要扣减 120 积分：

  第1步: 累加 Credit A (+50) = 50 < 120，继续
  第2步: 累加 Credit B (+100) = 150 >= 120，停止
         记录 order_no = Credit B.order_no

  插入: Credit D: -120  order_no = Credit B.order_no
                     expired_at = Credit B.expired_at

  结果:
  ┌──────────────────────────────────────────────────────┐
  │ Credit A: +50  过期: 2024-09-01                      │
  │ Credit B: +100 过期: 2024-12-01                      │
  │ Credit C: +150 过期: 2025-03-01                      │
  │ Credit D: -120 过期: 2024-12-01  (新插入)            │
  └──────────────────────────────────────────────────────┘

  有效积分 = 50 + 100 + 150 - 120 = 180

  ⚠️ BUG: 2024-12-01 之后，Credit B(+100) 和 Credit D(-120) 同时过期
  被查询排除，剩余 Credit A(+50, 已过期排除) 和 Credit C(+150)
  有效积分 = 150  ← 应该是 80，凭空多出 70 积分！

  根因：负数扣减记录不应继承原始积分的 expired_at
  修复：负数记录 expired_at 设为 NULL，查询时不做 expired_at 过滤
```

### 2.5 积分余额查询

```typescript
// services/credit.ts
async function getUserCredits(user_uuid: string): Promise<UserCredits> {
  let user_credits: UserCredits = { left_credits: 0 };

  // 检查是否曾付费（is_recharged 标记）
  const first_paid_order = await getFirstPaidOrderByUserUuid(user_uuid);
  if (first_paid_order) {
    user_credits.is_recharged = true;
  }

  // 累加所有有效积分
  const credits = await getUserValidCredits(user_uuid);
  if (credits) {
    credits.forEach((v: Credit) => {
      user_credits.left_credits += v.credits;
    });
  }

  // 不允许负数
  user_credits.left_credits = Math.max(0, user_credits.left_credits);

  // 有积分 = Pro 用户
  if (user_credits.left_credits > 0) {
    user_credits.is_pro = true;
  }

  return user_credits;
}
```

**返回结构**：

```typescript
interface UserCredits {
  one_time_credits?: number;
  monthly_credits?: number;
  total_credits?: number;
  used_credits?: number;
  left_credits: number;      // 当前有效积分
  free_credits?: number;
  is_recharged?: boolean;     // 是否曾付费
  is_pro?: boolean;           // 是否有积分
}
```

> ⚠️ 注意：`one_time_credits`、`monthly_credits`、`total_credits`、`used_credits`、`free_credits` 字段在类型中定义但未实际赋值，始终为 undefined。

### 2.6 订单与积分关联

```
订单支付成功
  │
  ├─> updateCreditForOrder(order)
  │    ├─ findCreditByOrderNo(order.order_no)  // 防重复
  │    │   └─ 已存在 -> return (幂等)
  │    └─ increaseCredits({
  │         user_uuid: order.user_uuid,
  │         trans_type: "order_pay",
  │         credits: order.credits,            // 订单对应的积分数
  │         expired_at: order.expired_at,      // 计算的过期时间
  │         order_no: order.order_no           // 关联订单
  │       })
  │
  └─> updateAffiliateForOrder(order)
       ├─ findUserByUuid(order.user_uuid)
       ├─ 检查 user.invited_by
       ├─ findAffiliateByOrderNo(order.order_no) // 防重复
       └─ insertAffiliate({
            user_uuid: user.uuid,
            invited_by: user.invited_by,
            status: "completed",
            paid_order_no: order.order_no,
            paid_amount: order.amount,
            reward_percent: 20,
            reward_amount: min(order.amount * 0.2, 5000)
          })
```

---

## 3. 联盟营销系统

### 3.1 邀请流程

```
邀请人                    被邀请人                系统
   │                        │                      │
   │ 1.设置邀请码            │                      │
   │  POST /api/update-     │                      │
   │  invite-code           │                      │
   │───────────────────────────────────────────────>│
   │                        │                      │ UPDATE users.invite_code
   │ 2.分享链接              │                      │
   │  /i/{invite_code}      │                      │
   │───────────────────────>│                      │
   │                        │ 3.访问邀请链接        │
   │                        │  /i/{code}           │
   │                        │─────────────────────>│
   │                        │                      │ 4.缓存邀请码到 localStorage
   │                        │ 5.重定向到首页        │
   │                        │<─────────────────────│
   │                        │                      │
   │                        │ 6.注册/登录           │
   │                        │─────────────────────>│
   │                        │ 7.fetchUserInfo      │
   │                        │  检查 localStorage    │
   │                        │  有 invite_code      │
   │                        │                      │
   │                        │ 8.POST /api/update-  │
   │                        │  invite              │
   │                        │  {invite_code, uuid} │
   │                        │─────────────────────>│
   │                        │                      │ 9.UPDATE users.invited_by
   │                        │                      │ INSERT affiliates (pending)
   │                        │                      │
   │                        │ 10.首次付费           │
   │                        │─────────────────────>│
   │                        │                      │ 11.Webhook 触发
   │                        │                      │ handle_order_payment（存储过程，P-1.3）
   │                        │                      │ UPDATE orders paid + INSERT credits
   │                        │                      │ + INSERT affiliates (completed)
   │                        │                      │ reward = min(20% of amount, $50)
```

### 3.2 奖励规则

| 事件 | 奖励比例 | 奖励上限 | 状态 |
|------|----------|----------|------|
| 被邀请人注册 | 0% | $0 | pending |
| 被邀请人首次付费 | 20% | $50 | completed |

```typescript
// services/constant.ts（P-1.8 后）
AffiliateRewardPercent = {
  Invited: 0,    // 注册时
  Paid: 20,      // 付费时（20%）
};

AffiliateRewardAmount = {
  Invited: 0,     // 注册时
  Paid: 5000,     // 付费时（$50 = 5000 分，上限）
};
// reward_amount = min(order.amount * reward_percent / 100, max_reward)
```

> ✅ **P-1.8 已修复**：`reward_amount = min(order.amount * reward_percent / 100, 5000)`，
> 按比例计算并封顶；`Paied` 拼写已改 `Paid`（`services/constant.ts`）。
> 支付成功路径由存储过程 `handle_order_payment`（迁移 0003）原子写入联盟奖励（LEAST(amount*percent/100, max)）。

### 3.3 邀请码限制

- 长度：2-16 字符
- 唯一性：不能与已有邀请码重复
- 自邀限制：不能邀请自己
- 重复限制：被邀请人已有 invited_by 时不可再次绑定
- 时效限制：注册 2 小时内才可绑定邀请关系

> ⚠️ **待补（P-1.4 已部分落地）**：时效限制（注册 2 小时内）目前仍仅在前端 `contexts/app.tsx` 检查。
> P-1.4 已把 user_uuid 从请求体改为 session 获取（防伪造），但 2 小时时效的服务端校验
> 尚未下放 —— 待 6.0/联盟相关改造时一并补上。

### 3.4 奖励发放闭环（⚠️ 待设计）

> **现状缺口**：联盟奖励只写到 affiliates 表（记录 `reward_amount`），流程到「INSERT affiliates (completed)」就结束。邀请人如何拿到奖励、如何查看收益，全无设计。这是「记录完成、发放缺失」的半成品。

**发放方式决策**（二选一，建议方案 A）：

| 方案 | 做法 | 适用 |
|------|------|------|
| A（推荐） | 奖励自动**转积分**：webhook 记录 completed 时，同步 `increaseCredits(inviter_uuid, trans_type="affiliate_reward", credits=折算积分)` | v1 简单闭环，无需提现/法务 |
| B | 记录金额 + 邀请人后台**申请提现**（接 Payout） | 涉及 KYC、税务、跨境提现，重 |

**方案 A 落地要点**：
- 新增积分交易类型 `affiliate_reward`（正数，与 order_pay 区分，便于「我的邀请」页统计）
- 折算规则：`reward_amount`（分）按固定汇率转积分（如 1 元 = 10 积分），或直接按订单积分的 20% 计（更简单：`reward_credits = ceil(order.credits * 20%)`）
- 幂等：与 `updateCreditForOrder` 同款 `findCreditByOrderNo` 防重（复用 affiliates.paid_order_no 唯一性）
- 通知：发放时发邮件 `affiliate_reward`（模板加入 docs/10 触发点表）

**「我的邀请」页补充**：显示「累计邀请 N 人 / 累计奖励 X 积分」，数据来自 affiliates 表 + credits 流水（trans_type=affiliate_reward）。

---

## 4. 支付积分系统问题清单

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| 1 | Webhook 事件覆盖仍偏窄 | 中 | payment_succeeded / refund_succeeded 已统一处理；subscription.deleted/updated 等订阅事件待 v2 启用订阅时补 |
| 2 | ~~单渠道（仅 Stripe）~~ | ~~高~~ | ✅ 已落地：Provider 抽象（Stripe/Creem/Waffo）+ payment_settings 热切换 + 健康检测自动降级 |
| 3 | ~~无退款流程~~ | ~~中~~ | ✅ 已落地：`/api/admin/refund` + `process_order_refund` 存储过程原子扣积分（迁移 0011）；Creem 走 Dashboard 手动退 + webhook 同步 |
| 4 | 无订阅取消流程 | 中 | 用户无法自助取消订阅（6.12 待落地；v1 不启用订阅） |
| 5 | ~~联盟奖励金额固定~~ | ~~低~~ | ✅ P-1.8 已修复：按比例计算并封顶 |
| 6 | ~~积分可为负 + FIFO 余额复活~~ | ~~高~~ | ✅ P-1.2 已修复：decrease_credits 存储过程（行锁+余额校验+负数 expired_at=NULL） |
| 7 | ~~UserCredits 幽灵字段~~ | ~~低~~ | ✅ P-1.8 已修复：删除未实现字段 |
| 8 | ~~/api/update-invite 无认证~~ | ~~高~~ | ✅ P-1.4 已修复：user_uuid 从 session 获取 |
| 9 | ~~无交易事务~~ | ~~高~~ | ✅ P-1.3 已修复：handle_order_payment 存储过程事务化 + 幂等 |
| 10 | 无防重复支付 | 中 | 存储过程行锁 + order 状态幂等已落地（P-1.3），跨实例分布式锁仍需评估 |
| 11 | ~~Webhook 无金额校验~~ | ~~高~~ | ✅ R1 已修复（2026-08）：迁移 0010 金额/币种精确比对，不匹配置 mismatch 状态 + 告警 |

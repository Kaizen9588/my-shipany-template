# 支付与积分流程文档

## 1. 支付系统

### 1.1 技术选型

| 项 | 选型 | 版本 |
|----|------|------|
| 支付网关 | Stripe | 17.5.0 |
| 前端 SDK | @stripe/stripe-js | 5.4.0 |
| 支付模式 | Checkout Session（托管支付页） | - |
| 支付类型 | 一次性付款 + 订阅（月/年） | - |

### 1.2 定价方案配置

定价方案通过 i18n JSON 配置，位于 `i18n/pages/landing/{locale}.json` 的 `pricing` 节点：

```typescript
// PricingItem 结构 (types/blocks/pricing.d.ts)
interface PricingItem {
  title: string;           // "Starter"
  price: string;           // "$99"（展示用）
  original_price: string;  // "$199"（划线价）
  currency: string;        // "USD"
  amount: number;          // 9900（分，传给 Stripe）
  cn_amount: number;       // 69900（人民币分）
  interval: "one-time" | "month" | "year";
  product_id: string;      // "starter"
  product_name: string;    // "ShipAny Boilerplate Starter"
  credits: number;         // 100
  valid_months: number;    // 1
  is_featured: boolean;    // 是否高亮
  features: string[];      // 功能列表
}
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

### 1.4 Webhook 处理

```
Stripe 服务器                API Route              Supabase
     │                         │                      │
     │ 1.POST /api/stripe-notify                     │
     │   (带 stripe-signature header)                 │
     │────────────────────────>│                      │
     │                         │ 2.验证签名            │
     │                         │   constructEventAsync│
     │                         │                      │
     │                         │ 3.判断 event.type    │
     │                         │   = checkout.session │
     │                         │   .completed         │
     │                         │                      │
     │                         │ 4.handleOrderSession │
     │                         │   (session)          │
     │                         │                      │
     │                         │   4a.findOrderByOrderNo
     │                         │─────────────────────>│
     │                         │   4b.UPDATE orders   │
     │                         │      status=paid     │
     │                         │      paid_at, paid_email
     │                         │      paid_detail     │
     │                         │─────────────────────>│
     │                         │                      │
     │                         │   4c.updateCreditForOrder
     │                         │      findCreditByOrderNo
     │                         │      (防重复充值)     │
     │                         │      increaseCredits  │
     │                         │─────────────────────>│
     │                         │      INSERT credits  │
     │                         │      trans_type=order_pay
     │                         │                      │
     │                         │   4d.updateAffiliateForOrder
     │                         │      findUserByUuid  │
     │                         │      (检查 invited_by)│
     │                         │      insertAffiliate  │
     │                         │      status=completed │
     │                         │      reward 20% (max $50)
     │                         │─────────────────────>│
     │                         │                      │
     │ 5.返回 200              │                      │
     │<────────────────────────│                      │
```

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
    AND expired_at >= now()
```

> 这意味着积分可以为负（透支），但 `getUserCredits` 中做了 `Math.max(0, left_credits)` 保护。

### 2.2 积分交易类型

| 类型 | 枚举值 | 方向 | 数量 | 触发场景 |
|------|--------|------|------|----------|
| 新用户赠送 | `new_user` | +增加 | 10 | 首次 OAuth 登录 |
| 订单充值 | `order_pay` | +增加 | N（按定价方案） | Stripe 支付成功 |
| 系统增加 | `system_add` | +增加 | N | 管理员手动（代码有定义，无 UI） |
| API 消耗 | `ping` | -扣减 | 1 | 调用 /api/ping |

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
   │                        │                      │ updateAffiliateForOrder
   │                        │                      │ INSERT affiliates (completed)
   │                        │                      │ reward 20% (max $50)
```

### 3.2 奖励规则

| 事件 | 奖励比例 | 奖励上限 | 状态 |
|------|----------|----------|------|
| 被邀请人注册 | 0% | $0 | pending |
| 被邀请人首次付费 | 20% | $50 | completed |

```typescript
// services/constant.ts
AffiliateRewardPercent = {
  Invited: 0,    // 注册时
  Paied: 20,     // 付费时（20%）
};

AffiliateRewardAmount = {
  Invited: 0,     // 注册时
  Paied: 5000,    // 付费时（$50 = 5000 分）
};
```

> ⚠️ 注意：`reward_amount` 固定为 5000（$50），而非 `order.amount * 0.2`。实际逻辑中 `reward_percent=20` 和 `reward_amount=5000` 同时写入，但 `reward_amount` 是固定值而非按比例计算。

### 3.3 邀请码限制

- 长度：2-16 字符
- 唯一性：不能与已有邀请码重复
- 自邀限制：不能邀请自己
- 重复限制：被邀请人已有 invited_by 时不可再次绑定
- 时效限制：注册 2 小时内才可绑定邀请关系（前端 `contexts/app.tsx` 检查）

---

## 4. 支付积分系统问题清单

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| 1 | Webhook 仅处理 1 种事件 | 高 | 缺少 subscription.deleted/updated, refund.created |
| 2 | 无 Creem 支付 | 高 | 用户无海外卡，需要 Creem |
| 3 | 无退款流程 | 中 | 后台无法发起退款 |
| 4 | 无订阅取消流程 | 中 | 用户无法自助取消订阅 |
| 5 | 联盟奖励金额固定 | 低 | reward_amount 固定 $50，非按比例计算 |
| 6 | 积分可为负 | 低 | 扣减时不检查余额，仅显示时 max(0) |
| 7 | UserCredits 字段未赋值 | 低 | one_time_credits 等字段始终 undefined |
| 8 | /api/update-invite 无认证 | 高 | 依赖参数 user_uuid，可被伪造 |
| 9 | 无交易事务 | 高 | 订单更新+积分充值+联盟记录非原子操作 |
| 10 | 无防重复支付 | 中 | findCreditByOrderNo 做了幂等，但无分布式锁 |

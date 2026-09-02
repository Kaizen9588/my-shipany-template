# 支付与积分流程文档

> 本文档描述**现状实现**：多渠道（Stripe/Creem/Waffo，Provider 抽象 + 健康检测自动降级）、
> Webhook 金额/币种精确比对（迁移 0010）、退款原子化（迁移 0011）。
> 渠道架构设计见 [payment/provider-abstraction.md](./payment/provider-abstraction.md)；
> 各渠道对接细节见 docs/payment/ 专题文档。
>
> ⚠️ **生产就绪状态（2026-08 第八轮审查结论）**：当前支付与积分系统在沙箱/演示环境可用，
> 但**不满足真实收费上线门槛**。核心阻断项：积分过期账本设计缺陷、部分退款与积分回收不一致、
> Webhook 缺少事件 inbox 与强绑定、远端成功本地失败无对账补偿、资金 RPC 权限边界未在数据库层强制。
> 详见本文第 5 节和 [边界规范](./boundary-spec.md)。

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

**现状**：定价方案 i18n JSON 仅做文案展示；**金额/积分/有效期的运行时权威源是 `payment_products` 表**（后台可热改），
`data/pricing.ts` 仅作初始化种子与回退（缺失行时兜底）。谢绝「单一真相源」措辞——那是 P1-8 矛盾的一部分。

> ⚠️ **P1-8（第九轮对抗式审查，2026-08-26）——定价真相源两份文档互相矛盾**：
> 本文件（及 `docs/15`）宣称 `data/pricing.ts` 是「单一真相源」；但 `boundary-spec:45`、
> `docs/02:115/133/153`、`docs/01:377`、`docs/16:194`、`provider-abstraction:230` 共 7 处写的是
> 「`payment_products` 表优先、`data/pricing.ts` 为回退」。**说「唯一真相源」的正是支付主文档本身。**
> 这不是措辞问题：若 DB 表才是权威，那么 §5.2 `P1-定价-1` 所列的「管理员定价更新无事务、无最大金额/货币白名单/积分最小单位/价格积分比例校验、无双人复核」就直接落在**收款金额的权威源**上，应从 P1 升 P0；
> `P-1.1` 那条 ✅（「杜绝 0 成本攻击」）的防线也只覆盖客户端，没覆盖后台。
> **修法**：先钉死哪个是真相源（建议：`payment_products` 表为运行时权威，`data/pricing.ts` 仅作初始化种子/回退），
> 再重定级 `P1-定价-1`，并给定价写入加不变量校验（最大金额、货币白名单、积分/价格比例上下限）+ 事务 + 审计 + 双人复核。

> ✅ **P1-8 定价真相源已钉死（2026-08-30）**：**运行时权威源 = `payment_products` 表**，
> `data/pricing.ts` 仅作初始化种子/缺失行回退。`P1-定价-1` 随之定为 P0 级（真相源即收款金额权威源），
> 已在其承载路由 `app/api/admin/payment-products/route.ts` 落地写入不变量校验：
> 金额/积分/有效期上限、积分 ≤ 金额（杜绝赠送定价）、币种仅 USD（v1 单一货币）——
> 见本文「§4.4 P1-8 定价真相源」与 §5.1 表。双人复核（0030）与事务化批量写入（0033 `apply_payment_config`）已闭合（2026-09-01）；多币种支持 v1 不做。

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
     │               │   {product_id, method?,         │
     │               │    cancel_url?}（金额不上传，   │
     │               │    服务端查价，P-1.1）          │
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
     │               │               │ 7.渠道路由 +    │
     │               │               │   createCheckout│
     │               │               │────────────────>│
     │               │               │ 8.session.id    │
     │               │               │<────────────────│
     │               │               │                 │
     │               │               │ 9.UPDATE orders │
     │               │               │   stripe_session_id
     │               │               │   order_detail  │
     │               │               │                 │
     │               │ 10.返回       │                 │
     │               │   {checkout_url,│                │
     │               │    order_no,   │                 │
     │               │    provider}   │                 │
     │               │<──────────────│                 │
     │               │               │                 │
     │ 11.重定向到    │               │                 │
     │  checkout_url │               │                 │
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
     │                    │                        │ 'paid'（或 recovered）->│
     │                    │                        │  站内通知 + 埋点 + 邮件│
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

### 1.5 CNY 支付特殊处理（⬜ 未实现，规划）

> ⚠️ 现状（2026-08 对抗式审查核验）：代码中无 CNY 分支——`payment_method_types` 固定 `["card"]`、
> `mode` 固定 `"payment"`。以下为目标设计，实现时需同步修改 Stripe 适配器：

```typescript
if (currency === "cny") {
  options.payment_method_types = ["wechat_pay", "alipay", "card"];
  options.payment_method_options = {
    wechat_pay: { client: "web" },
    alipay: {},
  };
}
```

### 1.6 订阅模式（⬜ 未实现，规划）

> ⚠️ 现状：v1 只支持一次性付款（`mode: "payment"` 固定），无 recurring/subscription_data 代码。
> 下表为目标设计：

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

> ✅ 现状（已收敛）：该页为**纯 redirect**，不再查询 Session 状态、不触发落账/
> 邮件（防未授权刷 API）。落账唯一入口是渠道 webhook → `handle_order_payment`。

---

## 2. 积分系统

### 2.1 数据模型

积分不是独立的余额表，而是通过 `credits` 表的流水记录计算得出：

```
用户当前积分 = SUM(credits.credits)
  WHERE user_uuid = ?
    AND ( (credits > 0 AND (expired_at IS NULL OR expired_at >= now())) OR credits <= 0 )
    -- 正数记录：NULL = 长期有效（管理员赠送等，见 docs/03 §3 注释）
    -- 负数记录：expired_at 恒为 NULL 永不过滤（P-1.2）
```

> ⚠️ **第十轮回写时新发现（P3 级）**：本节原公式正数分支缺 `expired_at IS NULL`——SQL 三值逻辑下
> `NULL >= now()` 结果为 NULL（非真），会把「长期有效的正数余额」全部排除，导致余额少算。
> 已按 docs/03 §3 的完整口径修正本节公式；`getUserValidCredits` 的实现应以该口径为准并加对应用例。

> ✅ **P-1.2 已修复**：扣减由存储过程 `decrease_credits` 原子执行（行锁 + 余额校验 + FIFO），
> 余额不足抛 `InsufficientCreditsError`，不再透支；负数扣减记录 `expired_at` 为 NULL，
> 杜绝"积分复活"；`getUserCredits` 保留 `Math.max(0)` 仅作展示兜底。
> ⚠️ 「行锁」部分的并发安全论证不成立，见 §2.4 P0-2（第九轮）。

### 2.2 积分交易类型

| 类型 | 枚举值 | 方向 | 数量 | 触发场景 |
|------|--------|------|------|----------|
| 新用户赠送 | `new_user` | +增加 | 10 | 首次 OAuth 登录 |
| 订单充值 | `order_pay` | +增加 | N（按定价方案） | Stripe 支付成功 |
| 系统增加 | `system_add` | +增加 | N | 管理员手动（代码有定义，无 UI） |
| API 消耗 | `ping` | -扣减 | 1 | 调用 /api/ping |
| AI 调用扣费 | `ai_generate` | -扣减 | 预估一次扣清 | 调用 /api/v1/ai/generate（已落地，见 [AI 网关](./13-ai-gateway.md)） |
| AI 失败退款 | `ai_refund` | +回补 | 全额 | AI 服务端异常时（已落地） |

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

> ✅ **现状（P-1.2 已落地）**：扣减已下沉到数据库存储过程 `decrease_credits`（迁移 0002：
> FOR UPDATE 行锁 + 余额校验 + FIFO，单事务原子），`services/credit.ts` 仅调用
> `rpc("decrease_credits")`，应用层无 check-then-write。余额不足抛 `InsufficientCreditsError`
> （路由层转 402）。负数记录 `expired_at` 恒为 NULL（永不过期，防「积分复活」）。
> 以下旧版应用层实现仅作历史存档，说明 FIFO 思路与当年 BUG：

> ✅ **P0-2 快修已落地（2026-08-30，迁移 `0020_decrease_credits_user_lock.sql`）**：`decrease_credits`
> 入口先取用户级事务 advisory lock（两段 int4 键，pooler 事务模式安全），同一用户并发扣减完全串行化。
> 并发回归测试 `__tests__/credit-concurrency.test.ts`。目标库应用 0020 前不得开放真实收费。
> credit_lots 批次模型仍是长期正解。
>
> ⚠️ **P0-2（第九轮对抗式审查，2026-08-26）——`decrease_credits` 的「行锁串行化」论证不成立**：
> 扣减的写入方式是 **INSERT 一条负数流水**，不是 UPDATE 已有行。`SELECT ... FOR UPDATE` 只锁查询快照里
> **已存在**的行，对并发插入的新行没有谓词锁/间隙锁。所以「锁 + SUM 校验 + INSERT 负数」这套组合在
> append-only 账本上并不等价于串行化——存储过程内部结构正是「应用层禁止的 check-then-write」的 **DB 层翻版**。
> 是否真的能双花，取决于 SUM 校验是与 `FOR UPDATE` 同一条语句，还是解锁后另起一条语句（READ COMMITTED 下后者会重取快照看到对方的提交）。
> 文档没有规定这一点，也没有任何隔离级别分析。**这是一个被标成 ✅ 的、未经论证的并发安全声明，而它保护的是资金。**
> 后果如果成立：直接映射上游 AI 推理成本资损，且 `getUserCredits` 的 `Math.max(0)` 会把负余额显示成 0，运营侧完全不可见。
> **修法（推荐 2）**：
> 1. 快修：`decrease_credits` 开头 `PERFORM pg_advisory_xact_lock(hashtext(p_user_uuid))`（pooler 事务模式必须用**事务级**，session 级不可用）。
> 2. 正解：迁到 `credit_lots` 后改为 `UPDATE credit_lots SET remaining_credits = remaining_credits - x WHERE id = ? AND remaining_credits >= x`，靠 UPDATE 自身行锁 + 返回行数保证原子。这是批次模型相对净额模型的核心收益之一，应补进 §2.4 论证（现在只提过期/退款/审计，完全没提并发）。
> 3. 兜底：`credit_balances(user_uuid PK, balance)` 物化余额行 + `CHECK(balance >= 0)`，让 DB 约束兜底。
> **并发回归测试必须进验收标准**：N 并发扣减，断言余额恒 ≥ 0 且成功次数 = `floor(余额 / 单价)`。

```typescript
// ⬇ 历史存档（已被 decrease_credits RPC 取代，勿照此实现）
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

> ⚠️ **剩余设计缺陷（P0，No-Go）**：上述修复只解决了「积分过期后复活」的问题，
> 但没有解决**批次溯源问题**。当前模型用「永久负数流水 + 净额」表达消费，
> 存在以下根本性缺陷：
>
> 1. **过期后历史消费会抵扣新购积分**：用户购买 +100（一年后过期），消费 50 写 -50（永久）。
>    过期后净额为 -50，服务层裁成 0。用户再买 +100，净额变成 50 而非 100。
>    消费发生在过期前，用户已经付了钱，不应该因为批次过期而损失未来购买力。
> 2. **退款无法定位来源批次**：退款时 `process_order_refund` 用
>    `LEAST(order.credits, current_balance)` 按当前余额猜扣回量，无法知道
>    用户实际消费了哪一批、哪一笔，也无法区分正价购买、赠送、联盟奖励。
> 3. **无法审计资产守恒**：余额是正负流水的净额，无法证明「发放 - 消费 + 退款 = 可用 + 已过期未用」。
>
> **目标架构（v1 收费前必须完成）**：批次账本（credit lots）
> - `credit_lots`：每次发放一个批次（原始数量、剩余数量、过期时间、来源类型/订单）
> - `credit_consumptions`：一次消费拆多条，记录 request/idempotency key、lot、数量
> - `credit_refunds`：退款按实际消费记录回补，禁止凭当前余额猜测
> - 消费按最早过期批次 FIFO 扣减；过期只影响未用余额
> - 余额 = 所有批次剩余量的聚合，审计可证

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

> ✅ **现状（多渠道统一后）**：落账不再由应用层函数编排，而是渠道 webhook →
> `handlePaymentEvent` → `handle_order_payment` RPC（迁移 0010/0017），
> 积分充值与联盟奖励在同一存储过程内完成（行锁 + 双重幂等）：

```
渠道 webhook（验签通过）
  │
  └─> handle_order_payment(order_no, 实付金额/币种, ...)
       ├─ 行锁订单；paid 幂等返回；expired 允许恢复（0017，留审计痕迹）
       ├─ 金额/币种比对 → 不符置 mismatch（不充值、告警人工核查）
       ├─ UPDATE orders → paid
       ├─ 充值积分：NOT EXISTS(credits.order_no) → INSERT order_pay（幂等）
       └─ 联盟奖励：同 paid_order_no 只记一次 + 每个被邀请人仅首笔付费（0017）
```

> 存档说明：`updateCreditForOrder`/`updateAffiliateForOrder`（services 层）仍在代码中，
> 但支付路径无调用方，仅作历史/兜底保留；新集成一律走 RPC 路径。

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

> ✅ 「首次付费」口径已由存储过程强制执行（迁移 0017：同一被邀请人已存在
> completed 奖励行时不再新增；此前 0010 仅按订单去重，后续每笔都会多发）。

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

> ✅ **冲销半边已闭合（2026-09-01，迁移 0028）**：退款/拒付成立时同步把佣金
> `completed → reversed`（终态），`private.reverse_affiliate_reward(p_order_no, p_reason)`
> 由 `processRefund` 与 `dispute_lost` 接线调用——「邀请人与被邀请人合谋：首付拿佣金 → 退款/拒付」
> 的套利口子已堵死。冲销幂等（无佣金/已冲销返回 0）、失败不阻塞退款主流程、
> 结果进 `payment.refund_processed` / `payment.dispute_lost` 埋点 detail（`reversed_affiliate_reward`）。
> 0017 部分唯一索引 `affiliates_single_completed_per_user` 意味着冲销后邀请人可因新的真实订单
> 再次获得佣金（可接受：冲销只作废该笔订单的奖励）。「我的邀请」页已渲染 `reversed` 状态。
> 下文发放方式决策仍待设计。

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

## 4. 退款设计现状与生产边界

### 4.1 当前退款模型

管理端 `POST /api/admin/refund` 接受任意 `amount`，调用对应渠道退款 API，成功后统一走
`process_order_refund` RPC（迁移 0011）扣回积分并将订单置为 `refunded`。

**当前实现的关键假设**：退款 = 全额退款，积分 = 整单积分一次性扣回。

### 4.2 部分退款风险（P0，No-Go）

> ⚠️ **当前 `process_order_refund` 不区分退款金额**：无论渠道退了多少，
> 只要进入退款路径就把订单标为 `refunded`，并按 `MIN(订单积分, 用户当前余额)`
> 扣回积分。这与管理端可传任意 `amount` 存在根本矛盾。

**攻击/事故场景**：

1. 管理员输入部分退款金额（如 $10 of $99），Stripe 只退 $10，
   本地却把整单标为 `refunded` 并尽量扣回全部 100 积分 → 用户损失超额积分。
2. 渠道退全款，但用户积分余额不足（已消费了部分），只扣回一部分，
   订单仍标 `refunded` → 平台承担已消费部分的损失，且无法向用户解释。
3. 渠道退款 API 成功后 `process_order_refund` 失败，重试因渠道幂等限制
   或订单状态变化无法补齐 → 渠道已退款、本地未扣积分。
4. 同一订单多次部分退款需要累计金额，但当前状态只有 `paid/refunded` 两态。

### 4.3 整改路径（二选一，v1 收费前必须明确）

| 方案 | 做法 | 适用 |
|------|------|------|
| A（v1 安全收敛，推荐） | **只允许严格全额退款**：服务端以订单原始金额为准，拒绝任意 `amount`；管理端只提供「全额退款」按钮；全额退款成功后订单才进 `refunded` | 简单可靠，v1 快速收口 |
| B（完整方案） | 新增 `refunds` 表（provider、provider_refund_id、requested/received amount、currency、status、event_id、idempotency key），订单状态支持 `partially_refunded/refunded`，积分按实际退款比例或按消费批次回收 | 规模化运营必须 |

> 无论选哪种方案，都必须解决：渠道退款与本地积分回收的**金额一致性**、
> **幂等性**、**失败重试**和**审计可追溯**。

> ⚠️ **P0-1（第九轮对抗式审查，2026-08-26）——上述方案 A 和 B 对「已消费积分」都没有回收路径，都不闭环**：
> **失败时序**：
> 1. 付款成功，`handle_order_payment` 发放 300 积分。
> 2. 用户当天把 300 积分全部消费在 AI 调用上（上游算力成本已实际发生）。
> 3. 用户向渠道申诉退款，`refund.created` webhook 到达。
> 4. `process_order_refund` 扣回 `LEAST(订单积分 300, 当前余额 0)` = **0**。
> 5. 订单进终态 `refunded`，钱全退，余额 0。
> 方案 A（只允许严格全额退款）对已消费部分**零覆盖**，反而把「可能白嫖」变成「必然白嫖」；
> 方案 B（按比例/按消费批次回收）在批次 `remaining_credits` 已归零时**无回收对象**——全库没有任何负批次/欠款的表达。
> **真正缺的不是账本形态，是退款准入校验 + 债务化**：webhook 一到就无条件终态化，没有需要人工决策的中间态。
> **修法**：
> 1. `orders` 增加 `refund_requested` / `refund_blocked` 状态；webhook 到达只**登记退款事实**并触发资产回收流程，不再直接写 `refunded`，终态由回收流程闭合。
> 2. 退款准入校验：`refundable_amount = order.amount × (该订单批次 remaining_credits / 订单发放积分)`。默认只放行未消费比例；超出部分走显式审批（记 operator + reason）。
> 3. 越权全额退款时把差额债务化：`credit_lots` 增加 `debt` 类型，或独立 `credit_debts(user_uuid, order_no, credits, status)`；账号进 `restricted`，清偿前禁止消费与再次下单。
> 4. AI 网关侧对「新账号 + 首充后 24h 内高速耗尽积分」加节流，把白嫖窗口拉长到超过渠道退款风控识别时间。
> 5. 业务层兜底：退款条款写明「已消费积分不予退还」，争议举证材料（调用日志 + 消费流水）在 dispute 时可导出。
> **客观边界**：损失上界是 COGS 不是收入（每轮仍需真实付款并过 MoR 反欺诈）；但 Creem 无退款 API、MoR 对消费者申诉极宽松，这条路随时会被触发。

> ✅ **P0-1 部分落地（2026-08-30）**：迁移 `0021_refund_debt_dispute.sql` 新增
> ①`credit_debts`（欠款账本：user_uuid/order_no/due_credits/status，UNIQUE(user_uuid,order_no)）、
> ②`refunds`（退款单：provider_refund_id/amount_cents/status）、③`orders.status` 扩展
> `refund_requested`/`refund_blocked`（CHECK 放宽）、④存储过程 `debt_regulate_order_refund`——
> 超额扣回差额写欠款 + 订单置 `refund_blocked` + 账号置 `restricted`。
> `services/refund.ts` 的 `processRefund` 在扣回量 < 订单发放积分时自动触发债务化，测试覆盖
> `__tests__/refund.test.ts` + `__tests__/dispute.test.ts`。
>
> ✅ **webhook 中间态已接线（2026-08-30 第七批）**：迁移 `0022_webhook_refund_registration.sql`
> 新增存储过程 `register_order_refund_request`（refunds 退款单 + 订单置 `refund_requested`
> 中间态 + `debt_regulate_order_refund` 债务化准入，provider_refund_id/同订单 pending 幂等），
> 并扩展 `process_order_refund` 接受 `refund_requested` 状态（登记后由后台闭合）。
> `lib/payment/index.ts` 的 `refund_succeeded` 分支改为调 `services/refund.ts`
> `registerRefundRequest`——**webhook 到达只登记事实，不再直接扣积分/终态化**；
> 缺 `user_uuid` 的事件不登记不回收，告警人工核查。admin 退款路径（`/api/admin/refund`）
> 保持 `processRefund` 直回收 + 终态（管理员已决策）。`PaymentEvent` 增加
> `provider`/`provider_ref_id` 字段，三渠道适配器（stripe/creem/waffo）已填充。
> **仍待办**：①迁移 0021/0022 未应用（待连库，见 handoff §1.4）；②部分退款/多次退款准入校验
> 用 credit_lots 精确批次计算（当前为近似口径 + 债务化兜底）；③后台回收工作台
> （消费 refund_requested/refund_blocked 队列的运营界面）随审批队列一起排产。

---

## 5. 生产安全门槛与待建能力

> 本节汇总第八轮对抗式审查中支付与积分模块的阻断项和高风险项。
> 等级：P0 = 阻断上线（No-Go）｜P1 = 规模化运营前必须完成｜P2 = 首个稳定版本前

### 5.1 P0 阻断项（真实收费前必须关闭）

| # | 风险 | 根因 | 验收标准 |
|---|------|------|----------|
| P0-积分-1 | 积分过期账本会在过期后改变历史消费结果 | 永久负数流水 + 净额模型无法区分批次 | 引入 credit_lots + credit_consumptions，跨批次消费/过期/退款后余额可审计且不凭空增减 |
| P0-退款-1 | 部分退款与积分回收不一致 | `process_order_refund` 不区分退款金额，统一标 refunded | **退款准入校验 + 已消费额度债务化 + refund_blocked 人工态**三项齐备（原「v1 只允许全额退款，或完成 refunds 表 + 比例/批次扣回」验收标准有洞，照它关闭后资金口子依然敞着，见 §4.3 P0-1）。⚠️ 部分完成（2026-08-30）：债务化 + refund_blocked + restricted 落地（`credit_debts`/`refunds`/`debt_regulate_order_refund` + `processRefund` 债务化，见 §4.3 链接块）；**webhook 中间态已接线（迁移 0022 + `registerRefundRequest`，见 §4.3 第七批块）**；准入校验（credit_lots 精确批次）与回收工作台待补，迁移 0021/0022 未应用 |
| P0-Webhook-1 | Webhook 缺少事件 inbox 与强绑定 | 仅凭订单号处理，无 provider_event_id 唯一约束，无原始 body 留存 | 统一 webhook_inbox 表，(provider, provider_event_id) 唯一，原始 body 持久化，处理可重试 |
| P0-对账-1 | 远端支付成功、本地落库失败无可靠恢复 | 先建远端 checkout 再写本地，失败后渠道收入无对账单据 | 本地先建订单 + 幂等键；每日对账：渠道成功/退款清单 vs 本地订单/积分/退款；差异告警 + 人工修复 |
| P0-金额-1 | 金额/币种空值可绕过校验 | `handle_order_payment` 参数为空时跳过校验 | 空金额/空币种一律失败并告警；金额统一为最小货币单位整数，禁止浮点 |
| ~~P0-定价-1~~ | ~~管理员定价写入落在收款金额权威源上~~ | 逐条非事务；无上限/币种白名单/比例校验 | ✅ 全部关闭：加固（2026-08-30，上限+白名单+比例校验）；双人复核（0030 审批队列）；事务化批量写入（2026-09-01，0033 `apply_payment_config` RPC 原子写入 + DB 层不变量再验） |

### 5.2 P1 高风险项

| # | 风险 | 说明 |
|---|------|------|
| P1-定价-1 | ~~管理员定价更新缺少不变量校验~~ | ✅ 已加固（2026-08-30，重定为 P0 关闭项）：真相源钉死为 `payment_products`，写入路由已加金额/积分/有效期上限 + 币种白名单(USD) + 积分≤金额（详见上表 P0-定价-1 与 §1.2 落地块）。双人复核（0030）与事务化批量写入（0033）已闭合；多币种（v1 不做） |
| P1-Webhook-1 | Webhook 无重放/乱序防护 | 签名验了，但同一事件并发重放、乱序到达可能造成状态机错误；需 inbox + 幂等 + 状态校验 |
| P1-联盟-1 | 联盟奖励只有记录、没有发放闭环 | 只写 `affiliates.completed` + `reward_amount`，无转积分/提现；~~退款回冲~~ ✅ 已闭合（0028：refund/dispute_lost 冲销佣金）；转积分/提现仍待设计（§3.4） |
| P1-邀请-1 | 邀请绑定存在竞态 | 「读取→更新→插入」非事务；2 小时时效仅前端校验；并发可能产生重复邀请记录 |
| P1-调账-1 | 管理员积分调账缺少双重控制 | 加减积分属于资产变更，应要求原因、工单号、上限、审批；统一 ledger API，禁止直接写表 |
| P1-订单-1 | 远端 checkout 与本地订单创建顺序不当 | 先建远端 session 再写本地，失败时可能产生"孤儿 session"，需补偿查询 |

### 5.3 P2 中风险项

| # | 风险 | 说明 |
|---|------|------|
| P2-对账-1 | 无用户可见的交易明细与账单 | 用户只能看余额，无法逐笔核对；客服缺少全链路查询工具 |
| P2-发票-1 | 无发票/收据生成与下载 | 成熟 SaaS 标配；MoR 渠道（Creem/Waffo）可由渠道提供 |
| P2-支付-1 | 无支付方式管理与保存 | v1 每次重输；订阅场景必须 |
| P2-1（第九轮） | 积分有效期在下单时刻冻结 | `orders.expired_at` 在创建 checkout 之前就按 `now + valid_months` 算好并随订单 INSERT，用户在收银台/3DS 停留时间全由用户承担（对 1 个月方案约吃掉 3%），详见 §7 |
| P2-2（第九轮） | 争议/拒付（chargeback）全链路缺失 | `PaymentEventType` 无争议类型、`orders.status` 无 `disputed/charged_back`，Stripe 事件白名单漏 `charge.dispute.created/closed`，详见 §7 |

---

## 6. 历史问题跟踪表

| # | 问题 | 严重程度 | 状态 | 说明 |
|---|------|----------|------|------|
| 1 | Webhook 事件覆盖仍偏窄 | 中 | 待 v2 | payment_succeeded / refund_succeeded 已统一处理；subscription.deleted/updated 待 v2 启用订阅时补 |
| 2 | ~~单渠道（仅 Stripe）~~ | ~~高~~ | ✅ 已落地 | Provider 抽象（Stripe/Creem/Waffo）+ payment_settings 热切换 + 健康检测自动降级 |
| 3 | ~~无退款流程~~ | ~~中~~ | ✅ 已落地 | `/api/admin/refund` + `process_order_refund` 存储过程原子扣积分（迁移 0011）；但部分退款仍有缺陷（见 4.2） |
| 4 | 无订阅取消流程 | 中 | 待 v2 | 用户无法自助取消订阅；v1 不启用订阅 |
| 5 | ~~联盟奖励金额固定~~ | ~~低~~ | ✅ 已落地 | P-1.8 已修复：按比例计算并封顶 |
| 6 | ~~积分可为负 + FIFO 余额复活~~ | ~~高~~ | ⚠️ 部分修复 | P-1.2 修复了余额复活；但批次溯源/退款定位仍有根本缺陷（见 2.4 剩余设计缺陷） |
| 7 | ~~UserCredits 幽灵字段~~ | ~~低~~ | ✅ 已落地 | 删除未实现字段 |
| 8 | ~~/api/update-invite 无认证~~ | ~~高~~ | ✅ 已落地 | user_uuid 从 session 获取；但竞态和时效校验仍有缺口（见 5.2 P1-邀请-1） |
| 9 | ~~无交易事务~~ | ~~高~~ | ✅ 已落地 | handle_order_payment 存储过程事务化 + 幂等 |
| 10 | 无防重复支付 | 中 | ⚠️ 部分修复 | 存储过程行锁 + order 状态幂等已落地；但缺少 webhook inbox 与分布式对账 |
| 11 | ~~Webhook 无金额校验~~ | ~~高~~ | ⚠️ 部分修复 | 迁移 0010 金额/币种精确比对；但空值可绕过校验（见 5.1 P0-金额-1） |

---

## 7. 第九轮对抗式审查（2026-08-26）新增整改项

> 本节收录第九轮对抗式审查中支付与积分模块的新发现与整块缺失。P0-1（退款债务化）、P0-2（扣减并发）、
> P1-8（定价真相源）的完整分析已分别写入 §4.3、§2.4、§1.2；本节补 P2-1、P2-2 与「方案里整块缺失」中归属本模块的部分。

### 7.1 P2-1 积分有效期在下单时刻冻结

`orders.expired_at` 注释是「积分过期时间」，但它在 §1.3 第 5 步（**创建 checkout 之前**）就按 `now + valid_months`
算好并随订单 INSERT——有效期从下单时刻而非付款时刻起算，用户在收银台停留、3DS 验证的时间全由用户承担。
上界约等于渠道 session 窗口（Stripe/Creem 都是 24h），对最短的 1 个月方案约吃掉 3%。

**修法**（随批次账本改造一起做，成本很低）：
1. 批次 `expired_at` 在 `handle_order_payment` 内以 `paid_at + valid_months` 计算。
2. `orders` 只存 `credit_valid_months` 策略，`expired_at` 改为支付时回填的派生列。
3. 另加 `checkout_expires_at`（下单时写，定时任务只扫它，对齐渠道 session 生命周期 24h）——顺带定义清楚超时任务的时间基准，`docs/03` 目前完全没写。
4. `expired→paid` 恢复设最大迟到窗口（如 7 天），超窗落 `late_paid` 走人工决策，禁止静默充值。

### 7.2 P2-2 争议/拒付（chargeback）全链路缺失

全 `docs/` 目录 grep `dispute|chargeback|争议|拒付` 只命中 2 处——Creem §3.5 一行（处理动作「记录日志」）和 Waffo
能力表一行。**Stripe §2.3 的 6 个待处理事件里根本没有** `charge.dispute.created/closed`。

`PaymentEventType` 没有争议类型，`orders.status`（created/paid/expired/refunded/mismatch/deleted）没有
`disputed`/`charged_back`，所以即使收到事件也无处归一化。而 §6 把 webhook 覆盖缺口归结为「subscription 相关、待 v2」——
**争议与订阅无关，v1 一次性付款同样会发生，被漏识别了**。

定 P2 而非 P1 的理由：v1 是 MoR 渠道（Creem 是法律意义上的卖方，Waffo 内置 chargeback 防御），拒付率与商户存活主要由渠道承担；
资金在收到事件前已被扣走，增量损失只是「已消费积分不追回 + 账号未冻结可重复作恶」。

**修法**（成本很低）：
1. `PaymentEventType` 加 `dispute_opened / dispute_lost / dispute_won`。
2. `orders` 加 `disputed / charged_back`。
3. `dispute_opened` 立即冻结该用户积分消费（保留余额不删）+ ~~挂起联盟奖励~~（✅ 已按订单粒度落到 dispute_lost 冲销：拒付成立才回收佣金，0028）+ 订单收入移出可确认收入（✅ stats 收入口径只认 `status='paid'`，disputed/charged_back/refunded 天然不计入）。
4. `dispute_lost` 复用 P0-1 的资产回收 + 债务化 + 风控标记路径（✅ 已加联盟佣金冲销，0028）。
5. `dispute_won` 解冻。
6. 三份渠道文档的事件白名单显式列出争议事件，「已在渠道后台订阅争议事件」写进上线检查项。

### 7.3 账号风险状态机（整块缺失）

资金状态机目前只有 refund 一条追回路径，没有 `restricted` / 欠款 / 冻结消费的概念，所以退款滥用、拒付、
债务未清偿三类场景都无处落地。`docs/04` 的封禁是通用管理动作，不是资金风控的一环。需在用户/订单状态机上增加：
`restricted`（清偿前禁止消费与再次下单）、欠款记录（`credit_debts`）、风控标记与人工审批流。

### 7.4 退款与滥用的业务条款层（整块缺失）

全仓没有「退款政策 / 已消费不退 / 争议举证材料清单」的任何设计。纯技术闭环做不到，行业通行是**条款 + 风控 + 举证**三件套：
1. 退款条款写明「已消费积分不予退还」。
2. 争议举证材料（调用日志 + 消费流水）在 dispute 时可导出。
3. 风控节流：新账号 + 首充后 24h 内高速耗尽积分加节流，拉长白嫖窗口超过渠道退款风控识别时间。

### 7.5 对账口径的完整定义（整块缺失）

P0-对账-1 只写了「渠道成功/退款清单 vs 本地订单/积分/退款」，没有争议、没有「退款成功但积分回收为 0」的专项差异规则，
也没有对账失败的处置 SLA。对账口径必须补：争议差异、`refunded` 但 `credits_refunded=0` 的专项差异规则、对账失败处置 SLA。

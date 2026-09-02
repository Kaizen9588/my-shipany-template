# 数据库设计文档

## 概述

- **数据库类型**：PostgreSQL（Supabase 托管；本地开发可用 Supabase CLI，见 [07-deployment.md §5.2](./07-deployment.md)）
- **客户端**：@supabase/supabase-js（无 ORM，直接调用 Supabase Client）；迁移执行用 `pg` 直连 `DATABASE_URL`
- **建表脚本**：唯一建库路径是 `data/migrations/0000_install_base.sql` 起的顺序迁移；`data/install.sql` 是历史脚本，禁止用于新库或生产库
- **迁移机制**：`pnpm migrate` 是唯一可写 schema 的入口，按文件名序号执行并使用 `schema_migrations` 记录版本、事务级 advisory lock 串行化多实例；应用启动时 `instrumentation.ts` 仅只读校验版本，发现缺失迁移立即拒绝启动（见 `lib/migrate.ts`）
- **迁移清单**（0000-0019）：基础建表 / 支付配置表 / 积分原子扣减 / 支付事务化 / 外键索引 / 匿名额度 / 密码登录 / 多渠道 / RBAC+审计 / 站内通知 / 金额比对 / 退款原子化 / 安全管理员引导字段 / system_settings / op_events / apikeys 前缀 / 匿名额度 off-by-one / 迟付恢复+联盟首付 / 历史默认账号禁用
- **迁移清单**（0020-0028）：decrease_credits 用户级 advisory lock / refund_requested + credit_debts / 债务化准入 / 债务审计重键 / 资金 RPC 迁 private（0023）/ 全表 RLS deny-all（0024）/ 验证码列宽（0025）/ credit_lots 批次（0026）/ 默认管理员 pending_activation（0027）/ 联盟奖励冲销 `private.reverse_affiliate_reward`（0028，退款/拒付佣金 `completed→reversed`）
- **表数量**：16 张（迁移 0000 基础 7 张 + 迁移新增 9 张，含 system_settings、op_events）
- **存储过程**：资金与额度相关写操作全部下沉数据库原子执行（见文末「存储过程」一节），应用层不做 check-then-write

> ✅ **生产就绪状态（更新于 2026-09-01 连库收尾）**：~~资金 RPC 权限边界不成立~~
> **已关闭**——五个资金函数已迁入 `private` schema 并仅授权 service_role（迁移 0023），
> `credits/orders/refunds/credit_debts` 已启用 RLS，真实并发用例 4/4 通过（P0-2）。
> ~~public 其余业务表 RLS 未启用~~ **已关闭（迁移 0024）**——public 全部 19 张业务表
> ENABLE RLS（deny-all）+ REVOKE anon/authenticated 表特权，anonymous_usage 两 RPC
> search_path 钉死 + 仅授 service_role；连库验证 anon 直查全 401、应用关键路径回归通过。
> 0024 回归同时暴露并修复两个预存 bug：0025（verification_codes.code 列宽不足，
> 注册/重置全挂）+ consumeVerificationCode 未传 `{ count: "exact" }`（恒 false）。
> ~~credit lots 精确批次改造仍未做~~ **已关闭（迁移 0026，2026-09-01 连库）**——
> `credit_lots` 批次账本 + `credit_consumptions` 消费明细，批次 FIFO 扣减、退款按
> 订单批次精确准入（防先消费再退款稀释 + 防过期套利）、`settle_credit_debt` 清偿闭环；
> 真库 e2e 全链路通过。
> **剩余缺口**：`apikeys.api_key` 等敏感列暴露（advisors 2026-09-01）。
> 详见本文第 5 节与 handoff §1.17/§1.18/§1.19。

> ⚠️ **第九轮对抗式审查（2026-08-26）新增阻断项，详见文末「存储过程」与「问题清单」**：
> - **P0-2**：`decrease_credits` 的「行锁串行化」论证不成立（INSERT 负数流水 + `FOR UPDATE` 只锁已存在行，append-only 账本上不等价于串行化，保护资金的并发安全声明未经论证）。
> - **P0-3（已关闭，2026-08-30）**：0012 不再种入公开管理员，0019 会禁用历史固定 hash 账号；初始管理员仅在显式设置 `ADMIN_BOOTSTRAP_EMAIL` 的受控迁移阶段创建。
> - **P1-5**：`ai_requests.request_id` 若做成全局 `UNIQUE` 会变成「客户端可控的公共键空间」，需改为 `UNIQUE(user_uuid, request_id)`。
> - **P1-6（已关闭，2026-08-30）**：新库只运行 `pnpm migrate`；检测到未登记的历史 `users` 表会 fail-fast，避免 `install.sql` 与 0000 基线混用。
> - **P1-7（部分关闭，2026-08-30）**：迁移器已加事务级 advisory lock、单事务回滚和运行时只读版本校验；`CONCURRENTLY` 索引的专用发布步骤与 expand-contract 规则仍待补齐。
> - **P2-1**：`orders.expired_at` 在下单时刻冻结，有效期应从 `paid_at` 起算。

## ER 关系图

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   users     │       │   orders    │       │   credits   │
│─────────────│       │─────────────│       │─────────────│
│ id (PK)     │◄──┐   │ id (PK)     │   ┌──►│ id (PK)     │
│ uuid (UQ)   │   │   │ order_no(UQ)│   │   │ trans_no(UQ)│
│ email       │   │   │ user_uuid───┼───┘   │ user_uuid   │
│ nickname    │   │   │ amount      │       │ trans_type  │
│ avatar_url  │   │   │ credits     │       │ credits     │
│ invite_code │   │   │ status      │       │ order_no    │
│ invited_by──┼───┘   │ stripe_sess │       │ expired_at  │
│ is_affiliate│       │ sub_id      │       │ created_at  │
│ created_at  │       │ created_at  │       └─────────────┘
└──────┬──────┘       │ expired_at  │
       │              └──────┬──────┘
       │                     │
       │    ┌────────────────┘
       │    │
       │    ▼
       │  ┌─────────────┐
       │  │ affiliates  │
       │  │─────────────│
       │  │ id (PK)     │
       │  │ user_uuid   │
       │  │ invited_by──┼──► users.uuid
       │  │ paid_order_no
       │  │ reward_pct  │
       │  │ reward_amt  │
       │  │ status      │
       │  └─────────────┘
       │
       ├─► ┌─────────────┐
       │   │  apikeys    │
       │   │─────────────│
       │   │ id (PK)     │
       │   │ api_key(UQ) │
       │   │ user_uuid   │
       │   │ title       │
       │   │ status      │
       │   │ created_at  │
       │   └─────────────┘
       │
       └─► ┌─────────────┐
           │   posts     │
           │─────────────│
           │ id (PK)     │
           │ uuid (UQ)   │
           │ slug        │
           │ title       │
           │ content     │
           │ status      │
           │ locale      │
           │ created_at  │
           │ updated_at  │
           └─────────────┘
```

## 表结构详解

### 1. users - 用户表

```sql
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    uuid            VARCHAR(255) UNIQUE NOT NULL,    -- UUID v4，业务主键
    email           VARCHAR(255) NOT NULL,
    created_at      timestamptz,
    nickname        VARCHAR(255),
    avatar_url      VARCHAR(255),
    locale          VARCHAR(50),                     -- 用户语言偏好
    signin_type     VARCHAR(50),                     -- "oauth" 等
    signin_ip       VARCHAR(255),                    -- 登录 IP
    signin_provider VARCHAR(50),                     -- "google" / "github"
    signin_openid   VARCHAR(255),                    -- OAuth providerAccountId
    invite_code     VARCHAR(255) NOT NULL DEFAULT '',-- 用户自己的邀请码
    updated_at      timestamptz,
    invited_by      VARCHAR(255) NOT NULL DEFAULT '',-- 邀请人 UUID
    is_affiliate    BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (email, signin_provider)                  -- 同一邮箱可用不同 provider 注册
);
```

**字段说明**：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| id | SERIAL | 自增主键 | 1 |
| uuid | VARCHAR(255) | UUID v4，业务主键 | "a1b2c3d4-..." |
| email | VARCHAR(255) | 邮箱（非唯一，与 provider 组合唯一） | "user@example.com" |
| nickname | VARCHAR(255) | 昵称 | "张三" |
| avatar_url | VARCHAR(255) | 头像 URL | "https://..." |
| locale | VARCHAR(50) | 语言偏好 | "zh" / "en" |
| signin_type | VARCHAR(50) | 登录类型 | "oauth" |
| signin_ip | VARCHAR(255) | 登录 IP | "1.2.3.4" |
| signin_provider | VARCHAR(50) | OAuth 提供商 | "google" / "github" |
| signin_openid | VARCHAR(255) | OAuth ID | "123456789" |
| invite_code | VARCHAR(255) | 自己的邀请码 | "wangcw" |
| invited_by | VARCHAR(255) | 邀请人 UUID | "a1b2c3d4-..." |
| is_affiliate | BOOLEAN | 是否为联盟成员 | false |

**索引**：
- `UNIQUE (uuid)` - UUID 唯一
- `UNIQUE (email, signin_provider)` - 邮箱+提供商组合唯一
- 无显式索引（Supabase 自动为 PK 和 UNIQUE 建索引）

**缺失索引**（建议补充）：
- `invite_code` - 按邀请码查询用户（`findUserByInviteCode`），高频查询
- `invited_by` - 按邀请人查询（联盟统计），中频查询
- `email` - 按邮箱查询用户（`findUserByEmail`），高频查询

---

### 2. orders - 订单表

```sql
CREATE TABLE orders (
    id                  SERIAL PRIMARY KEY,
    order_no            VARCHAR(255) UNIQUE NOT NULL,  -- Snowflake ID
    created_at          timestamptz,
    user_uuid           VARCHAR(255) NOT NULL DEFAULT '',
    user_email          VARCHAR(255) NOT NULL DEFAULT '',
    amount              INT NOT NULL,                  -- 金额（分）
    interval            VARCHAR(50),                   -- "one-time"/"month"/"year"
    expired_at          timestamptz,                   -- 积分过期时间
    status              VARCHAR(50) NOT NULL,          -- "created"/"paid"/"expired"/"refunded"/"mismatch"/"deleted"
    payment_provider    VARCHAR(50) DEFAULT 'stripe',  -- 多渠道（0007）：checkout 时冻结
    stripe_session_id   VARCHAR(255),                  -- Stripe Checkout Session ID
    credits             INT NOT NULL,                  -- 购买积分数
    currency            VARCHAR(50),                   -- "USD"/"CNY"
    sub_id              VARCHAR(255),                  -- Stripe 订阅 ID（预留，无订阅产品）
    product_id          VARCHAR(255),                  -- 产品 ID
    product_name        VARCHAR(255),                  -- 产品名称
    valid_months        INT,                           -- 积分有效月数
    order_detail        TEXT,                          -- Session/SDK 参数 JSON
    paid_at             timestamptz,                   -- 支付时间
    paid_email          VARCHAR(255),                  -- 支付邮箱
    paid_detail         TEXT                           -- 支付详情 JSON
);
```

**状态流转**（refunded/mismatch 已落地）：

```
created ──(支付成功 webhook)──> paid ──(退款)──> refunded
   │
   ├──(webhook 实付金额/币种与订单不符, 0010)──> mismatch（不充值、不发奖励，人工核查后可改回 created 重新处理）
   ├──(超时未支付，定时任务)──> expired ──(迟到支付 webhook, 0017)──> paid（钱已实收必须落账，order_detail 留恢复痕迹）
   └──(手动删除)──> deleted
```

> `mismatch` 是 R1 资金安全修复（迁移 0010）引入的状态：`handle_order_payment` 收到
> `p_amount_cents`/`p_currency` 后与订单金额精确比对，不符时置 `mismatch` 而非充值。
> 该状态不会被 expire 定时任务触碰（任务只扫 `status='created'`）。

> ⚠️ **P2-1（第九轮，2026-08-26）——积分有效期在下单时刻冻结**：`expired_at` 在创建 checkout 之前就按
> `now + valid_months` 算好并随订单 INSERT，有效期从下单时刻而非付款时刻起算，收银台/3DS 停留时间全由用户承担。
> 修法（随 credit_lots 改造一起做）：批次 `expired_at` 在 `handle_order_payment` 内以 `paid_at + valid_months` 计算；
> `orders` 只存 `credit_valid_months` 策略，`expired_at` 改为支付时回填的派生列；另加 `checkout_expires_at`（下单时写，定时任务只扫它，
> 对齐渠道 session 生命周期 24h）；`expired→paid` 恢复设最大迟到窗口（如 7 天），超窗落 `late_paid` 走人工决策。

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| order_no | VARCHAR(255) | Snowflake ID，业务主键 |
| amount | INT | 金额，单位：分（9900 = $99.00） |
| interval | VARCHAR(50) | 付款类型：one-time / month / year |
| status | VARCHAR(50) | 订单状态：created / paid / expired / refunded / mismatch / deleted |
| credits | INT | 该订单对应的积分数 |
| sub_id | VARCHAR(255) | Stripe 订阅 ID（预留，无订阅产品；sub_interval_count 等扩展字段未建） |
| valid_months | INT | 积分有效月数 |
| order_detail | TEXT | 创建时的 Stripe Session 参数 JSON |
| paid_detail | TEXT | 支付完成时的 Stripe Session 对象 JSON |

**缺失索引**：
- `user_uuid` - 按用户查订单（`getOrdersByUserUuid`），高频
- `status` - 按状态筛选（`getPaiedOrders`），中频
- `payment_provider` - 按支付渠道筛选（多渠道后），中频

> ✅ **多渠道已落地（迁移 0007）**：orders 已有 `payment_provider` 列（checkout 写入即冻结，
> 切换渠道不影响存量订单），渠道专属表 `creem_orders` / `waffo_orders` 已建。
> Stripe 专属字段（stripe_session_id, sub_id 等）仍留在 orders 表，未做物理拆分——
> v1 评估认为拆表收益不抵迁移成本，见 [payment/provider-abstraction.md](./payment/provider-abstraction.md)。

---

### 3. credits - 积分流水表

```sql
CREATE TABLE credits (
    id          SERIAL PRIMARY KEY,
    trans_no    VARCHAR(255) UNIQUE NOT NULL,  -- Snowflake ID
    created_at  timestamptz,
    user_uuid   VARCHAR(255) NOT NULL,
    trans_type  VARCHAR(50) NOT NULL,          -- 交易类型
    credits     INT NOT NULL,                  -- 积分变动量（正=增加，负=扣减）
    order_no    VARCHAR(255),                  -- 关联订单号
    expired_at  timestamptz                    -- 积分过期时间
);
```

**交易类型** (`CreditsTransType`)：

| 值 | 说明 | credits 符号 |
|----|------|-------------|
| `new_user` | 新用户赠送 | 正 (+10) |
| `order_pay` | 订单支付充值 | 正 (+N) |
| `system_add` | 系统手动增加 | 正 (+N) |
| `ping` | API 调用消耗 | 负 (-1) |
| `ai_generate` | AI 调用扣费（已落地，见 [AI 网关](./13-ai-gateway.md)） | 负 |
| `ai_refund` | AI 失败退款（已落地） | 正 |

**积分计算逻辑**（P-1.2 落地后）：

```
用户有效积分 = SUM(credits.credits)
  WHERE user_uuid = ?
    AND ( (credits > 0 AND (expired_at IS NULL OR expired_at >= now()))  -- 正数记录需未过期；NULL = 长期有效（管理员赠送等）
          OR credits <= 0 )                        -- 负数记录永不过期（expired_at 为 NULL）
    （正负记录都包含，净余额 = 正数之和 + 负数之和）

实际查询: getUserValidCredits()
  -> SELECT * FROM credits
     WHERE user_uuid = ? AND (credits > 0 AND (expired_at IS NULL OR expired_at >= now()) OR credits <= 0)
     ORDER BY expired_at ASC NULLS LAST   -- FIFO: 先扣最早过期的，负数记录排最后
```

> ✅ **P-1.2 已落地**：此前文档写有 `AND credits > 0` 过滤条件（实际代码无此过滤，已修正）。
> 负数扣减记录 `expired_at` 为 NULL（扣减是永久消费，不随原始积分过期消失），
> 查询时负数记录不做 `expired_at` 过滤，杜绝"积分复活"。

**积分扣减算法**（P-1.2 起由存储过程 `decrease_credits` 原子执行，见迁移 `0002_credits_safe_decrease.sql`）：

```
1. 行锁锁定该用户全部积分记录（串行化并发扣减）
2. 校验净余额 >= 需扣减量，不足抛 'insufficient credits' 异常
3. FIFO：从最早过期的正数记录开始消耗，记录首个被消耗积分的 order_no
4. INSERT 一条负数 credits 记录（expired_at 为 NULL，order_no 指向 FIFO 首笔来源）
```

> ✅ **P0-2 快修已落地（2026-08-30，迁移 `0020_decrease_credits_user_lock.sql`）**：`decrease_credits`
> 入口先取用户级事务 advisory lock（`pg_advisory_xact_lock(736925141, hashtext(user_uuid))`，
> 两段 int4 键避免与迁移器全局锁撞键；事务级在 pooler 事务模式下安全），再执行原 FOR UPDATE + SUM + FIFO 流程。
> 并发回归测试 `__tests__/credit-concurrency.test.ts`（静态断言进默认 CI；真实并发双花用例设
> `TEST_DATABASE_URL` 后运行）。**注意：目标库应用 0020 前，旧定义的双花窗口仍然存在。**
> 正解（credit_lots 批次模型）仍是长期方向，见下方原始分析与问题清单 #13。
>
> ⚠️ **P0-2（第九轮，2026-08-26）**：上述第 1 步「行锁锁定该用户全部积分记录（串行化并发扣减）」的论证**不成立**。
> 扣减写的是 **INSERT 一条负数流水**，不是 UPDATE 已有行；`SELECT ... FOR UPDATE` 只锁查询快照里**已存在**的行，
> 对并发插入的新行没有谓词锁/间隙锁。所以「锁 + SUM 校验 + INSERT 负数」在 append-only 账本上不等价于串行化。
> 是否真的能双花，取决于 SUM 校验是与 `FOR UPDATE` 同一条语句，还是解锁后另起一条语句（READ COMMITTED 下后者会重取快照看到对方提交）；
> 文档没有规定这一点，也没有任何隔离级别分析（全仓 grep `advisory` / `SERIALIZABLE` / `幻读` 零命中）。
> 这是一个被标成 ✅ 的、未经论证的并发安全声明，而它保护的是资金。
> **修法（推荐 2）**：
> 1. 快修：`decrease_credits` 开头 `PERFORM pg_advisory_xact_lock(hashtext(p_user_uuid))`（pooler 事务模式必须用**事务级**锁）。
> 2. 正解：迁到 `credit_lots` 后改为 `UPDATE credit_lots SET remaining_credits = remaining_credits - x WHERE id = ? AND remaining_credits >= x`，靠 UPDATE 自身行锁 + 返回行数保证原子。
> 3. 兜底：`credit_balances(user_uuid PK, balance)` 物化余额行 + `CHECK(balance >= 0)`。
> **并发回归测试必须进验收标准**：N 并发扣减，断言余额恒 ≥ 0 且成功次数 = `floor(余额 / 单价)`。

**缺失索引**（P-1.8 已补齐，见迁移 `0004_fk_indexes.sql`）：
- `user_uuid` - 按用户查积分流水，高频 ✅
- `order_no` - 按订单查积分记录（防重复充值），中频 ✅
- `(user_uuid, expired_at)` - 复合索引优化有效积分查询 ✅（另加 `expired_at` 单列索引）

---

### 4. apikeys - API 密钥表

```sql
CREATE TABLE apikeys (
    id          SERIAL PRIMARY KEY,
    api_key     VARCHAR(255) UNIQUE NOT NULL,  -- sk- 开头的密钥
    title       VARCHAR(100),                  -- 密钥名称
    user_uuid   VARCHAR(255) NOT NULL,
    created_at  timestamptz,
    status      VARCHAR(50)                    -- "created"/"deleted"
);
```

**状态**：

| 值 | 说明 |
|----|------|
| `created` | 正常使用 |
| `deleted` | 已删除（软删除） |

**缺失索引**：
- `api_key` - 有 UNIQUE 约束，自动建索引 ✅
- `(api_key, status)` - 复合索引优化认证查询

---

### 5. posts - 博客文章表

```sql
CREATE TABLE posts (
    id                SERIAL PRIMARY KEY,
    uuid              VARCHAR(255) UNIQUE NOT NULL,
    slug              VARCHAR(255),              -- URL 友好标识
    title             VARCHAR(255),
    description       TEXT,
    content           TEXT,                      -- Markdown 内容
    created_at        timestamptz,
    updated_at        timestamptz,
    status            VARCHAR(50),               -- created/online/offline/deleted
    cover_url         VARCHAR(255),              -- 封面图
    author_name       VARCHAR(255),
    author_avatar_url VARCHAR(255),
    locale            VARCHAR(50)                -- 语言
);
```

**状态** (`PostStatus`)：

| 值 | 说明 |
|----|------|
| `created` | 草稿 |
| `online` | 已发布（前台可见） |
| `offline` | 已下线 |
| `deleted` | 已删除 |

**缺失索引**：
- `(slug, locale)` - 按 slug+语言查文章，高频
- `(locale, status)` - 按语言+状态列表查询，高频

---

### 6. affiliates - 联盟营销表

```sql
CREATE TABLE affiliates (
    id              SERIAL PRIMARY KEY,
    user_uuid       VARCHAR(255) NOT NULL,      -- 被邀请人
    created_at      timestamptz,
    status          VARCHAR(50) NOT NULL DEFAULT '',  -- pending/completed
    invited_by      VARCHAR(255) NOT NULL,      -- 邀请人 UUID
    paid_order_no   VARCHAR(255) NOT NULL DEFAULT '',-- 关联订单号
    paid_amount     INT NOT NULL DEFAULT 0,     -- 订单金额（分）
    reward_percent  INT NOT NULL DEFAULT 0,     -- 奖励比例
    reward_amount   INT NOT NULL DEFAULT 0      -- 奖励金额（分）
);
```

**状态**：

| 值 | 说明 | 触发时机 |
|----|------|----------|
| `pending` | 待定 | 用户通过邀请码注册时 |
| `completed` | 已完成 | 被邀请人首次付费时 |

**奖励规则** (`services/constant.ts`)：

| 事件 | 奖励比例 | 奖励金额上限 |
|------|----------|-------------|
| 被邀请人注册 | 0% | $0 |
| 被邀请人首次付费 | 20% | $50 (5000 分) |

**缺失索引**：
- `invited_by` - 按邀请人查被邀请记录，高频
- `paid_order_no` - 按订单查联盟记录（防重复），中频

---

## 多渠道支付表结构（✅ 已落地，迁移 0007）

orders 表通过 `payment_provider` 列区分渠道（不物理拆共享字段）；渠道专属字段放各自表中：

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(50) DEFAULT 'stripe';

-- Creem 专属表
CREATE TABLE IF NOT EXISTS creem_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,      -- 关联 orders.order_no
    creem_checkout_id VARCHAR(255),
    creem_subscription_id VARCHAR(255),
    creem_payment_method VARCHAR(100),
    created_at timestamptz
);

-- Waffo 专属表
CREATE TABLE IF NOT EXISTS waffo_orders (
    id SERIAL PRIMARY KEY,
    order_no VARCHAR(255) UNIQUE NOT NULL,      -- 关联 orders.order_no
    acquiring_order_id VARCHAR(255),            -- Waffo 订单 ID
    payment_request_id VARCHAR(64),             -- 幂等键
    sub_id VARCHAR(255),                        -- 订阅 ID
    created_at timestamptz
);

-- 未来新增渠道只需加对应的 xxx_orders 表
```

### 支付配置表（✅ 已落地，迁移 0001 + 0007 种子）

```sql
-- 渠道启用状态（热切换的根基：配置数据库化，不依赖环境变量）
CREATE TABLE payment_settings (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) UNIQUE NOT NULL,       -- 'creem' / 'waffo' / 'stripe' / 'paypal'
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INT NOT NULL DEFAULT 100,          -- 路由优先级（小者优先，priority 最小 = 默认渠道）
    updated_at timestamptz
);

-- 定价映射（兼容预建产品 Creem 与动态金额 Waffo/Stripe 两种模式）
-- ⚠️ v1 保持单表；阶段 2 加 Stripe/PayPal 时拆为 payment_products + channel_products（docs/12 已删除，遗留项见 ./ADVERSARIAL-REVIEW-2026-08-26.md）
CREATE TABLE payment_products (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) UNIQUE NOT NULL,     -- 'starter' / 'standard' / 'premium'
    amount INT NOT NULL,                         -- 分（含税价）
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    credits INT NOT NULL,
    valid_months INT NOT NULL,
    creem_product_id VARCHAR(255),               -- Creem 预建产品 ID（可空）
    stripe_price_id VARCHAR(255),                -- Stripe 预建 price（可空）
    created_at timestamptz
);
```

## 已落地的补充表（迁移中已创建）

```sql
-- 邮箱验证码（迁移 0006）
verification_codes (id, email, code_hash, expired_at, consumed, consumed_at, created_at)

-- 匿名演示用量（迁移 0005，见 docs/14-anonymous-trial.md）
anonymous_usage (id, anonymous_key VARCHAR(64), usage_date DATE,
                 count INT, updated_at timestamptz,
                 UNIQUE (anonymous_key, usage_date))

-- 操作审计日志（迁移 0008）
audit_logs (id, admin_uuid, action, target_type, target_uuid,
            detail, ip, created_at)

-- 站内通知（迁移 0009）
notifications (id, uuid, user_uuid, type, title, content,
               is_read, created_at)

-- 运营事件日志（迁移 0014，见 docs/16-observability-alerting.md）
op_events (id, event_type, severity, source, subject_uuid, detail JSONB, created_at)

-- users 表补充字段（迁移 0006/0008）
ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';
ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN password_updated_at timestamptz;
```

## 规划中 / v1 收费前必须完成

> 以下表为第八轮审查识别的 P0/P1 改造项，真实收费前必须落地。

```sql
-- ============================================
-- P0：积分批次账本（替代正负净额模型）
-- ============================================

-- 积分批次：每次发放一个批次，追踪剩余量与过期时间
CREATE TABLE credit_lots (
    id BIGSERIAL PRIMARY KEY,
    lot_no VARCHAR(64) UNIQUE NOT NULL,        -- 批次号（snowflake）
    user_uuid VARCHAR(64) NOT NULL,            -- 用户
    source_type VARCHAR(32) NOT NULL,          -- order_pay / affiliate_reward / admin_adjust / sign_up_bonus / refund
    source_ref VARCHAR(128),                   -- 来源订单号 / 退款单号 / 调整单号
    total_credits INT NOT NULL,                -- 原始发放数量
    remaining_credits INT NOT NULL,            -- 剩余可用（消费后递减）
    expired_at timestamptz,                    -- 过期时间（NULL = 永久）
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active / expired / exhausted / refunded
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credit_lots_user ON credit_lots(user_uuid);
CREATE INDEX idx_credit_lots_expired ON credit_lots(expired_at) WHERE status = 'active';

-- 消费明细：一次消费可跨多个批次，每条记录扣减的批次与数量
CREATE TABLE credit_consumptions (
    id BIGSERIAL PRIMARY KEY,
    consumption_no VARCHAR(64) UNIQUE NOT NULL,  -- 消费单号
    user_uuid VARCHAR(64) NOT NULL,
    request_id VARCHAR(128),                     -- 业务请求 ID（如 AI 请求 idempotency key）
    request_type VARCHAR(32) NOT NULL,           -- ai_generate / admin_adjust 等
    lot_id BIGINT NOT NULL REFERENCES credit_lots(id),
    credits INT NOT NULL,                        -- 本次从该批次扣减的数量（正数）
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credit_consumptions_request ON credit_consumptions(request_id);
CREATE INDEX idx_credit_consumptions_user ON credit_consumptions(user_uuid);

-- 退款回补明细
CREATE TABLE credit_refunds (
    id BIGSERIAL PRIMARY KEY,
    refund_no VARCHAR(64) UNIQUE NOT NULL,
    user_uuid VARCHAR(64) NOT NULL,
    order_no VARCHAR(64) NOT NULL,               -- 原支付订单号
    provider_refund_id VARCHAR(256),             -- 渠道退款 ID
    refunded_credits INT NOT NULL,               -- 回补积分数
    reason TEXT,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================
-- P0：支付事件 inbox 与对账
-- ============================================

-- Webhook 原始事件 inbox（所有渠道事件先入库，再异步处理）
CREATE TABLE payment_events (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,               -- stripe / creem / waffo
    provider_event_id VARCHAR(256) NOT NULL,     -- 渠道事件 ID（幂等用）
    event_type VARCHAR(64) NOT NULL,             -- payment_succeeded / refund_succeeded 等
    order_no VARCHAR(64),                        -- 关联本地订单号（可能为空，需后绑定）
    session_id VARCHAR(256),                     -- 渠道 session / checkout ID
    payment_intent_id VARCHAR(256),              -- 渠道支付意图 ID
    amount_cents INT,                            -- 事件金额（分）
    currency VARCHAR(10),
    raw_body JSONB NOT NULL,                     -- 原始 payload
    signature_verified BOOLEAN NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / processed / failed / ignored
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_payment_events_order ON payment_events(order_no);
CREATE INDEX idx_payment_events_status ON payment_events(status);

-- ============================================
-- P0 / P1：退款记录
-- ============================================

-- 退款单（支持部分退款、多次退款）
CREATE TABLE refunds (
    id BIGSERIAL PRIMARY KEY,
    refund_no VARCHAR(64) UNIQUE NOT NULL,
    order_no VARCHAR(64) NOT NULL,
    user_uuid VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_refund_id VARCHAR(256),             -- 渠道退款 ID
    amount_cents INT NOT NULL,                   -- 本次退款金额（分）
    currency VARCHAR(10) NOT NULL,
    credits_refunded INT,                        -- 回补的积分（部分退款按比例或批次）
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / succeeded / failed
    reason TEXT,
    initiated_by VARCHAR(64),                    -- admin / system / customer
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refunds_order ON refunds(order_no);
CREATE INDEX idx_refunds_provider ON refunds(provider, provider_refund_id);

> ✅ **P0-1（第九轮，2026-08-26）——已关闭（2026-09-01，迁移 0026 + 工作台，handoff §1.19）**：
> 上面的 `credit_lots.remaining_credits` 非负语义保留；债务化不再用「负批次」表达，而是
> 1. `orders` 已有 `refund_requested` / `refund_blocked` / `disputed` / `charged_back` 状态（0021）。
> 2. 独立 `credit_debts(user_uuid, order_no, due_credits, status)`（0021）+ 账号 `restricted`；
>    清偿闭环 `private.settle_credit_debt`（0026）：outstanding→settled + 无其他欠款时账号恢复 active。
> 3. 退款准入（0026）：回收量 = SUM(该订单 credit_lots 批次 remaining_credits)（过期批次仍计入，
>    防过期套利），缺口部分由 `services/refund.ts processRefund` 自动债务化；webhook 登记的
>    `refund_requested` 由后台回收工作台 `/admin/recovery` 本地闭合（不触达渠道）。

-- ============================================
-- P1：AI 请求状态机（幂等 + 崩溃补偿）
-- ============================================

CREATE TABLE ai_requests (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,            -- 业务请求 ID（客户端 idempotency key 或服务端生成）
    user_uuid VARCHAR(64) NOT NULL,
    model VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_request_id VARCHAR(256),            -- 渠道请求 ID
    estimated_credits INT NOT NULL,              -- 预估扣费
    actual_credits INT,                          -- 实际结算（v3 精确结算用）
    status VARCHAR(24) NOT NULL DEFAULT 'created',  -- created / reserved / running / succeeded / failed / refund_pending / refunded
    input_tokens INT,
    output_tokens INT,
    error_message TEXT,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz
);
CREATE UNIQUE INDEX uq_ai_requests_user_request ON ai_requests(user_uuid, request_id);
CREATE INDEX idx_ai_requests_user ON ai_requests(user_uuid);
CREATE INDEX idx_ai_requests_status ON ai_requests(status) WHERE status IN ('refund_pending', 'running');
```

> ⚠️ **P1-5（第九轮，2026-08-26）——幂等键作用域必须按用户隔离**：原设计 `request_id VARCHAR(128) UNIQUE NOT NULL`
> 是**全局唯一 + 客户端可控**，键空间变成公共资源。批量抢注 `"1"`、`"test"`、常见客户端库默认键，受害者用同名键请求时
> 要么被永久拒服（无 TTL 字段、无自助恢复），要么在「冲突返回已有记录」的实现下读到别人的结果。
> **修法**：`UNIQUE(user_uuid, request_id)`（匿名端点用 `anonymous_key` 作租户维度）+ 补齐键的必填性/字符集/长度
> + 存请求体指纹 `hash(model+prompt+max_tokens)`、同键不同体返 422 + 用 `created_at` 落地 24h 口径与清理任务。
> （严格说这是「欠规定」而非已成事实漏洞：`ai_requests` 尚未建表，`docs/02` 已写明按用户作用域，实现者照做即可避免跨租户。）

> 注：`users.email_marketing_opt_in` 仍待落地（营销邮件退订，见 docs/10）。

---

## 数据库设计问题清单

| # | 问题 | 严重程度 | 状态 | 说明 |
|---|------|----------|------|------|
| 1 | 无外键约束 | 中 | 待修复 | 建议逐步加 FK，先从 orders/credits → users 开始 |
| 2 | 缺少高频查询索引 | 高 | ⚠️ 部分 | 迁移 0004 补了核心索引；credit_lots / payment_events 等新表需配套索引 |
| 3 | 无 created_at 默认值 | 低 | 待修复 | 建议加 `DEFAULT NOW()` |
| 4 | 无 updated_at 自动更新 | 低 | 待修复 | 建议加 trigger 自动更新 |
| 5 | email 字段无唯一约束 | 低 | 已知边界 | 当前 (email, provider) 组合唯一；同邮箱多 provider 的 account linking 见 docs/04 |
| 6 | 无软删除机制（除 posts/apikeys） | 中 | 待评估 | users/orders/credits/affiliates 无软删除；订单/积分因审计需求不应物理删除 |
| 7 | ~~无数据库迁移工具~~ | ~~中~~ | ⚠️ 最小机制已落地，并发/回滚/发布顺序未覆盖 | `data/migrations/` + `schema_migrations` 只解决同进程重复启动；多进程同秒启动、失败 fail-fast、回滚、expand-contract、索引 CONCURRENTLY 均未定义（P1-7） |
| 8 | ~~**资金 RPC 权限边界不成立（P0）**~~ | ~~阻断~~ | **已关闭（2026-09-01，迁移 0023）** | 五个资金函数迁入 `private` schema（含 `SET search_path` 防劫持），REVOKE PUBLIC/anon/authenticated、仅授 service_role；`credits/orders/refunds/credit_debts` 启用 RLS；应用 6 处调用点 `serverClient().schema("private")`；Dashboard Exposed schemas 加 `private`；连库验证 anon 三层被拒。注意：public 其余业务表（users/apikeys/audit_logs 等约 15 表）RLS 仍缺，见第 11 行与 handoff §1.17 |
| 9 | ~~**积分账本缺少批次追踪（P0）**~~ | ~~阻断~~ | ✅ 已关闭（2026-09-01，迁移 0026） | `credit_lots`（每发放一批：total/remaining/expired_at/status）+ `credit_consumptions`（消费明细）已连库落地；发放路径（订单/管理员/新用户）同步建批次；退款按订单批次精确回收。两新表 ENABLE RLS（deny-all）+ REVOKE anon/authenticated |
| 10 | **缺少 Webhook inbox 与对账表（P0）** | **阻断** | **No-Go** | 无持久化事件队列，无法防重放、乱序、失败重试和每日对账 |
| 11 | ~~缺少 RLS 策略~~ | ~~高~~ | ✅ 已关闭（2026-09-01，0023+0024） | public 全部 19 张业务表 ENABLE RLS（deny-all）+ REVOKE anon/authenticated 表特权；资金 RPC 迁 private 仅授 service_role。当前应用无 anon/浏览器直连路径（服务端恒 service_role bypass），若未来接 Supabase Auth/anon 直连，必须先显式设计自访策略 |
| 12 | 备份无加密与脱敏 | 高 | 待落地 | backup.ts 对 orders/credits 用 select("*")，可能泄露 PII；需加密、保留期限、恢复演练 |
| 13 | ~~**`decrease_credits` 并发安全声明未经论证（P0-2）**~~ | ~~阻断~~ | ✅ 已关闭（2026-09-01，0020+0026） | 双保险：用户级事务 advisory lock（0020，覆盖空账本/幻影插入窗口）+ 批次 FIFO `UPDATE ... WHERE remaining_credits >= x` 行级原子（0026，docs/03 #13 正解）；真库并发用例 4/4 通过（`credit-concurrency.test.ts`） |
| 14 | ~~自动迁移向生产库种入公开弱口令（P0-3）~~ | ~~阻断~~ | ✅ 已关闭（0012/0019） | 0012 不再建号；0019 禁用历史固定 hash 账号；仅 `ADMIN_BOOTSTRAP_EMAIL` 显式开启一次性 pending_activation 引导 |
| 15 | **建库路径三处并存（P1-6）** | 高 | 待统一 | `install.sql`（03 标「勿再参考」）与迁移 0000 基线、README 粘贴路径并存，`docs/07` 仍要求先手工执行 install.sql；需统一为「空库只跑 migrations」并加基线断言 |
| 16 | **订单/支付事件缺少争议状态（P2-2）** | 中 | 待补 | `orders.status` 无 `disputed/charged_back`，`PaymentEventType` 无争议类型，收到渠道 dispute 事件无处归一化 |

---

## 权限与安全边界（生产强制）

> ⚠️ **P0：当前资金函数的权限边界依赖代码约定，不依赖数据库强制**。
> 在 Supabase 默认配置下，`public` schema 中的函数对 `anon` 和 `authenticated`
> 角色默认具有 `EXECUTE` 权限。本项目的三个资金函数（decrease_credits /
> handle_order_payment / process_order_refund）全部位于 `public` schema，
> 迁移中没有任何 `REVOKE PUBLIC ON FUNCTION` 或 RLS 策略。

### 生产必须满足的数据库权限基线

1. **Schema 分层**：资金函数移入 `private` / `internal` schema，与 public schema 隔离。
2. **权限最小化**：
   ```sql
   -- 回收 public 执行权限
   REVOKE ALL ON FUNCTION private.decrease_credits FROM PUBLIC;
   REVOKE ALL ON FUNCTION private.handle_order_payment FROM PUBLIC;
   REVOKE ALL ON FUNCTION private.process_order_refund FROM PUBLIC;
   -- 仅授权 service role
   GRANT EXECUTE ON FUNCTION private.decrease_credits TO service_role;
   GRANT EXECUTE ON FUNCTION private.handle_order_payment TO service_role;
   GRANT EXECUTE ON FUNCTION private.process_order_refund TO service_role;
   ```
3. **RLS 启用**（✅ 已达成，2026-09-01）：`orders`、`credits` 及 public 其余全部 19 张
   业务表均已启用 RLS（0023/0024，deny-all + REVOKE anon/authenticated 表特权）。
   - 当前形态：应用无 anon/浏览器直连路径、不用 Supabase Auth（NextAuth 自管 JWT），
     服务端恒 service_role（bypassrls）读写，"终端用户只看自己行"的语义由服务端
     session → uuid 承担
   - 若未来接 Supabase Auth / anon 直连：必须先显式设计 `auth.uid()` 自访策略再放开，
     不得依赖 deny-all 时的静默放行（fail-loud）
4. **客户端分离**：代码中明确区分 `serverClient`（service_role，仅服务端）与
   `userClient`（anon/authenticated，随用户请求），禁止通用模块"有 service key 就切换"。
5. **CI 断言**：每次迁移后检查 `information_schema.routine_privileges`，
   确保资金函数没有授予 anon/authenticated。

---

## 存储过程（资金与额度的原子操作）

> 设计原则：**凡是「读状态 -> 判断 -> 写」的资金/额度操作，全部下沉为存储过程单事务执行**，
> 应用层禁止 check-then-write（多实例并发下必然出双花/透支窗口）。这是历轮安全审查
> （P-1.2/P-1.3/R1/R3）沉淀下来的硬约定。

### 1. decrease_credits（迁移 0002）—— 积分原子扣减

```
参数：p_user_uuid, p_trans_type, p_credits（正数）
行为：FOR UPDATE 锁定该用户全部积分记录 -> 净余额 < p_credits 抛 'insufficient credits'
     -> FIFO 插入负数记录（expired_at=NULL，order_no 指向首个被消耗来源）
```

> ⚠️ **P0-2（第九轮，2026-08-26）**：「FOR UPDATE 串行化并发扣减」的论证不成立，分析见 §3「积分扣减算法」下方与问题清单 #13。
> 这是 DB 层的 check-then-write（与本文开篇「应用层禁止 check-then-write」的约定是同一结构），在 append-only 账本上
> 必须靠 advisory lock 或迁 credit_lots 后 `UPDATE ... WHERE remaining >= x` 才能成立，不能靠「实现细节可能刚好对」。
> ✅ 快修（advisory lock）已随迁移 0020 落地，见上方 §3 说明；credit_lots 正解仍待做。

> ⚠️ **P1-7（第九轮，2026-08-26）——迁移机制的并发与发布顺序**：`schema_migrations` 只保证同一进程重复启动不重跑，
> 不解决多进程同秒启动；迁移失败后是否继续启动也没定义。`CREATE OR REPLACE FUNCTION` 并发执行会撞 `tuple concurrently updated`。
> 修法：迁移器入口 `pg_advisory_xact_lock(固定key)`（**事务级**，pooler 下可用）；每条迁移与 `INSERT INTO schema_migrations` 同事务；
> 失败 fail-fast 阻止服务接流量；把迁移从 `instrumentation.ts` 剥离为流水线前置步骤，运行时只校验「schema 版本 ≥ 代码要求版本」；
> 建索引一律 `CONCURRENTLY` 且单独成条；补 expand-contract 规则（删列/改名拆两次发布）。

### 2. handle_order_payment（迁移 0003，0010/0017 增强）—— 支付成功落账

```
参数：p_order_no, p_paid_at, p_paid_email, p_paid_detail,
     p_amount_cents（渠道实付，分）, p_currency, p_reward_percent, p_max_reward
行为：行锁订单 -> 幂等（已 paid 直接返回）-> 【0017】expired 订单允许被迟到
     webhook 恢复（order_detail 留审计痕迹）；mismatch 等其他状态仍拒绝 ->
     【0010】金额/币种与订单精确比对，不符置 status='mismatch' 返回 'mismatch'
     （不充值、不发联盟奖励、不抛错——抛错会引发渠道无限重试）-> 订单置 paid +
     INSERT credits + INSERT affiliates 单事务完成；【0017】联盟奖励双重幂等：
     同 paid_order_no 只记一次 + 每个被邀请人仅首笔付费
返回：'paid'（含 expired 恢复）/ 'mismatch'；非 created/paid/expired 状态抛错
```

### 3. process_order_refund（迁移 0011）—— 退款原子化

```
参数：p_order_no, p_refund_note
行为：行锁订单 -> 非 paid 抛错（或已 refunded 幂等返回 0）-> 扣回积分
     （min(订单积分, 用户当前余额)，负数记录 expired_at=NULL）-> 订单置 refunded
返回：实际扣回的积分数
调用方：services/refund.ts（管理后台退款 + refund.created webhook 共用）
```

### 4. increment / decrement_anonymous_usage（迁移 0005）—— 匿名额度

```
原子递增/回退每日匿名演示额度（ON CONFLICT + WHERE count < p_limit 单语句原子），
只存 sha256 hash，不存明文 IP/指纹。见 docs/14-anonymous-trial.md。
```

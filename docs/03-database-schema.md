# 数据库设计文档

## 概述

- **数据库类型**：PostgreSQL（Supabase 托管；本地开发可用 Supabase CLI，见 [07-deployment.md §5.2](./07-deployment.md)）
- **客户端**：@supabase/supabase-js（无 ORM，直接调用 Supabase Client）；迁移执行用 `pg` 直连 `DATABASE_URL`
- **建表脚本**：`data/migrations/0000_install_base.sql`（基础 7 表：users/orders/credits/affiliates/apikeys/posts/notifications，一次性执行）；其余表全部由迁移增量创建（data/install.sql 为旧版全能脚本，与迁移基线存在出入，勿再参考）
- **迁移机制**：`data/migrations/*.sql` 按文件名序号执行，`schema_migrations` 版本表保证幂等；服务启动时 `instrumentation.ts` 自动执行，手动 `pnpm migrate`（见 `lib/migrate.ts`）
- **迁移清单**（0000-0017）：基础建表 / 支付配置表 / 积分原子扣减 / 支付事务化 / 外键索引 / 匿名额度 / 密码登录 / 多渠道 / RBAC+审计 / 站内通知 / 金额比对 / 退款原子化 / 默认管理员 / system_settings / op_events / apikeys 前缀 / 匿名额度 off-by-one / 迟付恢复+联盟首付
- **表数量**：16 张（迁移 0000 基础 7 张 + 迁移新增 9 张，含 system_settings、op_events）
- **存储过程**：资金与额度相关写操作全部下沉数据库原子执行（见文末「存储过程」一节），应用层不做 check-then-write

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
-- ⚠️ v1 保持单表；阶段 2 加 Stripe/PayPal 时拆为 payment_products + channel_products（见 docs/12 遗留项跟踪表）
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

## 待新增表（规划中）

```sql
-- 邮箱验证码 ✅ 已落地（迁移 0006）
verification_codes (id, email, code, expired_at, used, created_at)

-- 匿名演示用量 ✅ 已落地（迁移 0005，见 docs/14-anonymous-trial.md）
anonymous_usage (id, anonymous_key VARCHAR(64), usage_date DATE,
                 count INT, updated_at timestamptz,
                 UNIQUE (anonymous_key, usage_date))

-- users 表字段补充 ✅ 已落地（迁移 0006/0008）
ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';                    -- RBAC（0008）
ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);                         -- 密码登录（0006，OAuth 用户为 NULL）
ALTER TABLE users ADD COLUMN password_updated_at timestamptz;                    -- （0006）
ALTER TABLE users ADD COLUMN email_marketing_opt_in BOOLEAN DEFAULT true;        -- 营销邮件退订（待落地）

-- 操作审计日志 ✅ 已落地（迁移 0008）
audit_logs (id, admin_uuid, action, target_type, target_uuid,
            detail, ip, created_at)

-- 站内通知 ✅ 已落地（迁移 0009）
notifications (id, uuid, user_uuid, type, title, content,
               is_read, created_at)

-- 运营事件日志（规划，见 docs/16-observability-alerting.md）
-- 日志采集 + 飞书/企微机器人告警的数据底座
op_events (id, event_type, severity, source, subject_uuid, detail JSONB, created_at)
```

---

## 数据库设计问题清单

| # | 问题 | 严重程度 | 建议 |
|---|------|----------|------|
| 1 | 无外键约束 | 中 | Supabase 可通过 Dashboard 添加 FK 约束 |
| 2 | 缺少高频查询索引 | 高 | 补充上述缺失索引 |
| 3 | 无 created_at 默认值 | 低 | 建议加 `DEFAULT NOW()` |
| 4 | 无 updated_at 自动更新 | 低 | 建议加 trigger 自动更新 |
| 5 | email 字段无唯一约束 | 低 | 当前 (email, provider) 组合唯一，同一邮箱可多 provider |
| 6 | 无软删除机制（除 posts/apikeys） | 中 | users/orders/credits/affiliates 无软删除 |
| 7 | ~~无数据库迁移工具~~ | ~~中~~ | ✅ 已落地：`data/migrations/` + `schema_migrations` 最小迁移机制（P-1.12） |
| 8 | 直接用 Service Role Key | 高 | 生产环境应限制 RLS，用 Anon Key + RLS Policy |

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

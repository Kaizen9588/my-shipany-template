# 数据库设计文档

## 概述

- **数据库类型**：PostgreSQL（Supabase 托管）
- **客户端**：@supabase/supabase-js（无 ORM，直接调用 Supabase Client）
- **建表脚本**：`data/install.sql`
- **数据库数量**：6 张表

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
    status              VARCHAR(50) NOT NULL,          -- "created"/"paid"/"deleted"
    stripe_session_id   VARCHAR(255),                  -- Stripe Checkout Session ID
    credits             INT NOT NULL,                  -- 购买积分数
    currency            VARCHAR(50),                   -- "USD"/"CNY"
    sub_id              VARCHAR(255),                  -- Stripe Subscription ID
    sub_interval_count  INT,                           -- 订阅间隔数
    sub_cycle_anchor    INT,                           -- 订阅周期锚点（Unix时间戳）
    sub_period_end      INT,                           -- 订阅周期结束（Unix时间戳）
    sub_period_start    INT,                           -- 订阅周期开始（Unix时间戳）
    sub_times           INT,                           -- 订阅扣款次数
    product_id          VARCHAR(255),                  -- 产品 ID
    product_name        VARCHAR(255),                  -- 产品名称
    valid_months        INT,                           -- 积分有效月数
    order_detail        TEXT,                          -- Stripe Session JSON
    paid_at             timestamptz,                   -- 支付时间
    paid_email          VARCHAR(255),                  -- 支付邮箱
    paid_detail         TEXT                           -- 支付详情 JSON
);
```

**状态流转**：

```
created ──(支付成功 webhook)──> paid
   │
   └──(手动删除/过期)──> deleted
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| order_no | VARCHAR(255) | Snowflake ID，业务主键 |
| amount | INT | 金额，单位：分（9900 = $99.00） |
| interval | VARCHAR(50) | 付款类型：one-time / month / year |
| status | VARCHAR(50) | 订单状态：created / paid / deleted |
| credits | INT | 该订单对应的积分数 |
| sub_id | VARCHAR(255) | Stripe 订阅 ID（仅订阅模式） |
| sub_period_end | INT | 订阅周期结束时间（Unix 秒） |
| sub_times | INT | 订阅已扣款次数 |
| valid_months | INT | 积分有效月数 |
| order_detail | TEXT | 创建时的 Stripe Session 参数 JSON |
| paid_detail | TEXT | 支付完成时的 Stripe Session 对象 JSON |

**缺失索引**：
- `user_uuid` - 按用户查订单（`getOrdersByUserUuid`），高频
- `status` - 按状态筛选（`getPaiedOrders`），中频
- `payment_provider` - 按支付渠道筛选（多渠道后），中频

> ⚠️ **表结构变更预告**：当前 orders 表包含 Stripe 专属字段（stripe_session_id, sub_id 等）。
> 多支付渠道集成时将拆分为：orders（共享）+ stripe_orders + creem_orders（渠道专属）。
> 详见 DEVELOPMENT_PLAN.md 第 4.2 节。

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

**积分计算逻辑**：

```
用户有效积分 = SUM(credits.credits)
  WHERE user_uuid = ?
    AND expired_at >= now()    -- 未过期
    （正负记录都包含，净余额 = 正数之和 + 负数之和）

实际查询: getUserValidCredits()
  -> SELECT * FROM credits
     WHERE user_uuid = ? AND expired_at >= now()
     ORDER BY expired_at ASC   -- FIFO: 先扣最早过期的
```

> ⚠️ **文档修正**：此前文档写有 `AND credits > 0` 过滤条件，但实际代码无此过滤。
> 代码返回所有未过期记录（正数+负数），在 `getUserCredits()` 中累加计算净余额，这是正确的。
> 但负数记录的 `expired_at` 存在设计缺陷，见下方说明。

> ⚠️ **FIFO 扣减 expired_at 缺陷**：`decreaseCredits` 将原始积分的 `expired_at` 复制到负数扣减记录上。
> 当原始积分过期后，对应的负数记录也过期被查询排除，导致已消耗的积分"复活"，余额凭空增加。
> 修复方案：负数扣减记录不设 `expired_at`（NULL），查询时对 NULL 不过滤。

**积分扣减算法** (`decreaseCredits`)：

```
1. 查询所有有效积分记录，按 expired_at 升序
2. 累加 credits 直到 >= 需要扣减的量
3. 记录对应的 order_no 和 expired_at
4. INSERT 一条负数 credits 记录
```

**缺失索引**：
- `user_uuid` - 按用户查积分流水，高频
- `order_no` - 按订单查积分记录（防重复充值），中频
- `(user_uuid, expired_at)` - 复合索引优化有效积分查询

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

## 数据库设计问题清单

| # | 问题 | 严重程度 | 建议 |
|---|------|----------|------|
| 1 | 无外键约束 | 中 | Supabase 可通过 Dashboard 添加 FK 约束 |
| 2 | 缺少高频查询索引 | 高 | 补充上述缺失索引 |
| 3 | 无 created_at 默认值 | 低 | 建议加 `DEFAULT NOW()` |
| 4 | 无 updated_at 自动更新 | 低 | 建议加 trigger 自动更新 |
| 5 | email 字段无唯一约束 | 低 | 当前 (email, provider) 组合唯一，同一邮箱可多 provider |
| 6 | 无软删除机制（除 posts/apikeys） | 中 | users/orders/credits/affiliates 无软删除 |
| 7 | 无数据库迁移工具 | 中 | 建议引入 Drizzle Migration 或 Supabase Migration |
| 8 | 直接用 Service Role Key | 高 | 生产环境应限制 RLS，用 Anon Key + RLS Policy |

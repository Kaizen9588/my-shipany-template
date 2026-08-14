# 架构评审意见

> 评审对象：my-shipany-template（基于 ShipAny 的 AI SaaS 模板）
> 评审日期：2025-08-14
> 评审范围：docs/ 全部文档 + 关键源码（models/db.ts, services/credit.ts, services/user.ts, services/order.ts, app/api/checkout/route.ts, app/api/stripe-notify/route.ts, app/api/ping/route.ts, data/install.sql, next.config.mjs, package.json）

---

## 一、严重安全问题（必须在 P0 之前修）

### 1. Checkout API 信任前端传入的金额和积分数

**位置**：`app/api/checkout/route.ts:12-21`

**问题**：`amount`、`credits`、`product_id`、`valid_months` 全部来自客户端请求体。恶意用户可以构造 `{ amount: 1, credits: 99999, product_id: "starter" }` 请求，花 1 分钱买 99999 积分。

**根因**：定价方案存储在 i18n JSON 文件中（`i18n/pages/landing/{locale}.json`），服务端没有独立的可信定价源，只能信任客户端传入的参数。

**建议**：
- 服务端建立可信定价表（`data/pricing.ts` 常量 或 数据库 `products` 表）
- Checkout API 根据 `product_id` 从服务端定价表查询真实 `amount` 和 `credits`，**忽略客户端传入的值**
- 这是支付系统的基础原则，不可妥协

---

### 2. 积分扣减无余额检查 + 无并发控制

**位置**：`services/credit.ts:60-105`（`decreaseCredits`）、`app/api/ping/route.ts:17-27`

**问题**：
- `decreaseCredits` 直接插入负数 credits 记录，不检查用户余额是否足够。用户积分为 0 时仍可无限调用扣费 API。
- `/api/ping` 的「认证 → 扣减」两步之间无锁。并发请求可以同时通过认证，各自执行扣减，导致透支。
- 显示时用 `Math.max(0, left_credits)` 遮盖负数，但数据库层面余额已经是负的，AI API 仍可被调用。

**建议**：
- 扣减前检查余额，不足时返回错误（`respErr("insufficient credits")`）
- 使用 Supabase RPC（PostgreSQL 存储过程）+ 行锁实现原子性的「检查 + 扣减」
- 或者使用 `SELECT ... FOR UPDATE` + 事务

---

### 3. `/api/update-invite` 完全无认证

**位置**：`app/api/update-invite/route.ts`

**问题**：接口接受请求体中的 `user_uuid` 参数来绑定邀请关系，不校验调用者身份。任何人可以构造请求为任意用户绑定任意邀请码。

**建议**：
- 从 NextAuth session 中获取 `user_uuid`，不接受客户端传入
- 删除请求体中的 `user_uuid` 参数

---

### 4. Demo AI 接口完全开放

**位置**：`app/api/demo/gen-text/route.ts`、`app/api/demo/gen-stream-text/route.ts`、`app/api/demo/gen-image/route.ts`

**问题**：三个 AI 接口无认证、无限流、无积分检查。任何人可以直接调用，消耗项目的 OpenAI / DeepSeek / Replicate API 额度。

**建议**：
- 至少加 IP 级限流（如 10 次/小时）
- 或改为登录后可用 + 积分扣减
- 作为模板，这些 demo 应该展示「认证 + 限流 + 积分扣减」的正确模式，而不是裸奔

---

### 5. API Key 明文存储

**位置**：`data/install.sql:51`（`apikeys.api_key VARCHAR(255)`）

**问题**：API Key 以明文存储在数据库中。数据库泄露即所有用户密钥泄露。

**建议**：
- 存储 API Key 的 hash（SHA-256），查询时用 hash 匹配
- 只保留前缀（如 `sk-abc...`）用于页面展示
- 创建时仅展示一次完整密钥，之后不可查看

---

### 6. Supabase Service Role Key 作为默认

**位置**：`models/db.ts:7-8`

**问题**：代码优先使用 `SUPABASE_SERVICE_ROLE_KEY`，该 key 绕过所有 RLS 策略，拥有完整的数据库管理员权限。

**建议**：
- 如果仅用于 Server-side 操作，可以接受，但需在文档中明确安全边界
- 绝不能在客户端代码中使用 Service Role Key
- 长期建议：对用户数据操作使用 Anon Key + RLS Policy，仅管理操作用 Service Role Key

---

## 二、架构设计问题

### 7. 支付处理无事务

**位置**：`services/order.ts:12-56`（`handleOrderSession`）

**问题**：Webhook 处理依次执行三步独立操作：
1. 更新订单状态为 paid
2. 充值积分（`updateCreditForOrder`）
3. 记录联盟奖励（`updateAffiliateForOrder`）

三步之间无数据库事务。如果第 2 步失败，订单已标记 paid 但积分未充值，数据不一致且无法自动恢复。

**建议**：
- 方案 A（推荐）：用 PostgreSQL 存储过程将三步包在一个事务中
- 方案 B：实现补偿机制——失败时回滚订单状态为 created，让 Stripe 重试 Webhook
- 方案 C：用 Supabase 的 `rpc()` 调用服务端函数

---

### 8. 无数据库迁移系统

**位置**：`data/install.sql`

**问题**：只有一个一次性建表脚本，没有迁移系统。作为模板会被反复 fork 和演进，schema 变更无法追踪、无法回滚、无法在不同环境间同步。

**建议**：
- 引入 Drizzle ORM + Drizzle Kit（TypeScript 原生，支持 Supabase，轻量）
- 或至少使用 Supabase CLI 自带的 Migration 系统（`supabase db migration`）
- 将现有 `install.sql` 拆分为初始迁移文件

---

### 9. 定价配置放在 i18n JSON 中

**位置**：`i18n/pages/landing/{locale}.json` 的 `pricing` 节点

**问题**：
- en.json 和 zh.json 两份文件必须手动同步定价数据，容易不一致
- 服务端无法验证价格（导致问题 #1）
- 修改定价需要改代码重新部署
- 定价是业务数据，不是文案翻译，放在 i18n 中是架构分层错误

**建议**：
- 抽出 `data/pricing.ts`（服务端常量）或数据库 `products` 表
- i18n 只负责文案翻译（产品名称描述等）
- Checkout API 从服务端定价表读取，不信任客户端

---

### 10. Stripe Webhook 事件覆盖严重不足

**位置**：`app/api/stripe-notify/route.ts:30-39`

**问题**：仅处理 `checkout.session.completed` 一种事件。缺少：

| 缺失事件 | 后果 |
|----------|------|
| `customer.subscription.deleted` | 用户取消订阅后积分仍在，可继续使用 |
| `invoice.paid` | 订阅续费时无法自动充值积分 |
| `customer.subscription.updated` | 订阅升级/降级无法同步 |
| `charge.refunded` | 退款后积分不扣回 |

项目已支持订阅模式（month/year），但订阅生命周期管理完全不完整。

**建议**：
- 至少补充 `subscription.deleted`（停止积分）和 `invoice.paid`（续费充值）
- 退款流程：Webhook 接收 `charge.refunded` → 扣回对应积分 → 更新订单状态

---

### 11. Supabase Client 每次调用都新建

**位置**：`models/db.ts:3-17`

**问题**：`getSupabaseClient()` 每次调用都执行 `createClient()`，创建新的 HTTP 连接池。在高频 API 调用下会有性能损耗。

**建议**：改为模块级单例：

```typescript
let client: SupabaseClient | null = null;

export function getSupabaseClient() {
  if (client) return client;
  // ... 初始化逻辑
  client = createClient(url, key);
  return client;
}
```

---

### 12. 无外键约束 + 缺少高频查询索引

**位置**：`data/install.sql`

**问题**：
- 表之间通过 `user_uuid`（VARCHAR）关联，但无外键约束，可能产生孤儿记录
- 以下高频查询字段无索引：
  - `users.invite_code`（邀请码查询）
  - `users.email`（邮箱查询）
  - `orders.user_uuid`（用户查订单）
  - `orders.status`（状态筛选）
  - `credits.user_uuid`（积分查询）
  - `credits.(user_uuid, expired_at)`（有效积分查询，复合索引）
  - `affiliates.invited_by`（邀请人查询）

**建议**：
- 添加外键约束（至少 `orders.user_uuid → users.uuid`、`credits.user_uuid → users.uuid`）
- 补充上述索引
- 如果引入 Drizzle ORM，可在 schema 定义中一并声明

---

### 13. `output: "standalone"` 与 `next start` 冲突

**位置**：`next.config.mjs:20`

**问题**：开启 `standalone` 后，`next start` 会警告不兼容。Vercel 部署不需要 standalone（Vercel 自动处理），Docker 部署才需要。

**建议**：
- 如果主力部署在 Vercel，去掉 `output: "standalone"`
- 或者通过环境变量条件控制：仅在 Docker 构建时启用

---

## 三、代码质量问题

### 14. `console.log` 作为唯一日志手段

**位置**：全局（`services/credit.ts`、`services/order.ts`、`services/user.ts` 等）

**问题**：所有错误处理都是 `console.log`。生产环境无法结构化查询、无法告警、无法按级别过滤。

**建议**：
- 统一封装 `lib/logger.ts`，提供 `logger.info()` / `logger.error()` 等方法
- 为后续接入 Sentry 做好准备
- 至少在 `catch` 块中使用 `logger.error` 而非 `console.log`

---

### 15. 无环境变量校验

**位置**：全局

**问题**：缺失任何必填环境变量时，应用启动不报错，运行时随机失败。作为模板，使用者很容易漏配变量。

**建议**：
- 用 zod 在应用启动时校验环境变量（`lib/env.ts`）
- 缺失必填项直接 fail fast，报错信息明确指出缺哪个变量
- 示例：

```typescript
import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_WEB_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  // ...
});

export const env = envSchema.parse(process.env);
```

---

### 16. `reactStrictMode: false`

**位置**：`next.config.mjs:21`

**问题**：模板项目应开启严格模式，帮助使用者尽早发现副作用问题（如 useEffect 重复执行、不纯的 render 等）。

**建议**：改为 `true`。

---

### 17. `images.hostname: "*"`

**位置**：`next.config.mjs:24-29`

**问题**：允许任意 HTTPS 图片源，存在 SSRF 和隐私追踪风险。

**建议**：限制为已知域名：
- `lh3.googleusercontent.com`（Google 头像）
- `avatars.githubusercontent.com`（GitHub 头像）
- 你的 S3/CDN 域名
- Stripe 等第三方服务的图片域名

---

### 18. Middleware 语言列表与实际不一致

**位置**：`middleware.ts:108`

**问题**：matcher 中列出了 14 种语言（en, en-US, zh, zh-CN, zh-TW, ...），但 `i18n/locale.ts` 中 `locales` 只有 `["en", "zh"]`。其他语言前缀会被匹配但没有翻译文件，静默 fallback 到 en。

**建议**：matcher 中只列出实际支持的语言，减少不必要的中间件处理。

---

## 四、模板可复用性问题

### 19. 无测试基础设施

**问题**：零测试文件，未配置测试框架。作为模板，核心业务逻辑的变更没有回归保障。

**建议**：
- 引入 Vitest（轻量、与 Next.js 兼容好）
- 至少为以下核心逻辑编写测试：
  - `services/credit.ts` 的 FIFO 扣减算法
  - `services/order.ts` 的支付处理流程
  - `services/user.ts` 的用户创建幂等性
  - 定价校验逻辑

---

### 20. UserCredits 类型有幽灵字段

**位置**：`types/user.d.ts`（`UserCredits` 接口）

**问题**：`one_time_credits`、`monthly_credits`、`total_credits`、`used_credits`、`free_credits` 字段在类型中定义但始终为 `undefined`，从未赋值。会误导模板使用者认为这些字段可用。

**建议**：删除未实现的字段，保持类型与实际行为一致。后续需要时再加。

---

### 21. 无 RBAC，admin 靠 email 白名单

**位置**：`app/[locale]/(admin)/layout.tsx`、环境变量 `ADMIN_EMAILS`

**问题**：管理员通过 `ADMIN_EMAILS` 环境变量管理，修改管理员需要改环境变量重新部署。不适合多人团队管理。

**建议**：
- `users` 表加 `role VARCHAR DEFAULT 'user'` 字段
- 支持 `user` / `admin` / `super_admin` 三级
- 比 `user_roles` 独立表更简单，对 SaaS 模板够用
- 管理后台可直接管理角色，无需改环境变量

---

### 22. 联盟奖励金额逻辑错误

**位置**：`services/affiliate.ts`

**问题**：文档指出 `reward_percent=20` 和 `reward_amount=5000`（$50）同时写入，但 `reward_amount` 是固定值而非按订单金额 × 20% 计算。即被邀请人付 $10 和付 $299，邀请人都得 $50 奖励。`reward_percent` 字段完全是误导。

**建议**：
- 如果是固定奖励：删除 `reward_percent`，只保留 `reward_amount`
- 如果是比例奖励：`reward_amount = min(order.amount * reward_percent / 100, 5000)`
- 明确语义，不要同时写两个含义冲突的字段

---

## 五、优先级调整建议

文档中 P0-P3 的划分基本合理，但以下项建议调整优先级：

| 项 | 当前优先级 | 建议优先级 | 原因 |
|----|-----------|-----------|------|
| #1 Checkout 金额校验 | 未列入 | **P0 之前** | 现在就能被利用，0 成本攻击 |
| #2 积分余额检查 | 未列入 | **P0 之前** | 现在就能透支 |
| #7 支付事务 | 未列入 | **P0** | 数据不一致比功能缺失更严重 |
| #10 Webhook 事件补充 | P3 | **P1** | 订阅模式已有但管理不完整 |
| #9 定价配置抽出 | 隐性需求 | **P0** | 是 #1 的根本原因 |
| #15 环境变量校验 | P3 | **P1** | 模板复用的第一步 |
| #8 迁移系统 | P3 | **P1** | 模板演进的基础设施 |

---

## 六、总结

### 最关键的三个问题

1. **支付安全三件套**：金额信任客户端 + 无事务 + 无余额检查。三者组合导致系统可被低成本攻击，必须在任何功能开发之前修复。
2. **可维护性基础缺失**：无迁移系统、无 ORM、无测试。作为模板会被大量复制，技术债会指数级传播。
3. **定价架构错误**：定价数据放在 i18n JSON 中是分层错误，导致服务端无法校验价格，是支付安全问题的根因。

### 建议执行顺序

```
第一步：修支付安全（#1 + #2 + #7）→ 定价抽出服务端（#9）
第二步：引入 Drizzle ORM + 迁移系统（#8）→ 补索引和外键（#12）
第三步：修认证安全问题（#3 + #4 + #5）
第四步：环境变量校验（#15）→ 日志封装（#14）
第五步：按原 P0-P3 路线图推进功能
```

### 文档评价

现有文档质量很高，问题梳理到位。本文档是对现有问题清单的补充和优先级重排，重点关注安全性和模板可复用性。

# 架构审查遗留项跟踪表

> 本文档是历轮架构审查的**结论跟踪表**，不再是静态报告。
> 约定：✅ 已落地（含落地位置）｜❌ 否决（含理由）｜⬜ 待落地（含优先级）。
> 每轮审查后更新本表，不允许留过时结论。

---

## 一、已落地（✅）

| # | 建议 | 落地位置 |
|---|------|----------|
| 1 | AI 网关闭环（鉴权→余额→原子扣减→模型路由） | [13-ai-gateway.md](./13-ai-gateway.md) + DEVELOPMENT_PLAN 6.0 |
| 2 | 免费试用额度（匿名演示 + 登录赠分） | [14-anonymous-trial.md](./14-anonymous-trial.md) + 6.0.1 |
| 3 | API 版本前缀 /api/v1 + HTTP 状态码 | 13 §决策 4 |
| 4 | Provider 抽象分层规则（lib 根目录 vs 子目录） | [01-architecture.md](./01-architecture.md) §2.1 |
| 5 | ~~aisdk 归属 lib/ai/providers~~ | ⬜ **迁移未发生**：`aisdk/` 仍在仓库根目录，已移入 §二待落地 |
| 6 | S3 key 硬编码修复 | P-1.8 问题 7 |
| 7 | 通知中心弃 Realtime 改轮询+SSE | 6.14 |
| 8 | 联盟奖励发放闭环 | [05-payment-credits-flow.md](./05-payment-credits-flow.md) §3.4 |
| 9 | admin 真空期鉴权过渡方案 | 01 §4.3 + 六-补章 |
| 10 | 图片/视频按次扣费模型 | 13 §决策 5.1 |
| 11 | API Key 与 session 同账户语义 | 01 §4.2 + 02 认证机制 |

### P-1 安全修复落地记录（阶段 1.5，2026-08）

> 对应 DEVELOPMENT_PLAN.md 六-补章节，全部完成并经 `tsc` 类型检查 + Vitest 18 用例 + `next build` 验证。

| # | 项 | 落地位置 |
|---|-----|----------|
| 12 | P-1.12 最小数据库迁移机制 | `lib/migrate.ts` + `instrumentation.ts` + `scripts/migrate.ts` + `data/migrations/`（0001~0004） |
| 13 | P-1.1 定价架构修复 | `data/pricing.ts`（服务端单一真相源）+ `app/api/checkout/route.ts` 只信服务端价格 + 删除 i18n/类型 cn_amount |
| 14 | P-1.2 积分扣减安全 | 迁移 `0002_credits_safe_decrease.sql`（行锁+余额校验+FIFO+负数 expired_at=NULL）+ `services/credit.ts` RPC + `models/credit.ts` 查询修正 |
| 15 | P-1.3 支付处理事务化 | 迁移 `0003_handle_order_payment.sql`（事务+幂等+联盟比例奖励）+ `services/order.ts` RPC + `OrderStatus` 补 Expired/Refunded |
| 16 | P-1.11 认证与 ID 安全 | `auth/config.ts` google-auth-library verifyIdToken(aud) + `lib/hash.ts` Snowflake 单例+SNOWFLAKE_WORKER_ID + `models/user.ts` findUserByEmail(provider) + `services/user.ts` 并发注册兜底 |
| 17 | P-1.4 认证安全 | `app/api/update-invite/route.ts` 改用 session + 删除 `/api/demo/*` 未认证端点 |
| 18 | P-1.5 API Key hash 存储 | `lib/hash.ts` hashString + `models/apikey.ts` 哈希查询 + 控制台创建页仅展示一次明文（`key_prefix` 展示） |
| 19 | P-1.6 配置安全 | `next.config.mjs`（strictMode=true、images 白名单、output 条件化）+ `middleware.ts` matcher 只留 en/zh + Dockerfile NEXT_OUTPUT=standalone |
| 20 | P-1.7 环境变量校验 + 日志 | `lib/env.ts`（zod 校验，instrumentation 启动 fail fast）+ `lib/logger.ts` |
| 21 | P-1.8 基础设施 | `models/db.ts` 单例 + `types/user.d.ts` 删幽灵字段 + 联盟比例奖励（`services/constant.ts` Paid 拼写）+ `lib/time.ts` 废弃 getMillisecond + `models/order.ts` getPaidOrders 重命名/清注释 + `lib/resp.ts` 简化 + `lib/storage.ts` getStorageKey(STORAGE_PREFIX) + 迁移 `0004_fk_indexes.sql` |
| 22 | P-1.10 CORS 配置 | `middleware.ts` API 路由 CORS 头 + OPTIONS 预检 + `CORS_ALLOWED_ORIGINS` |
| 23 | P-1.9 测试基础设施 | `vitest.config.ts` + `__tests__/`（pricing/hash/env/credit/order-payment 18 用例）+ `pnpm test` |

### P0 核心功能落地记录（阶段 2，2026-08）

| # | 项 | 落地位置 |
|---|-----|----------|
| 24 | 6.0 AI 网关闭环 v1 | `data/model-pricing.ts`（白名单+预估扣费）+ `lib/ai/registry.ts`（Provider 抽象）+ `lib/ratelimit.ts`（内存限流）+ `/api/v1/ai/generate`（鉴权→限流→402→原子扣减→生成→失败退款）+ `ai_generate/ai_refund` 交易类型 |
| 25 | 6.0.1 免费试用额度 v1 | 迁移 `0005_anonymous_usage.sql`（表+原子递增/递减 RPC）+ `/api/v1/ai/demo`（IP+设备指纹双维度限次，用完 429 提示登录）+ `lib/browser.ts`（FingerprintJS 开源版）+ 环境变量 ANONYMOUS_*/DEMO_* |
| 26 | 6.2 邮件通知系统 v1 | `lib/email/*`（Provider 抽象 + Resend 适配器 + fire-and-forget + 节流）+ `emails/`（React Email 布局 + welcome/payment_success/credit_low/credit_exhausted 模板）+ 触发点接入（saveUser 欢迎 / handleOrderSession 支付成功 / decreaseCredits 余额提醒） |
| 27 | 6.3 反馈/客服按钮 | `components/feedback/crisp.tsx`（右下角浮动，登录用户自动传 email/nickname）+ `app/[locale]/layout.tsx` 引入 + `NEXT_PUBLIC_CRISP_WEBSITE_ID` |
| 28 | 6.4 邮箱密码登录 | 迁移 `0006_password_login.sql`（verification_codes 表 + users.password_hash）+ `lib/password.ts`（bcryptjs + 强度校验）+ `models/verification.ts`（原子消费防一码多用）+ `/api/send-verification` + `/api/verify-code`（注册赠分/密码重置）+ auth Credentials Provider + `lib/login-guard.ts`（失败锁定）+ `components/sign/email-form.tsx` |
| 29 | 6.5 埋点与监控 v1 | `lib/telemetry/*`（客户端 track / 服务端 trackServer 抽象 + PostHog 适配器，吞错不阻塞）+ `components/analytics/posthog.tsx`（客户端初始化 + 身份缝合 + 输入遮盖）+ 漏斗埋点（pricing.viewed/plan_selected/checkout.started(t1)/url_redirected(t2)/payment.succeeded(t3 服务端)/signup/api_key.created/credits.exhausted） |
| 30 | 6.1 多支付渠道 阶段 1 | `lib/payment/*`（Provider 抽象 + registry + stripe/creem/waffo 三适配器）+ 迁移 `0007_multi_payment.sql`（orders.payment_provider + creem_orders/waffo_orders + payment_settings 种子）+ `/api/checkout` 统一入口（method 路由，前端不感知渠道）+ `/api/payment-methods` + `/api/creem-notify` + `/api/waffo-notify`（统一 handlePaymentEvent → handle_order_payment） |

### P1 后台强化落地记录（阶段 3，2026-08）

| # | 项 | 落地位置 |
|---|-----|----------|
| 31 | 6.10 RBAC 权限系统 | 迁移 `0008_rbac_audit.sql`（users.role + audit_logs 表）+ `lib/auth.ts`（getAdminUser/requireAdmin，ADMIN_EMAILS 白名单过渡）+ admin 布局改角色校验 + 侧边栏补 Dashboard/Credits 导航 |
| 32 | 6.7 用户管理 CRUD | `admin/users/page.tsx`（搜索 + 分页 + 角色/状态标识）+ `admin/users/[uuid]/page.tsx`（详情 + 角色/封禁/调整积分 server actions）+ `PUT /api/admin/user` + `POST /api/admin/user/credits` + `models/user.ts` searchUsers/countUsers/updateUserByAdmin |
| 33 | 6.9 积分管理 | `admin/credits/page.tsx`（流水列表，关联用户邮箱）+ `admin/credits/adjust/page.tsx`（按邮箱/uuid 调整）+ `adjustCreditsByAdmin`（system_add，负数 expired_at=NULL 与 P-1.2 语义一致） |
| 34 | 6.8 订单管理增强 | `admin/paid-orders/page.tsx`（搜索 + 分页 + 退款列）+ `POST /api/admin/refund`（按 payment_provider 分发：Stripe/Waffo 调 API 自动 + 扣回积分 min(订单积分,余额)；Creem 返回 Dashboard 手动指引）+ `lib/csv.ts` + `components/dashboard/stats/order-actions.tsx`（CSV 导出 + 退款按钮）+ stripe/creem/waffo 适配器 refund |
| 35 | 6.6 数据看板 | `services/stats.ts`（指标 + 30 天趋势聚合）+ `/api/admin/stats` + `admin/page.tsx`（6 指标卡 + 3 张趋势图）+ `components/dashboard/stats/charts.tsx`（无依赖 SVG 图表，recharts 依赖申请被拒后降级方案） |

### P2 体验增强落地记录（阶段 4，2026-08）

| # | 项 | 落地位置 |
|---|-----|----------|
| 36 | 6.11 用户个人资料 | `(console)/settings/`（昵称/语言偏好/头像）+ `PUT /api/user/profile` + `POST /api/user/avatar`（S3 上传 UI，STORAGE_PREFIX 前缀） |
| 37 | 6.13 用量统计 | `(console)/usage/page.tsx`（余额 + 日/周/月聚合 + API 调用记录） |
| 38 | 6.14 通知中心 | 迁移 `0009_notifications.sql` + `models/notification.ts` + `/api/notifications` + `/api/notifications/read` + `(console)/notifications/`（30s 轮询客户端组件，SSE 留 v2）+ 触发点（支付成功/积分耗尽） |
| 39 | 6.15 搜索 | `/api/search`（帖子 ILIKE 匹配）+ `components/blocks/blog/search-box.tsx`（帖子页搜索框）；后台用户/订单搜索已在 6.7/6.8 落地 |
| 40 | 6.16 数据备份与容灾 | `lib/backup.ts`（关键表导出 S3）+ `scripts/expire-orders.ts`（超时订单置 expired）+ `/api/cron/daily`（Vercel Cron + CRON_SECRET 校验）+ `/api/health`（健康检查）+ `vercel.json` cron 配置 |
| 41 | 6.17 GDPR 合规 | `/api/user/delete-account`（软删除 + 匿名化 email 避免唯一约束冲突 + 保留财务数据）+ `components/cookie-consent/`（同意横幅，GA/PostHog 同意后才加载）+ 设置页删除入口 |
| 42 | 6.12 订阅管理（预留） | `(console)/subscription/page.tsx`（v1 无订阅提示 + sub_id 订单展示；取消/门户走 Provider 接口 cancelSubscription/createPortal，v1 不启用订阅） |

### P3 工程化落地记录（阶段 5，2026-08）

| # | 项 | 落地位置 |
|---|-----|----------|
| 43 | 6.18 API 限流 | `lib/ratelimit.ts` 升级（Upstash Ratelimit 配置时启用 + 内存降级 + 用户分级配额 免费 10/天、付费 100/天）+ `/api/v1/ai/generate` 接入 IP + 用户双维度 |
| 44 | 6.20 审计日志完善 | `admin/audit-logs/page.tsx`（后台审计查看页 + 侧边栏入口）；`lib/audit.ts` 写入已覆盖用户更新/调积分/退款 |
| 45 | 6.21 Webhook 安全增强 | stripe parseWebhook 补 `charge.refunded`（payment_intent 反查订单）；creem 补 `refund.created` + subscription.* 记录；waffo 已有 onRefund；`services/refund.ts`（webhook 与后台退款共用扣积分逻辑）+ handlePaymentEvent 处理 refund_succeeded |
| 46 | 6.22 CSRF 防护 | `middleware.ts` Origin 校验（非 GET 非豁免 API：Origin 存在但不同源/不在白名单 → 403；缺失 Origin 放行非浏览器客户端；`*-notify` 与 `/cron/` 豁免） |
| 47 | 6.1 阶段 3 支付路由 | `lib/payment/health.ts`（连续失败 5 次/10min → unhealthy 30min）+ `registry.getEnabledProviders` 过滤 unhealthy + checkout 路由失败计数/成功恢复 |
| 48 | Drizzle ORM 基础 | `db/schema.ts`（核心表类型化定义）+ `drizzle.config.ts` + `drizzle-kit generate`（`data/drizzle/0000_certain_manta.sql`）+ `pnpm db:generate`；数据访问层暂保留手写 Supabase Client（渐进升级） |

### 第四轮审查落地记录（资金安全 + 防刷，2026-08-16）

### 第五轮审查验证通过项（2026-08-16，文档 vs 代码全量核对）

> 本轮方法：两路独立审查（业务/鉴权面 + 数据库/运维面）交叉 + 关键结论人工复核。
> 以下为「被怀疑过、验证后确认没问题」的项，避免后续重复怀疑：

| # | 验证项 | 结论 |
|---|--------|------|
| 55 | 金额比对币种大小写 | ✅ 0010 迁移用 `LOWER()` 双侧归一化，Stripe 小写 usd vs 本地大写 USD 不会误杀 |
| 56 | Waffo 金额单位闭环 | ✅ checkout `(cents/100).toFixed(2)` 出、webhook `*100` 回，分单位自洽，不会自我 mismatch |
| 57 | pay-success 页金额来源 | ✅ 取自 `stripe.checkout.sessions.retrieve` 权威值（非客户端输入），同样经 0010 比对，无伪造空间 |
| 58 | middleware /api 覆盖 | ✅ `/(api)/:path*` 明确纳入（CORS+CSRF Origin 校验），非 GET webhook 外请求跨站可被拦截；delete-account 不可被 CSRF |
| 59 | 邮件模板注入 | ✅ React Email 自动转义，无 dangerouslySetInnerHTML；唯一用户可控变量 nickname 安全 |
| 60 | API key 体系 | ✅ sk- 前缀 + crypto.randomInt 生成 + SHA-256 哈希等值查找（非明文比对） |
| 61 | NEXT_PUBLIC_ 泄漏面 | ✅ 15 个变量全为公开性质（URL/开关/分析 ID），无服务端 secret 走客户端 |
| 62 | storage 路径穿越 | ✅ S3 key 服务端拼接，avatar 仅 ext 可控且 S3 扁平 key 无 ../ 语义 |
| 63 | 单测/脚本密钥 | ✅ __tests__ 与 scripts 无真实密钥、无生产 URL |
| 64 | 退款幂等双入口 | ✅ admin API 与 refund webhook 并发调用只扣一次（0011 行锁 + 已 refunded 返回 0） |

### 第五轮修复落地记录（2026-08-16，2.7~2.9 + 2.13~2.19）

| # | 修复项 | 落地内容 |
|---|--------|----------|
| 65 | 2.7 RBAC 分级与提权防护 | `lib/auth.ts` 重写：`requireAdmin(level)` 三级（operator 看板/查询、admin 退款/调积分/封禁、super_admin 角色授予）+ `hasAdminLevel`；`getAdminUser` 拦截 `status='banned'`（JWT 不随 ban 吊销，必须实时查库）；`/api/admin/user` 传 role 时强制 super_admin；`/api/admin/refund` 与 `/api/admin/user/credits` 提为 admin 级 |
| 66 | 2.8 API 响应泄露敏感字段 | `services/user.ts` 新增 `toSafeUser()` 白名单出口（剔除 password_hash/password_updated_at/signin_ip/signin_openid/status）；`/api/get-user-info` 与 `/api/update-invite` 改用 |
| 67 | 2.9 AI messages 输入不计费 | `estimateCredits()` 增加 messages 参数按 JSON 序列化长度计入输入估算（与 prompt 同口径 /4 粗估）；generate 路由传入 |
| 68 | 2.13 备份明文敏感数据 + cron 裸奔 | `lib/backup.ts` users 导出收敛为白名单字段（剔除 password_hash/signin_openid/signin_ip）；`/api/cron/daily` 生产环境未设 CRON_SECRET 拒绝执行（fail fast）；.env.example CRON_SECRET 加必填标注 |
| 69 | 2.14 AUTH_SECRET 内置默认值 | .env.example 置空 + ⚠️ 注释（openssl rand -base64 32）；validateEnv 的 min(1) 会强制用户填写 |
| 70 | 2.15 验证码明文 + 无清理 | `models/verification.ts`：code 存/查均走 `hashString`（明文只在生成瞬间返回发件流程）；新增 `cleanupVerificationCodes()` 挂入 cron daily（删过期超 1 天记录）；测试补「库中无明文」「查询参数无明文」断言 |
| 71 | 2.16 TRUSTED_PROXY 默认值 | `lib/ip.ts` 默认 "vercel" -> "none"（不信任任何代理头）；Vercel 部署需显式声明 TRUSTED_PROXY=vercel；.env.example 注明 Docker/自托管误配后果 |
| 72 | 2.17 Docker 层泄漏 .env | .dockerignore 追加 `.env` / `.env.*` / `!.env.example` |
| 73 | 2.18 HSTS | next.config.mjs 增加 `Strict-Transport-Security: max-age=15552000; includeSubDomains`（CSP 仍留部署平台按需） |
| 74 | 2.19-① pay-success 落账面 | 页面收敛为纯 redirect，不再 retrieve session / 调 handleOrderSession；落账唯一入口收敛到验签 webhook |

> 审查发现：Webhook 全链路零金额校验、订单不写 payment_provider（非 Stripe 渠道后台退款失效）、退款并发双扣竞态、IP 信任可伪造头、验证码可刷可爆、匿名 demo 可刷额度调贵模型。已修 6 项（R1-R3/S1-S3），其余登记为 2.7~2.12 待办。

| # | 项 | 落地位置 |
|---|-----|----------|
| 49 | R1 Webhook 金额/币种比对 | 迁移 `0010_payment_amount_verification.sql`（handle_order_payment 增加 p_amount_cents/p_currency，不匹配置 `status='mismatch'` 不充值）+ 三适配器 PaymentEvent 补 `currency`（Creem 修复 price 对象归一化）+ `lib/payment/index.ts`/`services/order.ts` 传参与 mismatch 告警（TelemetryEvents.PaymentAmountMismatch）；关联决策：Stripe `allow_promotion_codes` 禁用（打折实付≠订单额，与精确比对互斥） |
| 50 | R2 订单写入 payment_provider | `app/api/checkout/route.ts`（admin 退款按此分发，此前 Waffo/Creem 订单被默认值错路由到 Stripe） |
| 51 | R3 退款原子化 | 迁移 `0011_process_order_refund.sql`（状态检查+扣积分+标记 refunded 单事务，行锁 + 已 refunded 幂等返回 0）+ `services/refund.ts` 改 RPC 调用 |
| 52 | S1 IP 信任收敛 | `lib/ip.ts`（TRUSTED_PROXY=cloudflare 只信 cf-connecting-ip / vercel 默认只信 x-forwarded-for 首跳，其余头客户端可伪造不再采信） |
| 53 | S2 验证码安全 | `lib/hash.ts` getNonceStr 改 `crypto.randomInt`（验证码与 API Key 共用熵源）+ `/api/verify-code` 按邮箱 5 次/分 + IP 20 次/分限流 + `/api/send-verification` 60s 冷却与每日 10 次真正落地 + 生产未配置 Resend 时不再回显验证码 + `lib/ratelimit.ts` 修复 Upstash 路径忽略 max 参数 |
| 54 | S3 匿名 demo 收敛 | `app/api/v1/ai/demo/route.ts`：模型由服务端 DEMO_MODEL 决定（不接受客户端 model，白名单内贵模型不再可匿名调用）+ 额度键改纯 IP（x-device-id 可伪造，`ANONYMOUS_FINGERPRINT_ENABLED` 废弃） |
| 55 | 对抗性回归测试 | `__tests__/payment-event.test.ts`（金额比对/mismatch 不发通知/refund 分发）+ `__tests__/refund.test.ts` 重写为 RPC 契约（含幂等）+ `__tests__/order-payment.test.ts` 补金额断言（共 126 用例） |

---

## 二、待落地（⬜）

> ⚠️ **状态盘点（2026-08 对抗式审查）**：本节多项已在代码中修复但表格未同步，
> 已逐项在标题标注。确认已落地：2.2（P-1.12）、2.4（P-1.3）、2.5（P-1.1）、
> 2.7（requireAdmin(level)）、2.8（toSafeUser）、2.9（messages 计费）、2.11（waffo 超时兜底）、
> 2.13（备份白名单 + cron fail fast）、2.14（AUTH_SECRET 置空）、2.15（验证码 hash + 清理）、
> 2.16（TRUSTED_PROXY 默认 none）、2.17（.dockerignore）、2.19-①（pay-success 收敛为纯跳转）。
> 部分落地：2.18（HSTS ✅ / CSP ⬜）、2.12/2.19 其余子项见标题标注。
> 仍未落地：2.10（pending_refunds 补偿表 + 每日对账）、2.6（E2E 支付测试）、#5（aisdk 归属）。

### aisdk 归属迁移（原 §一 #5，⬜ 待落地）

| 项 | 说明 |
|----|------|
| **问题** | `aisdk/`（Kling 视频等 Provider）仍位于仓库根目录，未按 01 §2.2 分层规则迁入 `lib/ai/providers` |
| **决策** | 迁入 `lib/ai/providers/` 并更新 import 路径；或修订 01 分层规则承认 aisdk 例外 |
| **优先级** | 低（P3，纯工程整理，无功能影响） |

### 第五轮审查新增待办（2026-08-16，文档 vs 代码偏差 + 备份/配置面）

### 2.13 备份链路明文导出敏感数据 + cron 未鉴权放大（✅ 已落地：备份 select 白名单 + 生产未配 CRON_SECRET fail fast，见 lib/backup.ts / cron/daily 注释）

| 项 | 说明 |
|----|------|
| **问题** | `lib/backup.ts` 每日把 users 表**全量明文 JSON（含 password_hash、signin_openid、signin_ip）**上传 S3，bucket 公开性完全依赖部署方自觉；且该备份由 `/api/cron/daily` 触发，`CRON_SECRET` 未设置时（.env.example 默认空）该端点**完全无鉴权**，外部可任意触发全量导出（DoS 放大 + 存储成本攻击） |
| **决策** | ① 备份 select 收敛白名单字段（剔除 password_hash/signin_openid）或加密后再上传；② cron 未设 CRON_SECRET 时生产环境拒绝执行（fail fast 而非跳过校验）；③ .env.example 的 CRON_SECRET 加显著必填注释 |
| **优先级** | **高（P1）** |

### 2.14 .env.example 内置真实格式 AUTH_SECRET 默认值（✅ 已落地：`.env.example` 已置空）

| 项 | 说明 |
|----|------|
| **问题** | `.env.example:25` 的 `AUTH_SECRET = "Zt3BXVudzzRq2R2WBqhwRy1dNMq48Gg9zKAYq7YwSL0="` 是一个非空真实格式值；`lib/env.ts` 校验仅 `min(1)`，fork 用户不替换即通过校验 -> 所有未改配置的部署共享同一 JWT 签名密钥（可伪造任意用户会话，含管理员） |
| **决策** | `.env.example` 置空 `AUTH_SECRET = ""`（让 fail-fast 逼用户生成）；README/08 增加 `openssl rand -base64 32` 生成指引 |
| **优先级** | **高（P1，模板分发特有）** |

### 2.15 verification_codes 明文存储且无过期清理（✅ 已落地：SHA-256 hash + 原子消费 + cleanupVerificationCodes 挂 cron）

| 项 | 说明 |
|----|------|
| **问题** | ① `code` 明文入库（`models/verification.ts` 直接 insert），与 API key 的 hashString 处理不一致--DB/备份泄漏即可读出未使用验证码接管任意邮箱账号；② 无任何清理任务，过期记录永久留存，表无限膨胀（放大泄漏面） |
| **决策** | code 存 hash（比对时哈希后查）；cron daily 顺带清理 `expired_at < now() - 1d` 的记录 |
| **优先级** | 中高（P1） |

### 2.16 TRUSTED_PROXY 默认值在 Docker 自托管下信任伪造头（✅ 已落地：默认改为 `none`，lib/ip.ts）

| 项 | 说明 |
|----|------|
| **问题** | `lib/ip.ts` 默认 `"vercel"`（信任 x-forwarded-for 首跳）。Vercel 部署下平台覆写该头，安全；但 **Docker/self-host 不改配置时**，自建 nginx 通常 append 而非覆写，攻击者逐请求伪造 `X-Forwarded-For` 即可绕过全部 IP 维度限流（发码冷却/日上限、登录锁、匿名额度） |
| **决策** | Docker 部署文档显著标注必须设置；或默认值改为 `"none"`（只认 socket 直连），显式声明平台才信任代理头（更安全的默认） |
| **优先级** | **高（P1，self-host 场景）** |

### 2.17 Docker 构建中间层泄漏 .env（✅ 已落地：.dockerignore 排除 .env/.env.*，保留 .env.example）

| 项 | 说明 |
|----|------|
| **问题** | `.dockerignore` 未排除 `.env*`，builder 阶段 `COPY . .` 把含真实密钥的 `.env.local` 带进镜像中间层；runner 层虽不含，但推送镜像仓库时历史层可被提取 |
| **决策** | `.dockerignore` 增加 `.env*`（保留 `.env.example`） |
| **优先级** | 中（P2） |

### 2.18 安全响应头缺失：CSP 与 HSTS（⚠️ 部分：HSTS ✅ 已加；CSP ⬜ 仍待办）

| 项 | 说明 |
|----|------|
| **问题** | `next.config.mjs` 已配 X-Frame-Options/nosniff/Referrer-Policy 等，但 **CSP 与 HSTS 缺失**（注释自认 CSP 交给部署平台）。对涉及支付的站点，缺 CSP 意味着 XSS 发生时无外联脚本拦截兜底 |
| **决策** | HSTS 直接加（无兼容成本）；CSP 先 Report-Only 模式上线收集违规报告，再切换 enforce |
| **优先级** | 中（P2） |

### 2.19 第五轮杂项（① ✅ pay-success 收敛为纯跳转；②③④ ⬜ 待落地）

| 项 | 说明 |
|----|------|
| **问题** | ① pay-success 页面无鉴权，任何持有 session_id 者可触发 Stripe retrieve + 落账 RPC（金额取自 Stripe 权威值且经比对，无资金风险，但可刷 API 配额/触发邮件）；② delete-account 软删除但保留 password_hash/signin_openid，docs/15 的 GDPR ✅ 名不副实；③ `rateLimitUser` 在 Upstash 未配置时 `return { ok: true }` 静默放行（2.12-⑤ 已登记决策，代码未改，此处升级为「生产告警」要求）；④ Snowflake workerId 默认 1，多实例不配置会撞 order_no 唯一约束 |
| **决策** | ① pay-success 落账逻辑仅信任 webhook，页面只做展示；② GDPR 文档改 ⚠️ 或删除前清除敏感字段；③④ 按原决策落地 |
| **优先级** | ①②③ P2；④ P2（多实例部署前） |

### 第四轮审查新增待办（资金安全与防刷，2026-08-16，见 2.7~2.12）

### 2.7 RBAC 分级与提权防护（✅ 已落地：requireAdmin(level) + status 检查，lib/auth.ts）

| 项 | 说明 |
|----|------|
| **问题** | `/api/admin/user` PUT 允许设置任意角色，无「仅 super_admin 可授 super_admin」约束；`requireAdmin()` 对 operator/admin/super_admin 一视同仁——operator 可自我提权、可无限给自己加积分；`getAdminUser` 不检查 `user.status`，被 ban 管理员仍可操作 |
| **决策** | `requireAdmin(level)` 分级 + 授予 super_admin 需 super_admin + 鉴权处检查 status |
| **优先级** | P1（单人自用时风险可控，模板给他人用前必须） |

### 2.8 API 响应泄露敏感字段（✅ 已落地：toSafeUser 白名单出口，services/user.ts）

| 项 | 说明 |
|----|------|
| **问题** | `/api/get-user-info`、`/api/update-invite` 返回整行 user（`select(*)`），`password_hash`/`role`/`signin_ip` 泄露给客户端 |
| **决策** | 定义 `toSafeUser()` 白名单字段出口；models 层 select 收敛 |
| **优先级** | P1 |

### 2.9 AI 网关 messages 输入不计费（✅ 已落地：estimateCredits 按 messages 序列化长度估算，见 13 §决策 2 标注）

| 项 | 说明 |
|----|------|
| **问题** | `/api/v1/ai/generate` 计费只按 `prompt` 字符数估算，实际调用优先 `messages`——传 messages 的用户输入 token 计费为 0，平台承担上下文成本 |
| **决策** | v1 简化：拒绝 `messages` 只收 `prompt`；或按序列化长度估算 |
| **优先级** | P1 |

### 2.10 退款/AI 补偿对账

| 项 | 说明 |
|----|------|
| **问题** | AI 失败退款失败仅日志无补偿；admin 退款「渠道已退、本地扣积分失败」产生不可修复的资损不一致（重试被 status 挡住）；无渠道账单 vs 本地订单的每日对账 |
| **决策** | `pending_refunds` 补偿表 + 每日对账 cron（渠道成交 vs 本地 paid/mismatch 订单） |
| **优先级** | P1 |

### 2.11 Waffo 适配器验签失败永久挂起（✅ 已落地：超时兜底，lib/payment/providers/waffo.ts）

| 项 | 说明 |
|----|------|
| **问题** | `parseWebhook` 假设 SDK 验签失败会 reject，实际 SDK 返回 failed result（resolve）——Promise 永久 pending，请求悬挂至平台超时，配合渠道 8 次重试形成 DoS 放大；未知事件类型同样挂起 |
| **决策** | 加超时兜底 + 本地 `verifySignature()` 复核，不依赖 SDK 内部时序 |
| **优先级** | P1（启用 Waffo 渠道前必须） |

### 2.12 杂项安全加固

| 项 | 说明 |
|----|------|
| **问题** | ① banned/deleted 用户不拦截（session 仍可消耗积分）② `CRON_SECRET` 未配置时 cron 端点开放 ③ `respErr` 默认 HTTP 200 不利于监控/WAF ④ admin/搜索接口 PostgREST 过滤语法注入面（keyword 拼进 `.or()`）⑤ 登录锁/限流为单实例内存（多实例失效）⑥ 联盟奖励退款不回冲 |
| **决策** | 按项逐个修；⑤ 通过文档强制「生产必须配置 Upstash」+ `rateLimitUser` 未配置时改为明确告警 |
| **优先级** | P2 |

### 2.1 channel_products 表拆分

| 项 | 说明 |
|----|------|
| **问题** | `payment_products` 把渠道专属 ID 作为列（creem_product_id/stripe_price_id），渠道多后成稀疏矩阵 |
| **决策** | **v1 保持单表**：v1 只有 Creem + Waffo，Waffo 动态金额不需要 channel_product_id，只有 Creem 需要一列，稀疏矩阵不成立。**阶段 2 加 Stripe/PayPal 时再拆**为 `payment_products` + `channel_products` 两张表 |
| **优先级** | P0（阶段 2 时） |

> 现状（2026-08）：Stripe 已接入但仍维持单表（渠道专属 ID 作列 + session id 回写订单行），
> 尚未触发拆表；新增 PayPal 等渠道时重新评估。

### 2.2 最小迁移机制（✅ 已落地：P-1.12，见 §一表 #12）

| 项 | 说明 |
|----|------|
| **问题** | P-1.3 用存储过程 = 数据库迁移，但迁移系统在 P3，循环依赖 |
| **决策** | P-1 阶段先落地**最小迁移方案**：`data/migrations/` 目录 + 顺序执行 SQL + `schema_migrations` 版本表（~30 行），Drizzle 留 P3 做类型化升级 |
| **优先级** | P-1（见 P-1.12） |

### 2.3 数据层类型安全

| 项 | 说明 |
|----|------|
| **问题** | models 层手写 Supabase Client，`data` 为 `any`，与 2.1「全量类型安全」宣传不符 |
| **决策** | **v1 诚实标注**：在 DEVELOPMENT_PLAN 2.1 注明「数据层为手写 Supabase Client，返回类型靠手工断言，无编译期 schema 校验；Drizzle 引入后升级」。不提前引入 Drizzle（P-1 阶段改动过大） |
| **优先级** | 文档标注即时；Drizzle 仍 P3 |

### 2.4 orders.status 枚举补 expired（✅ 已落地：P-1.3 一并补 Expired/Refunded）

| 项 | 说明 |
|----|------|
| **问题** | 三处文档引用「标记订单 expired」，但 `models/order.ts` 的 `OrderStatus` 枚举只有 created/paid/deleted |
| **决策** | `OrderStatus` 补 `Expired = "expired"` 和 `Refunded = "refunded"`（退款流程也需要）。6.16 定时任务将超时 created 订单置为 expired |
| **优先级** | P-1.3 事务化时一并补（同一涉及文件） |

### 2.5 cn_amount 残留处置（✅ 已落地：P-1.1 一并删除）

| 项 | 说明 |
|----|------|
| **问题** | i18n JSON 有 `cn_amount`（人民币价），但 checkout 从不读它，给人多币种假象 |
| **决策** | **删除**。v1 单一 USD 价，多币种/地区定价明确不做（MoR 渠道的全球定价能力留作后续产品决策，非模板必须）。删除 i18n JSON 的 cn_amount 字段 + `types/blocks/pricing.d.ts` 的 cn_amount 类型 |
| **优先级** | P-1.1 定价修复时一并删 |

### 2.6 E2E 支付流程测试

| 项 | 说明 |
|----|------|
| **问题** | P-1.9 只有 Vitest 单测，checkout→webhook→积分充值→联盟奖励这条链单测覆盖不了 |
| **决策** | P-1.9 补充：Stripe test mode + `stripe listen` 转发 + playwright 全流程断言 |
| **优先级** | P-1.9 补充分项 |

---

## 三、已否决（❌）

| # | 建议 | 否决理由 |
|---|------|----------|
| 1 | 匿名额度用重型设备指纹（FingerprintJS Pro） | 付费 SaaS + 数据过第三方 + GDPR 负担，模板阶段开源版够用（见 14 §5） |
| 2 | 退款精确按订单追踪积分来源 | 需引入积分来源维度，v1 用近似口径（min(该订单积分, 当前余额)），见 6.1 订阅口径 |
| 3 | 邮件/埋点也建 registry + 数据库配置表 | 热切换诉求只有支付有，邮件/埋点用「接口 + 环境变量选实现」即可（见 12 原第五轮 §9 已吸收进 01 分层规则） |

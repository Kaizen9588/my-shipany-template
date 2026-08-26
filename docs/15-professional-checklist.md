# 专业 SaaS 模板完整度清单

> 本清单用于评估 `my-shipany-template` 作为专业 AI SaaS 通用模板的完整度。
> 每一项列出：状态 / 实现位置 / 说明。
>
> **状态定义**（第八轮审查后统一）：
> - ✅ 已验证：代码 + 集成测试均通过，生产可用
> - ✅ 已实现：代码已落地，但未经过针对性集成测试/对抗验证
> - ⚠️ 部分实现：主要功能有，但有已知缺口或设计缺陷
> - ❌ 未完成 / No-Go：有阻断性缺陷，真实收费前必须修复
> - 🚧 规划中：仅设计或 backlog 阶段
>
> ⚠️ **整体结论**：模板骨架完整度高，但**资金与计费闭环不满足生产收费标准（No-Go）**。
> 详见各模块下的 ❌/⚠️ 项和 [第八轮审查结论汇总](./boundary-spec.md#九待关闭的边界缺口生产-no-go-清单)。

---

## 一、基础工程化

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 包管理 | ✅ | pnpm 11 + `pnpm-workspace.yaml`（allowBuilds 已配置） |
| TypeScript 严格模式 | ✅ | `tsconfig.json` strict: true |
| 代码检查 | ✅ | ESLint 9 flat config（`eslint.config.mjs`），`pnpm lint` 0 error |
| 单元测试 | ✅ | Vitest 43 文件 / 179 用例，`pnpm test`（数字随测试演进，以实际输出为准） |
| 生产构建 | ✅ | `pnpm build` 通过 |
| CI/CD | ✅ | `.github/workflows/ci.yml`（typecheck + lint + test + build） |
| 数据库迁移 | ⚠️ 部分实现 | `data/migrations/*.sql` + `instrumentation.ts` 自动执行；但无并发锁/事务/回滚/发布顺序约定（P1-7，第九轮） |
| 环境变量校验 | ✅ | `lib/env.ts`，启动时 fail-fast |
| 健康检查 | ✅ | `GET /api/health` |
| 日志 | ⚠️ | `lib/logger.ts` 统一封装已存在；接线推进中（checkout 失败分支、三渠道 webhook 验签/处理失败已接，其余错误路径仍为裸 console） |

## 二、安全

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 安全响应头 | ✅ | `next.config.mjs` headers（X-Frame-Options / no sniff / Referrer / Permissions / COOP） |
| CSRF 防护 | ✅ | `middleware.ts` Origin 校验（webhook/cron 豁免） |
| CORS 白名单 | ✅ | `middleware.ts` + `CORS_ALLOWED_ORIGINS` |
| 密码哈希 | ✅ | bcrypt（`lib/password.ts`） |
| 默认管理员弱口令 | ❌ No-Go | 迁移 0012 无条件创建 `admin@shipany.local/123456/super_admin`，谁先登谁改密（P0-3，第九轮） |
| 登录失败锁定 | ✅ | `lib/login-guard.ts`（邮箱 5 次 / IP 10 次） |
| 登录限流 | ✅ | `lib/ratelimit.ts`（Upstash / 内存降级） |
| API Key 哈希存储 | ✅ | `lib/hash.ts` + `models/apikey.ts`（只存 SHA-256） |
| Snowflake 唯一 ID | ✅ | `lib/hash.ts` workerId 单例 |
| 支付金额服务端校验 | ⚠️ 部分实现 | `data/pricing.ts` 单一真相源 vs `payment_products` 表优先两处矛盾（P1-8，第九轮）；webhook 金额校验空值可绕过（P0） |
| 积分原子扣减 | ⚠️ 部分实现 | `decrease_credits` 存储过程防透支；但「行锁串行化」论证不成立（P0-2，第九轮），且批次账本缺失，过期/退款/审计有根本缺陷（P0） |
| Webhook 验签 | ✅ 已实现 | Stripe / Creem / Waffo 适配器；但缺少事件 inbox、幂等、重放防护和对账（P0） |
| 图片域名白名单 | ✅ 已实现 | `next.config.mjs` images.remotePatterns |
| 资金 RPC 权限边界 | ❌ No-Go | 三个资金函数在 public schema，无 REVOKE/GRANT/RLS（P0） |
| 数据库 RLS | ❌ 未完成 | 核心表未启用 RLS，service_role 与 client 不分离 |
| 限流 fail-closed | ⚠️ 有风险 | Upstash 未配置时静默放行；多实例部署下内存限流无效 |

## 三、数据库与数据

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Schema 文档 | ✅ | `docs/03-database-schema.md` |
| 表结构 | ✅ | users / orders / credits / apikeys / posts / affiliates / 多渠道表 |
| 索引 | ✅ | 迁移 `0004_fk_indexes.sql` |
| 备份 | ⚠️ 部分实现 | `lib/backup.ts` + Vercel Cron 存在；但 select("*") 含 PII，无加密、无保留期限、无恢复演练 |
| 幂等支付处理 | ⚠️ 部分实现 | `handle_order_payment` 存储过程行锁 + 状态幂等；但缺少 webhook inbox 和跨渠道对账 |
| 积分批次账本 | ❌ No-Go | 当前正负净额模型无法正确处理过期、退款、审计（P0） |

## 四、认证与用户

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Google / GitHub OAuth | ✅ | `auth/config.ts` |
| Google One-Tap | ✅ | `hooks/useOneTapLogin.tsx` |
| 邮箱密码登录 | ✅ | `app/api/verify-code` + `components/sign/email-form.tsx` |
| 邮箱验证码 | ⚠️ 有缺陷 | `models/verification.ts` 存在；但消费逻辑 `count` 检查疑似在真实 Supabase 下始终失败（P0） |
| 密码重置 | ⚠️ 有缺陷 | 同验证码消费逻辑问题（P0） |
| RBAC | ✅ 已实现 | `lib/auth.ts` + users.role 三级（operator/admin/super_admin） |
| 账号删除（GDPR） | ⚠️ 部分实现 | 软删除 + 匿名化 email；但保留 password_hash/signin_openid/signin_ip；PostHog 删除联动未实现；无数据导出 |
| 会话 / JWT | ✅ 已实现 | NextAuth v5；但封禁/删除后 session 不即时失效（P1） |
| OAuth Account Linking | ❌ 未完成 | 同邮箱多 provider 不合并，可能拆散积分与订单（P1） |

## 五、支付（Provider 抽象）

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Stripe | ✅ | `lib/payment/providers/stripe.ts` |
| Creem（MoR） | ✅ | `lib/payment/providers/creem.ts` |
| Waffo（MoR+PSP） | ✅ | `lib/payment/providers/waffo.ts` |
| 渠道热切换 | ✅ | `payment_settings` 表 |
| 健康检测 failover | ✅ | `lib/payment/health.ts` |
| 退款 | ⚠️ 部分实现 | `services/refund.ts` 存在；但部分退款与积分回收不一致（P0），缺少 refunds 表、幂等、对账 |
| 订阅 | ⚠️ | 代码存在，v1 不启用（见 DEVELOPMENT_PLAN 5.3） |
| 支付事件 inbox / 对账 | ❌ No-Go | 缺少 webhook 原始事件持久化、幂等、重放防护、每日对账（P0） |
| 远端成功本地失败补偿 | ❌ No-Go | 先建远端再写本地，失败无 outbox/补偿/对账（P0） |
| 退款对已消费积分无回收路径 | ❌ No-Go | 方案 A/B 都不闭环，缺退款准入校验 + 债务化 + refund_blocked（P0-1，第九轮） |
| 争议/拒付链路 | ❌ 未完成 | `PaymentEventType` 无争议类型、`orders.status` 无 disputed/charged_back（P2-2，第九轮） |

## 六、AI 能力

| 项 | 状态 | 实现位置 |
|----|------|----------|
| AI SDK 统一入口 | ✅ | `lib/ai/registry.ts` + `app/api/v1/ai/generate` |
| 模型白名单 | ✅ | `data/model-pricing.ts` |
| 计入扣费 | ⚠️ 部分实现 | `estimateCredits` 预估一次扣清；但无幂等、无状态机、崩溃不补偿（P0） |
| 失败退款 | ⚠️ 不可靠 | `ai_refund` 事务类型存在；但只在进程内执行，崩溃后积分永久丢失 |
| 匿名免费试用 | ⚠️ 有缺陷 | `app/api/v1/ai/demo` + 纯 IP 限流；但「失败退还次数 + 输入无大小限制」可让单 IP 100% 失败并退还次数，不换 IP 也能无限调用（P0-4，第九轮） |
| 幂等键 / Idempotency-Key | ❌ 未完成 | v1 未实现；真实收费前必须完成（P0） |
| 输入大小 / schema 限制 | ❌ 未完成 | prompt/messages 无字节数、消息条数、字段白名单限制（P1） |

## 七、营销与内容

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Landing Page | ✅ | `app/[locale]/(default)` + `i18n/pages/landing/` |
| 定价展示 | ✅ | `components/blocks/pricing` |
| 博客 | ✅ | `app/[locale]/(default)/posts` + Markdown 编辑器 |
| 联盟营销 | ✅ | `services/affiliate.ts` + `models/affiliate.ts` |
| 邀请码 | ✅ | `app/[locale]/(default)/i/[code]` |
| SEO metadata | ✅ | `app/[locale]/layout.tsx`（OG / Twitter / robots） |
| Sitemap | ✅ | `app/sitemap.ts`（动态，多语言） |
| robots.txt | ✅ | `public/robots.txt` |
| Cookie 同意 | ✅ | `components/cookie-consent` |
| 法律页 | ✅ | Privacy / Terms（MDX） |

## 八、用户控制台

| 项 | 状态 | 实现位置 |
|----|------|----------|
| API Key 管理 | ✅ | `app/[locale]/(console)/api-keys` |
| 我的积分 | ✅ | `app/[locale]/(console)/my-credits` |
| 我的订单 | ✅ | `app/[locale]/(console)/my-orders` |
| 我的邀请 | ✅ | `app/[locale]/(console)/my-invites` |
| 个人资料 | ✅ | `app/[locale]/(console)/settings` |
| 用量统计 | ✅ | `app/[locale]/(console)/usage` |
| 通知中心 | ✅ | `app/[locale]/(console)/notifications` |
| 订阅管理 | ✅ | `app/[locale]/(console)/subscription` |

## 九、后台管理

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 数据看板 | ✅ | `app/[locale]/(admin)/admin/page.tsx` + `services/stats.ts` |
| 用户管理 | ✅ | `admin/users` + `admin/users/[uuid]` |
| 订单管理 | ✅ | `admin/paid-orders` + 退款 / CSV 导出 |
| 积分管理 | ✅ | `admin/credits` + 手动调整 |
| 文章管理 | ✅ | `admin/posts` |
| 审计日志 | ✅ | `lib/audit.ts` + `admin/audit-logs` |
| 支付渠道管理 | ✅ | `admin/payment`（启用/优先级热切换，docs/payment/provider-abstraction.md） |
| 定价管理 | ✅ | `admin/pricing`（payment_products 热编辑） |
| 运营事件日志 | ✅ | `admin/logs`（op_events 检索，docs/16） |
| 告警通知配置 | ⚠️ 有缺陷 | `admin/notify` 存在；但 GET API 直接回显完整 Webhook Secret（P0），违反边界规范 |
| 管理员高风险操作审计 | ⚠️ 不可靠 | 退款/调账/定价/密钥等操作有审计记录；但 `op_events` 为 fire-and-forget，可能丢失 |
| 系统设置 | 🚧 规划中 | P3 规划（见 DEVELOPMENT_PLAN 5.4） |

## 十、监控与分析

| 项 | 状态 | 实现位置 |
|----|------|----------|
| PostHog 埋点 | ✅ | `lib/telemetry/*`（服务端 + 客户端） |
| GA4 | ✅ | `components/analytics/google-analytics.tsx` |
| OpenPanel | ✅ | `components/analytics/open-panel.tsx` |
| 错误监控 | ✅ 已实现 | PostHog 错误追踪（`lib/telemetry/server.ts`） |
| 会话回放 | ✅ 已实现 | PostHog `session_recording`（遮罩输入） |
| 关键事件持久化 | ⚠️ 不可靠 | `op_events` 存在但 fire-and-forget；支付/退款/调账等关键事件需 transactional outbox |
| 对账与补偿监控 | ❌ 未完成 | 无渠道-本地每日对账、补偿积压监控、资损告警（P1） |

## 十一、部署

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Vercel | ✅ | `vercel.json` + 文档 |
| Cloudflare | ✅ | `wrangler.toml.example` + `pnpm cf:*` |
| Docker | ✅ | `Dockerfile`（standalone 条件输出） |
| 每日 Cron | ✅ | `vercel.json` crons |
| 环境变量文档 | ✅ | `docs/08-config-env.md` |

> ⚠️ **并发正确性的验收标准（第九轮整块缺失）**：本清单里一条并发测试都没有，这正是 P0-2（`decrease_credits`「行锁串行化」）
> 能被标成 ✅ 的原因。`decrease_credits` / `increment_anonymous_usage` / 幂等键 / 迁移并发都应补并发回归测试进 CI：
> 断言余额恒 ≥ 0 且成功次数 = `floor(余额 / 单价)`；匿名额度并发递增不超过每日上限；同幂等键并发只执行一次。

---

## 建议后续补充（不阻塞当前版本）

| 项 | 优先级 | 说明 |
|----|--------|------|
| 后台系统设置页面 | P3 | 全局配置（站点名 / SEO / 支付开关）可视化 |
| 数据导出（用户维度） | P3 | 当前仅订单 CSV |
| 2FA / TOTP | P3 | 账号安全增强，适合工具型 SaaS |
| Feature Flags | P3 | 灰度发布能力（PostHog 已具备基础能力） |
| 维护模式 | P3 | 数据库宕机时展示维护页 |
| Webhook 事件日志 | P3 | 排查支付回调问题 |
| 邮件送达率监控 | P3 | Resend Webhook 事件回调 |
| 多区域部署 | P4 | 当前单区域（Vercel 自动） |
| 品牌化（logo / favicon 系统） | P4 | 当前沿用 ShipAny 默认资源 |

---

*此清单与 `DEVELOPMENT_PLAN.md` 同步维护。*

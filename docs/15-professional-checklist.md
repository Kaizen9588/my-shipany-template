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
> ✅ **整体结论（2026-09-05 收口更新）**：模板骨架完整度高；历史资金/权限 No-Go
> （P0-1~P0-4、N-1~N-15，迁移 0020~0036）已全部关闭。剩余为非阻断项：
> 错误监控接入、CSP 头、OAuth Account Linking、邮件 v2、部分运营配置。
> 逐项见下表 ⚠️/❌ 行与 [IMPLEMENTATION-HANDOFF §4](./IMPLEMENTATION-HANDOFF-2026-08-30.md)。

---

## 一、基础工程化

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 包管理 | ✅ | pnpm 11 + `pnpm-workspace.yaml`（allowBuilds 已配置） |
| TypeScript 严格模式 | ✅ | `tsconfig.json` strict: true |
| 代码检查 | ✅ | ESLint 9 flat config（`eslint.config.mjs`），`pnpm lint` 0 error |
| 单元测试 | ✅ | Vitest 61 文件 / 397 用例，`pnpm test`（数字随测试演进，以实际输出为准） |
| 生产构建 | ✅ | `pnpm build` 通过 |
| CI/CD | ✅ | `.github/workflows/ci.yml`（typecheck + lint + test + build） |
| 数据库迁移 | ✅ | `data/migrations/*.sql`：advisory lock + 同事务回滚 + 启动 fail-fast 只校验；`pnpm migrate:concurrent` 非事务入口 + expand-contract 模板（N-11 关闭）；启动仅 verifyMigrations |
| 环境变量校验 | ✅ | `lib/env.ts`，启动时 fail-fast |
| 健康检查 | ✅ | `GET /api/health` |
| 日志 | ⚠️ | `lib/logger.ts` 统一封装已存在；接线推进中（checkout 失败分支、三渠道 webhook 验签/处理失败已接，其余错误路径仍为裸 console） |

## 二、安全

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 安全响应头 | ✅ | `next.config.mjs` headers（X-Frame-Options / no sniff / Referrer / Permissions / COOP） |
| CSRF 防护 | ✅ | `middleware.ts` Origin 校验（webhook/cron 豁免精确化 + WEB_URL 钉死 + 生产 http 降级拒绝，第十九批加固；矩阵见 docs/02） |
| CORS 白名单 | ✅ | `middleware.ts` + `CORS_ALLOWED_ORIGINS` |
| 密码哈希 | ✅ | bcrypt（`lib/password.ts`） |
| 默认管理员弱口令 | ✅ | 0027 口径：公开初始凭据（`admin@shipany.local`）仅 `pending_activation` + `must_change_password`，登录强制改密、改密前 `requireAdmin` 全量拦截（P0-3 关闭） |
| 登录失败锁定 | ✅ | `lib/login-guard.ts`（邮箱 5 次 / IP 10 次） |
| 登录限流 | ✅ | `lib/ratelimit.ts`（Upstash / 内存降级） |
| API Key 哈希存储 | ✅ | `lib/hash.ts` + `models/apikey.ts`（只存 SHA-256） |
| Snowflake 唯一 ID | ✅ | `lib/hash.ts` workerId 单例 |
| 支付金额服务端校验 | ✅ | 运行时权威 = `payment_products` 表（`data/pricing.ts` 仅种子/回退，P1-8 关闭）；webhook 金额/币种精确比对（0010）+ 写入路径不变量校验 + 0033 事务化批量写入 + 审批双人复核 |
| 积分原子扣减 | ✅ | 0020 用户级 advisory lock + 0026 批次 FIFO `UPDATE ... WHERE remaining >= x` 行级原子；真库并发回归 4/4（P0-2 关闭） |
| Webhook 验签 | ✅ | Stripe / Creem / Waffo 适配器验签；事件 inbox/幂等/重放/对账见 §五（0031） |
| 图片域名白名单 | ✅ 已实现 | `next.config.mjs` images.remotePatterns |
| 资金 RPC 权限边界 | ✅ | 五个资金函数迁 `private` schema + REVOKE/仅授 service_role + `SET search_path`（0023）；调用点 `serverClient().schema("private")`；静态断言 CI 兜底 |
| 数据库 RLS | ✅ | public 全部业务表 RLS deny-all + REVOKE anon/authenticated（0024，19/19 连库验证）；serverClient/userClient 显式分离（N-3） |
| 限流 fail-closed | ✅ | 未配置/超时回落内存日窗口（N-5）；Upstash SDK timeout 回落 + prefix 按环境隔离（§1.30）；未配 Upstash 时为单实例内存限流（部署注意项） |

## 三、数据库与数据

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Schema 文档 | ✅ | `docs/03-database-schema.md` |
| 表结构 | ✅ | users / orders / credits / apikeys / posts / affiliates / 多渠道表 |
| 索引 | ✅ | 迁移 `0004_fk_indexes.sql` |
| 备份 | ✅ | `lib/backup.ts` + Vercel Cron；S3 上传强制 SSE（AES256/KMS）；users 字段白名单脱敏；保留周期与月度恢复演练口径成文 docs/07 §2.4.1 |
| 幂等支付处理 | ✅ | `handle_order_payment` 状态幂等 + `payment_events` inbox（UNIQUE(provider, provider_event_id)）+ cron 重放 + 三规则对账（0031） |
| 积分批次账本 | ✅ | `credit_lots` + `credit_consumptions`（0026）：发放建批次、扣减批次 FIFO、退款精确回收、审计可追溯 |

## 四、认证与用户

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Google / GitHub OAuth | ✅ | `auth/config.ts` |
| Google One-Tap | ✅ | `hooks/useOneTapLogin.tsx` |
| 邮箱密码登录 | ✅ | `app/api/verify-code` + `components/sign/email-form.tsx` |
| 邮箱验证码 | ✅ | 仅存 SHA-256 哈希 + 原子消费；0025 列宽修复 + `consumeVerificationCode` 补 `count: "exact"` 后端到端复测通过 |
| 密码重置 | ✅ | 同验证码链路（0025 修复后端到端复测通过） |
| RBAC | ✅ 已实现 | `lib/auth.ts` + users.role 三级（operator/admin/super_admin） |
| 账号删除（GDPR） | ✅ 基本完成（2026-09-01） | 软删除 + 凭据擦除 + API Key 撤销 + 日志匿名化（0035 RPC）+ PostHog `$delete_person` 联动；数据导出/删除冷静期为产品项待排期 |
| 会话 / JWT | ✅ | NextAuth v5；jwt 回调每次会话校验从库刷新 role/status/must_change_password（封禁即时生效），`getUserUuid()`/`getAdminUser()` 双拦截非 active 会话 |
| OAuth Account Linking | ❌ 未完成 | 同邮箱多 provider 不合并，可能拆散积分与订单（P1） |

## 五、支付（Provider 抽象）

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Stripe | ✅ | `lib/payment/providers/stripe.ts` |
| Creem（MoR） | ✅ | `lib/payment/providers/creem.ts` |
| Waffo（MoR+PSP） | ✅ | `lib/payment/providers/waffo.ts` |
| 渠道热切换 | ✅ | `payment_settings` 表 |
| 健康检测 failover | ✅ | `lib/payment/health.ts` |
| 退款 | ✅ 已闭环（2026-09-01 核实口径） | refunds 表 + 幂等登记（0022）+ 按订单 credit_lots 批次精确回收（0026）+ 债务化/回收工作台（0021）；每日对账（0031）。部分退款积分回收口径：回收量 = 订单批次 remaining（非按退款金额比例拆分，金额比例拆分留 v2 多次退款需求出现时再评估） |
| 订阅 | ⚠️ | 代码存在，v1 不启用（见 DEVELOPMENT_PLAN 5.3） |
| 支付事件 inbox / 对账 | ✅ | `payment_events` inbox（0031）：原始 payload 存档 + 幂等键 + cron 重放 + 三规则对账 + reconcile_anomaly 告警走 outbox |
| 远端成功本地失败补偿 | ✅ | inbox pending 留存 + 渠道重试 + cron 有界重放双路兜底；对账规则一（漏单嫌疑）事后发现（0031） |
| ~~退款对已消费积分无回收路径~~ | ✅ 已关闭 | 退款准入校验（批次 remaining）+ 债务化（credit_debts）+ refund_blocked + 回收工作台全链路落地（P0-1，0021/0022/0026） |
| 争议/拒付链路 | ✅ | `dispute_opened/won/lost` 归一化 + 订单冻结/解冻/charged_back + 账号 restricted + 佣金冲销（0028）；Waffo 无 dispute webhook 为已知边界 |

## 六、AI 能力

| 项 | 状态 | 实现位置 |
|----|------|----------|
| AI SDK 统一入口 | ✅ | `lib/ai/registry.ts` + `app/api/v1/ai/generate` |
| 模型白名单 | ✅ | `data/model-pricing.ts` |
| 多供应商数据边界声明 | ✅ | `data/model-pricing.ts` PROVIDER_DATA_BOUNDARY（决策 3.1）；新增 provider 时必填，年度复核一次（trainsOnInputs 未核实必须 "unknown"） |
| 计入扣费 | ✅ | `estimateCredits`（CJK 加权）预估一次扣清 + `ai_requests` 状态机幂等（0032）+ 输入硬限制 |
| 失败退款 | ✅ | 扣费后建 running 行即账；失败条件流转 refund_pending→退款；cron 崩溃补偿（running 超 30 分钟退款，条件更新互斥防双退）（0032） |
| 匿名免费试用 | ✅ | 纯 IP 限流 + 输入 413 照常计次 + 退还仅限无上游费用错误 + 当日失败封顶 + fail-closed 限流（P0-4 关闭）；换 IP 绕过为已知边界 |
| 幂等键 / Idempotency-Key | ✅ | `UNIQUE(user_uuid, request_id)` 按用户隔离 + 请求体指纹 422 + 409/422 路径先退扣费 + 终态条件重占可重跑（0032） |
| 输入大小 / schema 限制 | ✅ | `AI_MAX_PROMPT_BYTES`（默认 32KB）/ `AI_MAX_MESSAGES` 超限 413 + messages 白名单 400，校验在扣费之前 |

## 七、营销与内容

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Landing Page | ✅ | `app/[locale]/(default)` + `i18n/pages/landing/` |
| 定价展示 | ✅ | `components/blocks/pricing` |
| 博客 | ✅ | `app/[locale]/(default)/posts` + Markdown 编辑器 |
| 联盟营销 | ✅ | `services/affiliate.ts` + `models/affiliate.ts`；奖励自动转积分闭环（迁移 0036 方案 A：发放/冲销扣回/通知/邀请页累计积分） |
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
| 订阅管理 | ✅ 已实现（口径统一） | `app/[locale]/(default)/(console)/subscription` 页面存在（状态展示）；订阅功能 v1 不启用，与 §五口径一致（P2-D 收口） |

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
| 告警通知配置 | ✅ | `toNotifyConfigView` 统一出口：GET/RSC 只含 `*_set` 标志 + 末四位掩码，PUT 留空保留现值（N-1 关闭） |
| 管理员高风险操作审计 | ✅ | warn+ 事件走 Transactional Outbox 持久化（0029）+ 5 类高危动作强制审批双人复核（0030）+ 强制理由入库 |
| 系统设置 | 🚧 规划中 | P3 规划（见 DEVELOPMENT_PLAN 5.4） |

## 十、监控与分析

| 项 | 状态 | 实现位置 |
|----|------|----------|
| PostHog 埋点 | ✅ | `lib/telemetry/*`（服务端 + 客户端） |
| GA4 | ✅ | `components/analytics/google-analytics.tsx` |
| OpenPanel | ✅ | `components/analytics/open-panel.tsx` |
| 错误监控 | ❌ 未接入（口径统一） | `lib/telemetry/server.ts` 仅埋点无异常捕获；PostHog Error Tracking / Sentry 接入为真实待办（与 docs/11 §一统一为 ❌，P2-D 收口） |
| 会话回放 | ✅ 已实现 | PostHog `session_recording`（遮罩输入） |
| 关键事件持久化 | ✅ | Transactional Outbox（0029）：warn+ 入队即持久化，投递重试/退避/死信 + 每日 cron 兜底 |
| 对账与补偿监控 | ✅ | 每日三规则对账（漏单/失败积压/金额抽核）→ reconcile_anomaly 告警（0031）；AI 请求崩溃补偿 + 补偿计数（0032） |

## 十一、部署

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Vercel | ✅ | `vercel.json` + 文档 |
| Cloudflare | ✅ | `wrangler.toml.example` + `pnpm cf:*` |
| Docker | ✅ | `Dockerfile`（standalone 条件输出） |
| 每日 Cron | ✅ | `vercel.json` crons |
| 环境变量文档 | ✅ | `docs/08-config-env.md` |

> ✅ **并发正确性的验收标准（第九轮整块缺失）——已补齐（2026-09-01）**：`credit-concurrency.test.ts`
> 真库并发 4/4（5 并发扣 4 恰好 2 成功、空账本并发全败无负流水、负流水 expired_at NULL）；
> `ai-request.test.ts` 15 用例覆盖幂等键并发互斥（条件流转 0 行命中即占用）；迁移并发由 advisory lock + 版本冲突防护覆盖。

---

## 建议后续补充（不阻塞当前版本）

| 项 | 优先级 | 说明 |
|----|--------|------|
| 后台系统设置页面 | P3 | 全局配置（站点名 / SEO / 支付开关）可视化 |
| 数据导出（用户维度） | P3 | 当前仅订单 CSV |
| 2FA / TOTP | P3 | 账号安全增强，适合工具型 SaaS |
| Feature Flags | P3 | 灰度发布能力（PostHog 已具备基础能力） |
| 维护模式 | P3 | 数据库宕机时展示维护页 |
| Webhook 事件日志 | ✅ 基本覆盖 | `payment_events` inbox（0031）存原始 payload + /admin/logs 检索；渠道侧扩展字段以 raw_body 为准 |
| 邮件送达率监控 | P3 | Resend Webhook 事件回调 |
| 多区域部署 | P4 | 当前单区域（Vercel 自动） |
| 品牌化（logo / favicon 系统） | P4 | 当前沿用 ShipAny 默认资源 |

---

*此清单与 `DEVELOPMENT_PLAN.md` 同步维护。*

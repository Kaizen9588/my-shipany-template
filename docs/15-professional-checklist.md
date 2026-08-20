# 专业 SaaS 模板完整度清单

> 本清单用于评估 `my-shipany-template` 作为专业 AI SaaS 通用模板的完整度。
> 每一项列出：状态 / 实现位置 / 说明。未覆盖项为**建议后续补充**（不阻塞当前版本）。

---

## 一、基础工程化 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 包管理 | ✅ | pnpm 11 + `pnpm-workspace.yaml`（allowBuilds 已配置） |
| TypeScript 严格模式 | ✅ | `tsconfig.json` strict: true |
| 代码检查 | ✅ | ESLint 9 flat config（`eslint.config.mjs`），`pnpm lint` 0 error |
| 单元测试 | ✅ | Vitest 43 文件 / 179 用例，`pnpm test`（数字随测试演进，以实际输出为准） |
| 生产构建 | ✅ | `pnpm build` 通过 |
| CI/CD | ✅ | `.github/workflows/ci.yml`（typecheck + lint + test + build） |
| 数据库迁移 | ✅ | `data/migrations/*.sql` + `instrumentation.ts` 自动执行 |
| 环境变量校验 | ✅ | `lib/env.ts`，启动时 fail-fast |
| 健康检查 | ✅ | `GET /api/health` |
| 日志 | ⚠️ | `lib/logger.ts` 统一封装已存在；接线推进中（checkout 失败分支、三渠道 webhook 验签/处理失败已接，其余错误路径仍为裸 console） |

## 二、安全 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| 安全响应头 | ✅ | `next.config.mjs` headers（X-Frame-Options / no sniff / Referrer / Permissions / COOP） |
| CSRF 防护 | ✅ | `middleware.ts` Origin 校验（webhook/cron 豁免） |
| CORS 白名单 | ✅ | `middleware.ts` + `CORS_ALLOWED_ORIGINS` |
| 密码哈希 | ✅ | bcrypt（`lib/password.ts`） |
| 登录失败锁定 | ✅ | `lib/login-guard.ts`（邮箱 5 次 / IP 10 次） |
| 登录限流 | ✅ | `lib/ratelimit.ts`（Upstash / 内存降级） |
| API Key 哈希存储 | ✅ | `lib/hash.ts` + `models/apikey.ts`（只存 SHA-256） |
| Snowflake 唯一 ID | ✅ | `lib/hash.ts` workerId 单例 |
| 支付金额服务端校验 | ✅ | `data/pricing.ts` 单一真相源 |
| 积分原子扣减 | ✅ | `decrease_credits` 存储过程（防透支） |
| Webhook 验签 | ✅ | Stripe / Creem / Waffo 适配器 |
| 图片域名白名单 | ✅ | `next.config.mjs` images.remotePatterns |

## 三、数据库与数据 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Schema 文档 | ✅ | `docs/03-database-schema.md` |
| 表结构 | ✅ | users / orders / credits / apikeys / posts / affiliates / 多渠道表 |
| 索引 | ✅ | 迁移 `0004_fk_indexes.sql` |
| 备份 | ✅ | `lib/backup.ts` + `app/api/cron/daily` + Vercel Cron |
| 幂等支付处理 | ✅ | `handle_order_payment` 存储过程 |

## 四、认证与用户 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Google / GitHub OAuth | ✅ | `auth/config.ts` |
| Google One-Tap | ✅ | `hooks/useOneTapLogin.tsx` |
| 邮箱密码登录 | ✅ | `app/api/verify-code` + `components/sign/email-form.tsx` |
| 邮箱验证码 | ✅ | `models/verification.ts` |
| 密码重置 | ✅ | `app/api/verify-code`（mode=reset） |
| RBAC | ✅ | `lib/auth.ts` + users.role |
| 账号删除（GDPR） | ⚠️ | `app/api/user/delete-account`：软删除 + 匿名化 email，但保留 password_hash/signin_openid/signin_ip（严格 GDPR 口径未达标，见 docs/12 §2.19-②） |
| 会话 / JWT | ✅ | NextAuth v5 |

## 五、支付 ✅（Provider 抽象）

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Stripe | ✅ | `lib/payment/providers/stripe.ts` |
| Creem（MoR） | ✅ | `lib/payment/providers/creem.ts` |
| Waffo（MoR+PSP） | ✅ | `lib/payment/providers/waffo.ts` |
| 渠道热切换 | ✅ | `payment_settings` 表 |
| 健康检测 failover | ✅ | `lib/payment/health.ts` |
| 退款 | ✅ | `services/refund.ts`（Stripe/Waffo 自动，Creem Webhook） |
| 订阅 | ⚠️ | 代码存在，v1 不启用（见 DEVELOPMENT_PLAN 5.3） |

## 六、AI 能力 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| AI SDK 统一入口 | ✅ | `lib/ai/registry.ts` + `app/api/v1/ai/generate` |
| 模型白名单 | ✅ | `data/model-pricing.ts` |
| 计入扣费 | ✅ | `estimateCredits` 预估一次扣清 |
| 失败退款 | ✅ | `ai_refund` 事务类型 |
| 匿名免费试用 | ✅ | `app/api/v1/ai/demo` + 设备指纹 + IP 限流 |

## 七、营销与内容 ✅

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

## 八、用户控制台 ✅

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

## 九、后台管理 ✅

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
| 告警通知配置 | ✅ | `admin/notify`（飞书/企微 webhook，docs/16） |
| 系统设置 | ⬜ | P3 规划（见 DEVELOPMENT_PLAN 5.4） |

## 十、监控与分析 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| PostHog 埋点 | ✅ | `lib/telemetry/*`（服务端 + 客户端） |
| GA4 | ✅ | `components/analytics/google-analytics.tsx` |
| OpenPanel | ✅ | `components/analytics/open-panel.tsx` |
| 错误监控 | ✅ | PostHog 错误追踪（`lib/telemetry/server.ts`） |
| 会话回放 | ✅ | PostHog `session_recording`（遮罩输入） |

## 十一、部署 ✅

| 项 | 状态 | 实现位置 |
|----|------|----------|
| Vercel | ✅ | `vercel.json` + 文档 |
| Cloudflare | ✅ | `wrangler.toml.example` + `pnpm cf:*` |
| Docker | ✅ | `Dockerfile`（standalone 条件输出） |
| 每日 Cron | ✅ | `vercel.json` crons |
| 环境变量文档 | ✅ | `docs/08-config-env.md` |

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

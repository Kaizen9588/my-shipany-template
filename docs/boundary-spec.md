# 项目边界规范（Boundary Spec）

> 本文档约束本项目在**提交、密钥、API/业务、代码工程、Git 工作流**上的边界。
> 目标：模板在给他人使用/开源时，不泄露密钥、不出现越权与资金风险、保持工程一致性。
>
> 状态标记：✅ 已在项目落地｜🚧 已列为待办/建议补充｜⬜ 尚未在代码中强制

---

## 一、Git 提交边界（禁止提交 / Push 前必查）

| 规则 | 状态 | 说明 |
|---|---|---|
| 禁止提交 `.env`、`.env.local`、`.env.development`、`.env.production` | ✅ `.gitignore` | 本地真实密钥都在这些文件里 |
| 只允许提交 `.env.example`，且必须全部是空占位符 | ✅ | 例如 `AUTH_SECRET = ""`，不允许放“真实格式”的示例值 |
| 禁止提交任何真实密钥/令牌 | ✅ 已约定 + push 前扫描 | `sk-*`、`AKIA*`、`ghp_*`、RSA/OPENSSH 私钥、webhook secret、JWT secret、真实 Supabase key 等一律不进仓库 |
| 禁止提交 `.pnpm-store/`、`node_modules/`、`.next/`、覆盖测试产物 | ✅ `.gitignore` | 依赖缓存/构建产物/coverage 不应进入 Git 历史 |
| 禁止提交 `.agents/`、`skills-lock.json`、`.supabase-home/`、wrangler 缓存 | ✅ `.gitignore` | 本机/个人环境文件不属于模板本体 |
| Docker 构建镜像不得包含 `.env*` | ✅ `.dockerignore` 已排除 `.env`/`.env.*`（保留 `.env.example`） |
| Push 前必须先自查 staged diff | ✅ 本次已执行 | `git diff --cached` 扫描 `sk-*` / `AKIA*` / 私钥块 / 真实 `password=` 等；并确认 `.env.local` 不在 `git status` |

---

## 二、密钥与敏感数据安全边界

| 规则 | 状态 |
|---|---|
| `.env.*` 只给服务端读；`NEXT_PUBLIC_*` 只放公开数据（URL、开关、分析 ID） | ✅ docs/12 §61（docs/12 已删除，见 [ADVERSARIAL-REVIEW-2026-08-26.md](./ADVERSARIAL-REVIEW-2026-08-26.md)） |
| API 返回给客户端禁止带 `password_hash`、`password_updated_at`、`signin_ip`、`signin_openid`、OAuth token、支付密钥 | ✅ `toSafeUser()` 白名单出口 |
| 用户 API Key 存 SHA-256 hash，创建时只展示一次明文 | ✅ 已落地 |
| 邮箱验证码不应明文存库；应存 hash 并定期清理过期记录 | ✅ 已落地（仅存 SHA-256 hash + 原子消费，`cleanupVerificationCodes` 挂 cron） |
| `AUTH_SECRET` 必须由部署者自己生成，禁止共用默认示例值 | ✅ `.env.example` 已置空 + 文档说明 |
| 数据库迁移不能写真实生产密钥；默认管理员 `123456` 仅作模板初始化并要求首次强制改密 | ❌ No-Go（P0-3） | **第九轮：迁移 0012 无条件创建 `admin@shipany.local/123456/super_admin`，「首次强制改密」只是登录后跳转，账号在迁移执行完即可用公开凭据登录，谁先登谁改密；生产冷启动即把公开弱口令种进生产库（CWE-1392）。** 需条件建号 + 随机密码 + pending_activation + 生产不建号，README 删逐字凭据。 |
| 告警 webhook 可存 `system_settings`，但页面不回显完整 secret | ⚠️ API 层未脱敏（P0） | **当前 API 直接返回完整配置（`models/notify.ts` 中 `return respData({ ...config })`），与本规范冲突。GET 必须只返回 `has_secret`、掩码末四位；只支持替换/清空，不明文回显。** 见第九节「待关闭的边界缺口」。 |

---

## 三、API / 业务边界（越权与资金风险）

| 边界 | 状态 |
|---|---|
| 后台必须是管理员才能访问，非管理员一律 403 | ✅ `requireAdmin()` |
| 管理员分级：operator/admin/super_admin；operator 不能自我提权、不能授 super_admin | ✅ `requireAdmin(level)` + `hasAdminLevel`（lib/auth.ts） |
| 被封禁的管理员不能继续操作后台 | ✅ 已落地（status≠active 实时查库拦截） |
| 支付金额/定价只信服务端，客户端传的价格一律忽略 | ⚠️ 定价真相源矛盾（P1-8） | checkout 只收 product_id；但「价格以 `payment_products` 表优先、`data/pricing.ts` 为回退」与 `docs/05:27`/`docs/15:45` 宣称 `data/pricing.ts` 是「单一真相源」互相矛盾。需先钉死真相源，再重定级管理员定价写入风险。 |
| 支付回调必须验签；金额/币种必须比对，不匹配不充值并告警 | ✅ 已落地 |
| 积分扣减必须事务 + 行锁 + 余额校验，不能透支 | ⚠️ ❌ No-Go（P0-2） | **第九轮：「行锁串行化」论证不成立**——INSERT 负数流水 + `FOR UPDATE` 只锁已存在行，append-only 账本上不等价于串行化（DB 层的 check-then-write）。需 advisory lock 或迁 credit_lots 后 `UPDATE ... WHERE remaining >= x`，并发回归测试进 CI。 |
| **资金 RPC 必须在数据库层有强制权限边界** | ⚠️ ❌ No-Go（P0） | **三个资金函数（decrease_credits / handle_order_payment / process_order_refund）位于 public schema，迁移未显式 REVOKE/GRANT。在 Supabase 默认配置下，anon/authenticated 可能直接调用。** 必须移到 private schema，仅授权 service_role 执行，并启用 RLS。 |
| **管理员高风险操作必须审计持久化 + 最小权限** | ⚠️ 部分 | 退款、调账、定价、通知密钥、用户角色、封禁应有：CSRF 防护、二次确认、理由、前后值、操作者、审批。`op_events` 当前为 fire-and-forget，不能作为"全量不能丢"的唯一实现。 |
| 退款必须幂等，不能重复扣回积分 | ✅ 已落地 |
| Webhook 签名非法应告警 | ✅ 已接入：三个 notify 路由验签失败发射 `payment.webhook_invalid_signature`（critical） |
| AI 网关：鉴权 → 限流 → 402 → 原子扣费 → 失败退款 | ⚠️ 部分落地 | 缺少幂等键、状态机和崩溃补偿（P0），真实收费前必须完成；失败退款只在进程内存中执行 |
| 服务端与客户端数据库 client 必须分离 | ⚠️ ❌ No-Go（P0） | `models/db.ts` 在同一客户端中按环境变量切换 service_role。终端用户路径应走 anon/authenticated + RLS，service_role 仅限受控服务端路径。 |
| 匿名试用限流 | ✅ 纯 IP 维度（指纹方案因 `x-device-id` 可伪造已废弃，见 docs/14 修订）；换 IP 可绕过为已知边界 |
| CORS 白名单、CSRF、安全响应头 | ✅ 已落地 |
| CSP / HSTS | ⚠️ 部分：HSTS 已落地（next.config.mjs headers）；CSP 仍待办（docs/12 已删除，见 [ADVERSARIAL-REVIEW-2026-08-26.md](./ADVERSARIAL-REVIEW-2026-08-26.md) §2.18） |
| 迟到支付回调撞上 expired 订单不得丢账 | ✅ 迁移 0017：expired 订单可被 webhook 恢复为 paid（留审计痕迹） |

---

## 四、代码 / 工程规范边界

| 边界 | 说明 |
|---|---|
| 本地 Next.js 统一 `3000` 端口 | 端口冲突时杀掉占用进程，不换端口 |
| 数据库迁移必须幂等，写在 `data/migrations/*.sql` | 不手工改生产库；重复执行安全 |
| 迁移/配置文件修改尽量“追加不覆盖” | 文档与配置类更新只增内容，不整文件覆盖 |
| 后台管理页面统一直用中文；前台默认英文 | 后台仅给管理员使用 |
| 通知链路必须 fire-and-forget，失败不能阻塞业务主流程 | ✅ |
| 新增支付渠道：写 adapter + registry 注册，不动核心 checkout/webhook 逻辑 | ✅ |
| 高风险端点限流缺失时必须 fail-closed | ⚠️ 待加固 | `lib/ratelimit.ts` 在未配置 Upstash 时返回 `{ ok: true }`（fail-open）。AI 生成、验证码、支付创建、webhook 等高成本/高风险端点，生产环境缺少可靠限流时应明确失败，不能静默放行。 |
| Webhook 必须有 body size 限制 + 速率限制 | ⚠️ 待加固 | 非法签名请求可能造成日志/告警 DoS。需限制 body 大小（如 64KB）、IP 维度限流，验签失败快速拒绝不打 full alert。 |
| `NEXT_PUBLIC_*` 数量克制，服务端 secret 不进客户端 bundle | ✅ |
| 单测、`tsc`、`pnpm build`、lint 通过后才能提交 | ✅ 当前 43 文件 / 179 用例（数字随测试演进，以 `pnpm test` 实际输出为准） |
| 改 Next.js 相关代码前先读 `node_modules/next/dist/docs/` | ✅ AGENTS.md |

---

## 九、待关闭的边界缺口（生产 No-Go 清单）

> 第八轮审查识别的、与本规范直接冲突的缺口。按 P0 级处理，真实收费前必须全部关闭。
> （第九轮注：本文章节编号为「一二三四九五」，缺六七八，且缺六七八对应的内容；编号错位本身是 P3-1 中「悬空文档引用」的同源问题。）

| # | 缺口 | 所在模块 | 风险 | 整改要求 |
|---|------|----------|------|----------|
| N-1 | 通知配置 API 回显完整 Webhook Secret | `app/api/admin/notify-settings` / `models/notify.ts` | 低权限管理员会话、抓包、日志系统都可能拿到密钥；可伪造告警、污染运营 | GET 只返回 `has_secret` + 掩码末四位；PUT 只支持替换/清空；读取仅限 server-side 发送模块；操作审计 |
| N-2 | 资金 RPC 无数据库层权限边界 | `data/migrations/` 0002/0010/0011 | anon/authenticated 可能直接调用充值/扣费/退款函数 | 移入 private schema；REVOKE PUBLIC；仅授权 service_role；RLS 启用；CI 断言权限 |
| N-3 | 服务端/客户端 client 不分离 | `models/db.ts` | 服务端 key 可能泄露到客户端路径；RLS 形同虚设 | 显式 `serverClient` 与 `userClient`；userClient 永不使用 service_role |
| N-4 | `op_events` fire-and-forget 丢失 | `lib/oplog.ts` | 支付、退款、调账等关键审计事件可能丢失，无法事后追溯 | 使用 transactional outbox；事件有唯一 id、重试次数、最后错误；通知失败不丢事件 |
| N-5 | 限流 fail-open | `lib/ratelimit.ts` | 多实例或 Upstash 未配置时，高成本端点无任何保护 | 高成本端点在无分布式限流时 fail-closed；或生产启动校验关键依赖 |
| N-6 | 管理员高风险操作无二次确认与审批 | 后台管理 | 误操作、被盗号可造成重大资金损失 | 退款/调账/定价/密钥/角色/封禁需理由、二次确认、审批、审计持久化 |
| N-7 | 默认管理员弱口令（P0-3） | 迁移 0012 / README | 生产冷启动即种入公开 `admin@shipany.local/123456/super_admin`，谁先登谁改密 | 条件建号 + 随机密码 + pending_activation + 生产不建号；README 删逐字凭据 |
| N-8 | `decrease_credits` 行锁串行化论证不成立（P0-2） | `data/migrations/0002` | 并发扣减可能双花/透支，资金资损且运营侧不可见 | advisory lock 或迁 credit_lots 后 UPDATE 原子扣减；并发回归测试进 CI |
| N-9 | 匿名 demo 失败退还 + 无输入限制可绕过每日次数（P0-4） | `/api/v1/ai/demo` | 单 IP 100% 失败并退还次数，不换 IP 无限调用 | 扣次数前输入硬校验（413 且照常计次）+ 退还仅限无费用错误 + fail-closed IP 限流 |
| N-10 | 退款对已消费积分无回收路径（P0-1） | `process_order_refund` | 全额退款 + 已消费积分 = 白嫖成立 | 退款准入校验 + 债务化（credit_debts）+ refund_requested/refund_blocked 人工态 |
| N-11 | 迁移无并发锁/事务/回滚/发布顺序（P1-7） | `lib/migrate.ts` | 多实例同秒启动撞 `tuple concurrently updated` | advisory_xact_lock + 同事务 + fail-fast + CONCURRENTLY + expand-contract |
| N-12 | 建库路径三处并存（P1-6） | `docs/07` / install.sql | 首次启动 `relation already exists` 崩溃 | 统一为「空库只跑 migrations」；install.sql 入 legacy；基线断言 fail-fast |
| N-13 | 争议/拒付链路缺失（P2-2） | PaymentEventType / orders.status | 收到 dispute 事件无处归一化，已消费积分不追回、账号不冻结 | PaymentEventType 加 3 类争议事件 + orders 加 disputed/charged_back + 冻结消费 + 复用 N-10 回收路径 |

---

## 五、提交 / Git 工作流边界

| 规则 | 说明 |
|---|---|
| Push 前先 `git status` + 扫 staged diff，确认没有 `.env.local` 和真实密钥 | 核心红线 |
| 分支默认前缀 `codex/`（除非用户指定其他命名） | 便于区分模板主干与临时工作 |
| GitHub 仓库默认私有（除非用户明确要求公开） | `gh repo create` 使用 `--private` |
| commit message 带上模块与意图，例如 `feat(admin): ...` | 便于回滚与排查 |
| 外网不通时，GitHub 相关操作用本地代理 `127.0.0.1:12334` 重试 | 默认先直连，直连超时再走代理 |

---

## 附：Push 前最小自查命令

```bash
# 1. 确认没有真实环境文件被跟踪
git ls-files | grep -E '(^|/)\.env'           # 输出应只有 .env.example

# 2. 确认 .env.local 仍被忽略
git check-ignore .env.local

# 3. 扫描 staged diff 中的疑似密钥
git diff --cached | grep -nE \
  '(sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----|secret=.+|password=.+[^a-z_])' \
  || echo "no candidate leaks"

# 4. 确认工作区状态
git status --short
```

> 若扫描到疑似密钥，不要尝试“小修复后继续提交”，应先判断是否已进 Git 历史；已进历史需用 filter-repo/BFG 处理后再继续。

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
| 数据库迁移不能写真实生产密钥；默认管理员凭据边界 | ✅ P0-3 已关闭（2026-09-02 调整口径） | 0012 只添加字段且绝不建号；0019 禁用历史固定 hash 默认账号；0027 恢复内置默认管理员 `admin@shipany.local`（初始密码 `123456`，**仅 bcrypt 哈希入库，明文不进迁移/代码**），必须 `pending_activation` + `must_change_password`，改密前 `requireAdmin` 拒绝一切后台 API——公开初始凭据只能进一次性强制改密流程。另保留 `ADMIN_BOOTSTRAP_EMAIL` 显式一次性引导（密码配置提供或随机生成后只写受限启动日志）。生产不用默认管理员时按 0027 注释删除/禁用。 |
| 告警 webhook 可存 `system_settings`，但页面不回显完整 secret | ✅ 已关闭（2026-08-30，N-1） | GET 与后台页面 RSC payload 只含 `*_set` 标志 + `****末四位`（`toNotifyConfigView` 统一出口）；PUT 留空即保留现值、显式 `null` 才清空、掩码占位串被忽略。见 §九 N-1。 |

---

## 三、API / 业务边界（越权与资金风险）

| 边界 | 状态 |
|---|---|
| 后台必须是管理员才能访问，非管理员一律 403 | ✅ `requireAdmin()` |
| 管理员分级：operator/admin/super_admin；operator 不能自我提权、不能授 super_admin | ✅ `requireAdmin(level)` + `hasAdminLevel`（lib/auth.ts） |
| 被封禁的管理员不能继续操作后台 | ✅ 已落地（status≠active 实时查库拦截） |
| 支付金额/定价只信服务端，客户端传的价格一律忽略 | ✅ 已钉死真相源（2026-08-30） | checkout 只收 product_id；运行时权威源 = `payment_products` 表，`data/pricing.ts` 仅初始化种子/回退。写入路径已加不变量校验（金额/积分/有效期上限、币种仅 USD、积分≤金额），见 `docs/05` §1.2 落地块 + `app/api/admin/payment-products/route.ts`。 |
| 支付回调必须验签；金额/币种必须比对，不匹配不充值并告警 | ✅ 已落地 |
| 积分扣减必须事务 + 行锁 + 余额校验，不能透支 | ✅ 已关闭（2026-09-01，迁移 0020+0026） | 双保险：用户级事务 advisory lock（0020）+ 批次 FIFO `UPDATE ... WHERE remaining_credits >= x` 行级原子（0026）；真库并发回归 4/4（`credit-concurrency.test.ts`）。 |
| **资金 RPC 必须在数据库层有强制权限边界** | ✅ 已关闭（2026-09-01，迁移 0023+0024） | 五个资金函数（decrease_credits / handle_order_payment / process_order_refund / debt_regulate_order_refund / register_order_refund_request）迁 `private` schema + `SET search_path` 防劫持；REVOKE PUBLIC/anon/authenticated、仅授 service_role；`credits/orders/refunds/credit_debts` RLS deny-all（service_role bypassrls 读写）；调用点 `serverClient().schema("private")`；**Dashboard → API → Exposed schemas 加 `private`（手动步骤，已执行）**；连库验证 anon 三层被拒、应用通路 5/5 可达、并发 4/4。public 其余业务表 RLS 已随 0024 全量收口（见下条）。 |
| **public 全部业务表 RLS + 表权限双层收口** | ✅ 已关闭（2026-09-01，迁移 0024） | public 全部 19 张业务表 ENABLE RLS（deny-all，无 policy=anon/authenticated 全拒）+ REVOKE anon/authenticated 全部表特权（0023 资金四表一并补 REVOKE）；anonymous_usage 两 RPC `SET search_path` 钉死 + 仅授 service_role——public schema 从此无 anon 可读/可调对象。设计依据：应用无 anon key/浏览器直连路径（userClient 零调用、无 createBrowserClient），不用 Supabase Auth（NextAuth 自管 JWT），运行时恒 service_role bypassrls；未来接 Supabase Auth/anon 直连必须先显式设计自访策略（fail-loud）。连库验证：19/19 RLS 开启、anon 权限归零、PostgREST anon 直查全 401、应用关键路径回归通过。附带修复：0025 verification_codes.code 列宽（SHA-256 存不进 VARCHAR(10)，注册/重置全挂）+ consumeVerificationCode update 未传 `{ count: "exact" }`（恒 false）。 |
| **管理员高风险操作必须审计持久化 + 最小权限** | ✅ 已关闭 | 退款、调账、定价、用户角色、封禁已有：最小权限（operator/admin/super_admin 分级）+ 服务端强制理由（N-6，`lib/admin-reason.ts`）+ reason 入 `audit_logs.detail`；`op_events` 持久化已闭合（N-4 outbox，0029）；审批队列/双人复核已闭合（0030：5 类高危动作落 `admin_approvals` 审批单，发起人≠批准人硬校验，批准即执行、失败可重试；**双人复核保护要求部署 ≥2 个活跃管理员**，单管理员部署自动降级为批准留痕——生产部署必须配置至少两个管理员账号）。CSRF 防护已闭合（第十九批：middleware Origin 校验加固 + 豁免精确化 + 防护矩阵成文，见 docs/02 §认证机制）。 |
| 退款必须幂等，不能重复扣回积分 | ✅ 已落地；0026 升级为按订单 credit_lots 批次 remaining 精确回收（此前近似口径 min(订单积分, 余额) 可被「先消费再退款」稀释） |
| Webhook 签名非法应告警 | ✅ 已接入：三个 notify 路由验签失败发射 `payment.webhook_invalid_signature`（critical） |
| AI 网关：鉴权 → 限流 → 402 → 原子扣费 → 失败退款 | ✅ 已关闭（2026-09-01，N-15/迁移 0032） | `ai_requests` 状态机 + `UNIQUE(user_uuid, request_id)` 按用户隔离幂等 + cron 崩溃补偿（running 超 30 分钟退款 / refund_pending 重试，条件更新互斥防双退）；输入硬限制 413/白名单 400 在扣费之前。见 §九 N-15 与 docs/13 §七。 |
| 服务端与客户端数据库 client 必须分离 | ✅ 已关闭（2026-08-30，N-3） | `models/db.ts` 拆出显式 `serverClient()`（service_role，仅受控服务端路径）/ `userClient()`（anon，走 RLS）；资金/支付/退款/后台统计已切 `serverClient()`。剩余兼容入口调用点待 RLS 策略完备后迁移（0024 已 deny-all，运行时恒 service_role，非阻断）。 |
| 匿名试用限流 | ✅ 纯 IP 维度（指纹方案因 `x-device-id` 可伪造已废弃，见 docs/14 修订）；换 IP 可绕过为已知边界 |
| CORS 白名单、CSRF、安全响应头 | ✅ 已落地（第十九批收口 P3-4）：middleware Origin 校验——允许集合 = `NEXT_PUBLIC_WEB_URL` 钉死 ∪ 同源 Host ∪ `CORS_ALLOWED_ORIGINS`；缺失 Origin 放行（curl/SDK/Bearer 无 cookie CSRF 面）；生产 https 站点拒绝 http 降级 origin；豁免精确化（`/api/cron/*` + `/api/*-notify` 后缀，防子串意外命中）；`/api/v1/*` 防护矩阵成文（docs/02 §认证机制）；测试 `__tests__/middleware-csrf.test.ts` 10 用例 |
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
| 通知链路必须 fire-and-forget，失败不能阻塞业务主流程 | ✅ 已关闭（2026-09-02）：「不阻塞」已落地；副作用统一挂 Next.js `after()`（`runAfterResponse`，第七批）；关键事件持久化经 Transactional Outbox（N-4，0029）——warn+ 入队、投递重试、告警外呼移到持久化成功之后。N-4 管「落库不丢」，after() 管「有没有开始跑」，均已关闭 |
| 新增支付渠道：写 adapter + registry 注册，不动核心 checkout/webhook 逻辑 | ✅ |
| 高风险端点限流缺失时必须 fail-closed | ✅ 已加固（2026-08-30，N-5） | AI 生成、验证码、支付创建、webhook 现已全部 fail-closed：`rateLimit`/`rateLimitUser` 无 Upstash 时内存兜底，checkout 加 per-IP/per-user 限流，见 N-5 行。 |
| Webhook 必须有 body size 限制 + 速率限制 | ⚠️ 部分加固（2026-08-30） | body 64KB 上限已落地（`lib/webhook-guard.ts`，三 notify 路由接入）。**速率限制刻意不做**：webhook 来源是渠道服务器，默认 `TRUSTED_PROXY=none` 下 getClientIp 恒回 127.0.0.1（所有渠道共一个桶），限流会在高峰拒收真实支付事件——漏收一次支付事件比日志轰炸严重，见 `lib/webhook-guard.ts` 注释。验签失败路径已克制告警（见 docs/16 §5.4）。 |
| `NEXT_PUBLIC_*` 数量克制，服务端 secret 不进客户端 bundle | ✅ |
| 单测、`tsc`、`pnpm build`、lint 通过后才能提交 | ✅ 当前 43 文件 / 179 用例（数字随测试演进，以 `pnpm test` 实际输出为准） |
| 改 Next.js 相关代码前先读 `node_modules/next/dist/docs/` | ✅ AGENTS.md |

---

## 九、待关闭的边界缺口（生产 No-Go 清单）

> 第八轮审查识别的、与本规范直接冲突的缺口。按 P0 级处理，真实收费前必须全部关闭。
> （第九轮注：本文章节编号为「一二三四九五」，缺六七八，且缺六七八对应的内容；编号错位本身是 P3-1 中「悬空文档引用」的同源问题。）

| # | 缺口 | 所在模块 | 风险 | 整改要求 |
|---|------|----------|------|----------|
| N-1 | ~~通知配置 API 回显完整 Webhook Secret~~ | `app/api/admin/notify-settings` / `models/notify.ts` | ~~低权限管理员会话、抓包、日志系统都可能拿到密钥~~ | ✅ 已关闭（2026-08-30）：GET 与后台页面 RSC payload 只含 `*_set` 标志 + `****末四位`（`toNotifyConfigView` 统一出口）；PUT 留空即保留现值、显式 null 才清空、掩码占位串被忽略；测试 `__tests__/notify-settings-mask.test.ts` |
| N-2 | 资金 RPC 无数据库层权限边界 | `data/migrations/` 0023/0024 | anon/authenticated 可能直接调用充值/扣费/退款函数 | ✅ 已关闭（2026-09-01 连库）：迁移 0023 五函数迁 `private` + REVOKE/GRANT + 资金 4 表 RLS；6 处调用点 `serverClient().schema("private")`；Dashboard Exposed schemas 加 private；连库验证 anon 三层被拒（public 无函数 / schema permission denied / 未暴露 4xx）、应用 5 RPC 全可达、并发 4/4。0024 补齐资金 4 表 REVOKE（0023 只 ENABLE RLS 未回收 Supabase 默认表特权）并把 public 其余 15 表一并 RLS deny-all + REVOKE。静态断言扩展：调用点必须 `.schema("private")`、0023 内容完备、资金函数不得再建回 public、0024 全表完备、任何迁移不得 GRANT 表权限给 anon/authenticated（`__tests__/db-rbac-static.test.ts`） |
| N-3 | ~~服务端/客户端 client 不分离~~ | `models/db.ts` | ~~服务端 key 可能泄露到客户端路径；RLS 形同虚设~~ | ✅ 已关闭（2026-08-30）：`models/db.ts` 拆出显式 `serverClient()`（service_role，仅受控服务端路径）/ `userClient()`（anon，走 RLS）；资金/支付/退款/后台统计等特权路径已切到 `serverClient()`；`getSupabaseClient()` 保留为兼容入口（语义不变）。静态断言 `__tests__/db-rbac-static.test.ts`。剩余 userClient(anon) 主导的用户端 API（profile/avatar/verify-code 等）仍走兼容入口，待 RLS 策略完备后迁移 |
| N-4 | `op_events` fire-and-forget 丢失 | `lib/oplog.ts` | 支付、退款、调账等关键审计事件可能丢失，无法事后追溯 | ✅ 已关闭（2026-09-02 连库）：迁移 0029 Transactional Outbox——`private.op_event_outbox` 队列 + 六 RPC（enqueue/claim `FOR UPDATE SKIP LOCKED`/deliver 幂等 `ON CONFLICT`/ack/fail 指数退避+死信/cleanup），全部仅授 service_role；`lib/oplog.ts` warn+ 事件入队（入队即持久化，事件有唯一 event_id、重试次数、最后错误），info 维持直插；投递三触发面（内联 + 后续事件顺带 + 每日 cron `/api/cron/daily` 兜底 + 死信清理）；告警外呼移到持久化成功之后。真库 e2e 全链路（入队→投递→幂等→退避→重投→清队）通过。已知边界：入队与业务变更不同事务（旁路记录），极端窗口「业务成功但入队前崩溃」仍可能丢，对账任务（P1）为最后防线 |
| N-5 | 限流 fail-open | `lib/ratelimit.ts` | 多实例或 Upstash 未配置时，高成本端点无任何保护 | ✅ 已关闭（2026-08-30）：①`rateLimitUser` 未配置/抖动时不再 `{ok:true}`，回落内存日窗口（fail-closed）；②checkout 加 per-IP + per-user 限流；③webhook 三路由加 body 64KB 上限（`lib/webhook-guard.ts`）。AI/验证码端点本就 fail-closed。测试：`__tests__/ratelimit.test.ts`（fail-closed 分支）、`__tests__/webhook-guard.test.ts` |
| N-6 | 管理员高风险操作无二次确认与审批 | 后台管理 | 误操作、被盗号可造成重大资金损失 | ✅ 基本关闭（两阶段）：**①服务端强制理由（2026-08-30）**——退款、积分调账、用户角色/封禁、定价、支付渠道、告警密钥统一走 `lib/admin-reason.ts` `parseReason`（trim 后 5~200 字符），reason 写入 `audit_logs.detail`；**②审批队列/双人复核（2026-09-01，迁移 0030）**——5 类高危动作（退款/闭合退款、积分调账、改角色、封禁/解封、渠道+定价双入口）不再原路由执行，落 `private.admin_approvals` 审批单（payload 服务端快照 + reason），由另一位管理员在 `/admin/approvals` 批准即执行（`/api/admin/approvals`）：发起人≠批准人服务端硬校验、批准人须达 required_level、条件更新占用防并发双批、执行失败置 failed 可重试（5 分钟 stale 回收）、执行前重验定价不变量与目标状态；提交/批准/驳回/执行成功/失败全部经 oplog（warn+ 走 outbox 持久化）。告警密钥豁免审批（应急及时性）保留 reason 强制。**单管理员部署自动降级**：无其他活跃管理员时单据自动批准留痕照常执行（不死锁）——**双人复核保护要求生产部署 ≥2 个活跃管理员**。测试：`__tests__/admin-approval.test.ts`（16 用例）+ `db-rbac-static.test.ts` 第十五批。CSRF 防护已闭合（第十九批，middleware 加固 + 防护矩阵成文 docs/02） |
| N-7 | ~~默认管理员弱口令（P0-3）~~ | 0012 / 0019 / 0027 / README | ~~生产冷启动种入公开凭据~~ | ✅ 已关闭（2026-09-02 调整口径）：0012/0019 关闭无条件建号与历史固定 hash；0027 按产品决策恢复默认管理员 `admin@shipany.local` / 初始密码 `123456`——哈希入库（bcrypt 12）、`pending_activation` + `must_change_password`，登录后强制跳 `/change-password`，改密前 `requireAdmin` 全量拦截、改密后自动激活。公开初始凭据不再等于可用后台凭据；另保留 `ADMIN_BOOTSTRAP_EMAIL` 一次性引导 |
| N-8 | ~~`decrease_credits` 行锁串行化论证不成立（P0-2）~~ | `data/migrations/0002` / `0020` | ~~并发扣减可能双花/透支~~ | ✅ 已关闭（2026-09-01 连库应用）：迁移 0020 用户级事务 advisory lock + 0026 批次行级原子；`TEST_DATABASE_URL` 真实并发用例 4/4 通过（`__tests__/credit-concurrency.test.ts`）。 |
| N-9 | ~~匿名 demo 失败退还 + 无输入限制可绕过每日次数（P0-4）~~ | `/api/v1/ai/demo` | ~~单 IP 100% 失败并退还次数，不换 IP 无限调用~~ | ✅ 已关闭（2026-08-30）：字段白名单 + `DEMO_MAX_PROMPT_BYTES` 字节上限（413 照常计次）；退还仅限无上游费用错误（`APICallError` 4xx 计次）；当日失败次数封顶 `DEMO_FAILURE_DAILY_LIMIT`（复用 anonymous_usage，key=`fail:<iphash>`）；分钟级限流走 `rateLimit()` 不 fail-open；测试 `__tests__/ai-demo-guard.test.ts` |
| N-10 | ~~退款对已消费积分无回收路径（P0-1）~~ | `process_order_refund` | ~~全额退款 + 已消费积分 = 白嫖成立~~ | ✅ 已关闭（2026-09-01 连库）：迁移 0026 `credit_lots` 批次账本 + `credit_consumptions` 明细——发放同步建批次、扣减批次 FIFO、退款按订单批次 remaining **精确回收**（过期批次仍计入，防过期套利），缺口自动债务化（0021）；`settle_credit_debt`（0026）+ 回收工作台 `/admin/recovery` 闭合 webhook 登记的退款与清偿债务（恢复账号）；真库 e2e 全链路通过。测试：`__tests__/credit-concurrency.test.ts`（seed 同步建批次）、`__tests__/db-rbac-static.test.ts` 第十一批 |
| N-11 | ~~迁移无并发锁/事务/回滚/发布顺序（P1-7）~~ | `lib/migrate.ts` / `lib/migrate-concurrent.ts` / 部署流程 | ~~多实例同秒启动撞 DDL~~ | ✅ 已关闭：advisory_xact_lock、同事务回滚、运行时 fail-fast 与先迁移后发布（2026-08-30）；`CREATE INDEX CONCURRENTLY` 非事务迁移入口 `pnpm migrate:concurrent`（静态语句校验 + 版本冲突防护 + mode 列）与 expand-contract 模板（data/migrations-concurrent/README.md，2026-09-01，见 handoff §1.29） |
| N-12 | ~~建库路径三处并存（P1-6）~~ | `docs/07` / `lib/migrate.ts` | ~~首次启动 relation already exists 崩溃~~ | ✅ 已关闭：空库只跑 `pnpm migrate`；install.sql 设为历史脚本；检测到未登记 `users` 基线即 fail-fast |
| N-13 | 争议/拒付链路缺失 | PaymentEventType / orders.status | 收到 dispute 事件无处归一化，已消费积分不追回、账号不冻结 | ✅ 已关闭（2026-08-30）：`PaymentEventType` 加 `dispute_opened/won/lost`；`orders.status` 加 `disputed/charged_back`；`services/dispute.ts` 归一化状态机；**渠道解析器已归一化**——Stripe `charge.dispute.created/closed`（won/lost）全链路，Creem `dispute.created`→opened（Waffo Pancake v0.19 无 dispute webhook 事件，Dashboard-notified 为已知边界）。测试：`__tests__/dispute.test.ts`、`__tests__/provider-dispute.test.ts`、`__tests__/payment-event.test.ts`。**联盟奖励冲销已闭合（2026-09-01，迁移 0028）**：`private.reverse_affiliate_reward` 在 refund/dispute_lost 时把佣金 `completed→reversed`（幂等、失败不阻塞主流程、结果进埋点 detail），堵「首付拿佣金→退款/拒付」套利；争议收入确认口径核实为已正确（stats `total_revenue`/`revenue_30d` 只计 `status='paid'`），补注释。**联盟奖励发放已闭合（2026-09-01，迁移 0036，方案 A）**：奖励自动转积分（发放/冲销均批次精确、与流水同源）。剩余：方案 B（提现 + KYC/税务）留作规模化后升级路径 |
| N-14 | 支付 webhook 无持久化 inbox，处理失败事件丢失且无对账（P1-inbox） | `app/api/*-notify` / `lib/payment` | 渠道事件处理崩溃/DB 闪断即永久丢失（Stripe 重试仅 3 天）；渠道重放无去重档案；「远端成功但本地失败」无事后再发现手段 | ✅ 已关闭（2026-09-01 连库，迁移 0031）：三渠道 webhook 验签后**先落 `payment_events` inbox**（原始 payload 存档 + `____normalized` 归一化摘要冗余）再走 `processWebhookEvent` 处理——幂等键 `UNIQUE(provider, provider_event_id)`（Stripe/Creem=event.id、Waffo=Pancake delivery id、缺省 fallback=sha256(raw) 前 40 位），已 processed 的重放直接 ack；失败留 pending+last_error+retry_count 由渠道重试与每日 cron `replayPendingEvents`（超 5 分钟、有界 20 条）双路兜底；`reconcilePayments` 每日三规则对账（近 7 天 paid 订单漏单嫌疑 / retry≥3 失败积压 / 事件金额≠订单金额抽核）→ `payment.reconcile_anomaly` warn 走 outbox。RLS deny-all 仅授 service_role。测试：`__tests__/webhook-inbox.test.ts`（21 用例）+ `db-rbac-static.test.ts` 第十六批 6 用例 + 真库 e2e（幂等冲突/anon 零权限/重放与对账形态）。见 handoff §1.24 |
| N-15 | AI 收费无幂等/无崩溃补偿：超时重试重复扣费、扣费后崩溃积分永久丢失（P1-AI） | `app/api/v1/ai/generate` / `lib/ai-request.ts` | 高成本模型下重复计费与资金损失；请求不可审计不可恢复 | ✅ 已关闭（2026-09-01 连库，迁移 0032）：`ai_requests` 状态机（running/succeeded/failed/refund_pending/refunded 六态）+ `UNIQUE(user_uuid, request_id)` 按用户隔离幂等（键 1~128 位 URL 安全校验）+ 请求体指纹同键异体 422、同键在途/已成功 409（另 GET 查询端点）、终态条件重占可重跑；行存在即已扣费（扣费后才建 running 行）；幂等冲突路径一律先退本次扣费；cron 崩溃补偿（running 超 30 分钟退款 / refund_pending 超 10 分钟重试，条件更新互斥防双退）+ completed 超 24h TTL 清理；RLS deny-all 仅授 service_role。测试：`__tests__/ai-request.test.ts`（15 用例）+ `db-rbac-static.test.ts` 第十七批 4 用例 + 真库 e2e（隔离键/条件流转互斥/权限面）。输入硬限制已于 2026-09-01 补齐：messages 白名单 400 + `AI_MAX_PROMPT_BYTES`/`AI_MAX_MESSAGES` 超限 413（校验在扣费之前，`__tests__/ai-input-limit.test.ts`，见 handoff §1.25/§1.26） |

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

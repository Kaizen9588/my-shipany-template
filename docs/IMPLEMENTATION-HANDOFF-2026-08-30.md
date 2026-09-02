# 实施交接清单（2026-08-30）

> 用途：供下一位 Agent 继续实现本项目。本文是当前工作区的实施快照，不替代各模块的详细设计文档。
>
> **当前结论**：模板主干功能基本齐全，但真实收费仍被多个 P0 / No-Go 阻断。下一步必须优先关闭资金、权限、退款和匿名试用边界，不能先扩展产品功能。

---

## 1. 本次已完成的工作

### 1.1 P0-3：公开默认管理员弱口令 — 已关闭

- [x] `data/migrations/0012_default_admin.sql` 不再写入公开的默认 `super_admin`。
- [x] 新增 `data/migrations/0019_disable_legacy_default_admin.sql`，仅禁用仍使用历史固定 bcrypt hash 的旧默认账号，不影响已改密账号。
- [x] 新增 `lib/bootstrap-admin.ts`：仅在显式配置 `ADMIN_BOOTSTRAP_EMAIL` 时创建初始管理员。
- [x] 初始管理员为 `pending_activation`，首次强制改密后才转为 `active`。
- [x] 支持 `ADMIN_BOOTSTRAP_PASSWORD`；未配置时生成随机强临时密码，只输出到受限启动日志。
- [x] `app/api/user/change-password/route.ts` 已允许待激活管理员完成首次改密，但未放开其它普通业务访问。
- [x] 已补充 `__tests__/bootstrap-admin.test.ts` 与 `__tests__/user-password.test.ts` 断言。

### 1.2 P1-6：统一建库路径 — 已关闭

- [x] 唯一建库入口是 `pnpm migrate`，从 `data/migrations/0000_install_base.sql` 开始顺序执行。
- [x] `data/install.sql` 已在文档中标为历史脚本，禁止用于新库或生产库。
- [x] `lib/migrate.ts` 会检测“已有 `users` 但缺少 `schema_migrations`”的旧路径混用状态，并 fail-fast。
- [x] `README.md`、`docs/03-database-schema.md`、`docs/07-deployment.md` 已同步。

### 1.3 P1-7：迁移并发与发布安全 — 部分关闭

- [x] 迁移器使用 PostgreSQL 事务级 `pg_advisory_xact_lock`，避免多实例并发执行 DDL。
- [x] 全部常规迁移及版本写入在同一事务内执行；失败整体回滚。
- [x] `instrumentation.ts` 不再在运行时执行迁移，只调用只读 `verifyMigrations()`；检测到 pending migration 时服务拒绝启动。
- [x] 文档要求“先运行 `pnpm migrate`，再发布/扩容应用实例”。
- [ ] 尚未建立专用部署 job / CI 发布流水线来自动执行 `pnpm migrate`。
- [x] ~~尚未形成 `CREATE INDEX CONCURRENTLY` 的非事务专用迁移机制~~（已关闭 2026-09-01，见 §1.29）。
- [x] ~~尚未把 expand-contract 的执行模板固化为脚本或 CI 规则~~（已关闭 2026-09-01，模板固化于 data/migrations-concurrent/README.md，见 §1.29）。

### 1.4 第二批开发（2026-08-30 续，按 §5 执行顺序）

- [x] **P0-2 积分并发扣减**：新增 `data/migrations/0020_decrease_credits_user_lock.sql`，
      `decrease_credits` 入口先取用户级事务 advisory lock（`pg_advisory_xact_lock(736925141, hashtext(user_uuid))`，
      与迁移器全局锁 821316459 不撞键；事务级在 pooler 事务模式下安全）。并发回归测试
      `__tests__/credit-concurrency.test.ts`（静态断言默认运行；真实并发双花用例设 `TEST_DATABASE_URL` 后运行）。
      ⚠️ **目标库尚未应用 0020**（当前 Supabase 开发库 pooler 报 `tenant not found`，疑似项目暂停）；
      环境恢复后先 `pnpm migrate`，应用前不得开放真实收费。
- [x] 顺带修复：`pnpm migrate` 因 Node type-stripping 需要显式扩展名而崩溃——
      `lib/migrate.ts` / `lib/bootstrap-admin.ts` 的相对导入补 `.ts` 后缀（Next 16 默认 Turbopack 可解析）。
- [x] **N-1 通知密钥脱敏**：`models/notify.ts` 新增 `toNotifyConfigView`；GET /api/admin/notify-settings
      与后台页面 RSC payload 只含 `*_set` 标志 + `****末四位`，不回显 webhook URL / secret 原文；
      PUT 留空即保留现值、显式 `null` 才清空、掩码占位串被忽略；后台表单改为草稿式输入。
      测试：`__tests__/notify-settings-mask.test.ts`。
- [x] **P0-4 匿名 demo 防绕过**：`app/api/v1/ai/demo/route.ts` 落地 docs/14 §2.5 四条修法——
      字段白名单（仅 `prompt`）、`DEMO_MAX_PROMPT_BYTES` 字节上限（默认 8KB，超限 413 且照常计次）、
      退还仅限无上游费用错误（`APICallError` 4xx/5xx 分类）、当日失败次数封顶
      `DEMO_FAILURE_DAILY_LIMIT`（复用 anonymous_usage，key=`fail:<iphash>`）、分钟级限流走 `rateLimit()` 不 fail-open。
      测试：`__tests__/ai-demo-guard.test.ts`。新增环境变量已同步 `.env.example`。
- [x] 文档同步：`docs/03`、`docs/05`（P0-2 关闭说明）、`docs/14`（P0-4 关闭 + 防刷表）、
      `docs/boundary-spec.md`（N-1/N-8/N-9 状态）、本文件。

### 1.5 第三批开发（2026-08-30 续，N-3 客户端分离 + N-2 部分）

- [x] **N-3 客户端分离（已关闭）**：`models/db.ts` 拆出显式 `serverClient()`（service_role，
      仅受控服务端路径）/ `userClient()`（anon，走 RLS），去掉“有 service key 就隐式升级”的隐藏行为。
      资金/支付/退款/后台统计等特权路径已切到 `serverClient()`：`services/credit.ts`、
      `services/refund.ts`、`services/order.ts`、`services/stats.ts`、`lib/payment/index.ts`、
      `lib/payment/providers/{stripe? creem,waffo}.ts`。`getSupabaseClient()` 保留为兼容入口（语义不变）。
      相关测试的 `@/models/db` mock 同步暴露 `serverClient/userClient`。
- [x] **N-2 部分关闭（静态断言层）**：新增 `__tests__/db-rbac-static.test.ts`，校验资金路径
      （services/refund|credit|order、lib/payment*）不含 `getSupabaseClient()/userClient()`、资金 RPC
      由 `serverClient()` 触发——未来若把资金函数迁 private schema，可兜住调用点误走 anon 的回归。
- [x] 资金 RPC models/调用点核查：现有 funds 迁移中三个资金函数仍位于 `public` schema；
      **private schema 库级迁移未做**（目标库不可达无法验证 + 需同步改全部 RPC 调用点），
      留在连库后执行（见 §3）。
- [x] 测试配套：`credit/order-payment/payment-event/refund` 测试改用共享 mock fn（`vi.hoisted`）。

### 1.6 第三批验证结果（2026-08-30 续）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 全量 Vitest：**49 个测试文件、205 个用例通过**（含新增 `db-rbac-static.test.ts` 静态断言；3 个并发回归用例因未设 `TEST_DATABASE_URL` 跳过，属预期行为）。
- [x] 定向 ESLint：全部改动文件通过。
- [ ] **待办**：Supabase 开发库恢复后执行 `pnpm migrate` 应用 0020，并设
      `TEST_DATABASE_URL` 跑一次 `__tests__/credit-concurrency.test.ts` 的真实并发用例；按 §3 第 2 项做 N-2 库级权限迁移。

### 1.7 第四批开发（2026-08-30 续，P0-1 退款债务化 + N-13 争议链路）

- [x] **P0-1 退款债务化（部分关闭）**：新增 `data/migrations/0021_refund_debt_dispute.sql`——
      `orders.status` CHECK 扩展 `refund_requested`/`refund_blocked`/`disputed`/`charged_back`；
      新增 `credit_debts`（欠款账本：user_uuid/order_no/due_credits/status，UNIQUE(user_uuid,order_no)）、
      `refunds`（退款单）；存储过程 `debt_regulate_order_refund` 计算
      `缺口 = order_credits - refunded_credits`，超扣时写欠款 + 订单置 `refund_blocked` + 账号置 `restricted`。
      `services/refund.ts` 的 `processRefund` 在扣回量 < 订单发放积分时自动触发债务化，并 trackCriticalEvent 记欠款额。
      ⚠️ **目标库尚未应用 0021**（依赖连库，见 §3 P0-1 待办）。测试：`__tests__/refund.test.ts`（新增债务化分支）。
- [x] **N-13 争议/拒付链路（部分关闭）**：`lib/payment/types.ts` 的 `PaymentEventType` 新增
      `dispute_opened`/`dispute_won`/`dispute_lost`；新增 `services/dispute.ts` 的 `handleDisputeEvent`——
      `dispute_opened`→订单置 `disputed`（冻结）+ trackCriticalEvent(warn)；`dispute_won`→解冻回 `paid`(+info)；
      `dispute_lost`→置 `charged_back` + 账号 `restricted`(+critical)。`lib/payment/index.ts` 转发三个事件类型。
      `models/order.ts` 的 `OrderStatus` 新增 `RefundRequested/RefundBlocked/Disputed/ChargedBack`。
      测试：`__tests__/dispute.test.ts`。⚠️ **Provider 解析器未归一化 dispute 事件**（stripe/creem/waffo 当前只 emit `refund_succeeded`），
      联盟奖励冻结、收入确认仍待接（~~见 §5~~ 已关闭，见 §1.21）。

### 1.8 第四批验证结果（2026-08-30 续）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 全量 Vitest：**50 个测试文件、210 个用例通过**（含新增 `dispute.test.ts`；3 个并发回归用例因未设 `TEST_DATABASE_URL` 跳过）。
- [x] 定向 ESLint：全部改动文件通过。
- [ ] **待办**：Supabase 开发库恢复后执行 `pnpm migrate` 应用 0020 + 0021；P0-1 剩余（webhook 中间态、
      credit_lots 精确批次准入校验）见 §5；~~N-13 剩余（联盟奖励冻结、收入确认）~~（已关闭，见 §1.21）。

### 1.9 第五批开发（2026-08-30 续，纯代码：N-13 完成 + N-5 + 定价真相源）

- [x] **N-13 渠道解析器归一化 dispute（已关闭）**：
  - Stripe：`charge.dispute.created`→`dispute_opened`，`charge.dispute.closed`（status `won`/`lost`）→
    `dispute_won`/`dispute_lost`，通过 `payment_intent` 反查订单取 order_no/user_uuid（复用退款路径解析器）。
  - Creem：`dispute.created`→`dispute_opened`（SDK 无 won/lost 解纷事件，Dashboard 人工处理）；
    从 `checkout/order.metadata` 兜底取 order_no/user_uuid。
  - Waffo（Pancake v0.19）：**无 dispute/chargeback webhook 事件**（仅 Dashboard `notifyChargeback`），
    为已知边界——渠道内置防御 + Dashboard 人工处理，default 分支记录 URL 注释。
  - 测试：`__tests__/provider-dispute.test.ts`（Creem 4 用例）+ `__tests__/payment-event.test.ts`（dispute 路由）。
- [x] **N-5 剩余端点 fail-closed（已关闭）**：`rateLimitUser` 未配置/Upstash 抖动时不再 `{ok:true}`，
      回落内存日窗口；checkout 加 per-IP + per-user 限流；webhook 三路由加 body 64KB 上限
      （`lib/webhook-guard.ts`，刻意不做 IP 限流——渠道来源 + TRUSTED_PROXY=none 下同桶，见文件注释）。
      测试：`__tests__/ratelimit.test.ts`（fail-closed 分支）、`__tests__/webhook-guard.test.ts`。
- [x] **P1-8 定价真相源钉死 + P1-定价-1 写入校验（升 P0 关闭）**：运行时权威 = `payment_products` 表，
      `data/pricing.ts` 仅种子/回退（消掉「单一真相源」措辞矛盾）。`app/api/admin/payment-products/route.ts`
      PUT 加不变量：金额/积分/有效期上限、币种仅 USD、积分≤金额（防赠送定价套利）。
      测试：`__tests__/payment-products-guard.test.ts`。仍待办：事务化批量写入、双人复核。

### 1.10 第五批验证结果（2026-08-30 续）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 全量 Vitest：**53 个测试文件、226 个用例通过**（3 个并发回归用例因未设 `TEST_DATABASE_URL` 跳过）。
- [x] 定向 ESLint：全部改动文件通过。
- [ ] **待办**：无新增 DB 依赖（纯代码批次）；认证需连库项仍在 §3（0020/0021 应用、N-2 库级权限）。

### 1.12 第六批开发（2026-08-30 续，纯代码：N-6 高风险操作强制理由）

- **`lib/admin-reason.ts`（新增）**：`parseReason()` 统一校验（trim 后 5~200 字符，`REASON_MAX_LEN=200`）。
- **6 个 API 路由强制 reason**（缺失/不合规即拒绝，reason 写入 `audit_logs.detail`）：
  - `/api/admin/refund`（退款，Stripe 成功路径与 manual 路径均落审计）
  - `/api/admin/user/credits`（积分调账，`remark` 语义升级为必填 `reason`）
  - `/api/admin/user`（角色/封禁必填；nickname 修改豁免）
  - `/api/admin/payment-products`（定价，前缀 `pricing update reason required`）
  - `/api/admin/payment-settings`（渠道启停/优先级，前缀 `payment settings reason required`）
  - `/api/admin/notify-settings`（告警通道/密钥，前缀 `notify settings reason required`）
- **后台 UI 同步收集 reason**：
  - `components/dashboard/stats/order-actions.tsx` `RefundButton`：`window.prompt` 收集理由（取消/过短不发请求），随 `order_no` 提交
  - `app/[locale]/(admin)/admin/credits/adjust/page.tsx`：`remark` 字段升级为必填 `reason`（Textarea，minLength 5），server action 用 `parseReason` 校验
  - `app/[locale]/(admin)/admin/users/[uuid]/page.tsx`：角色变更（super_admin）、封禁/解封、积分调账三个 server action 全部 `parseReason` 校验 + 表单必填输入框
  - `pricing-form.tsx` / `payment-form.tsx` / `notify-form.tsx`：保存前前端预校验（≥5 字符），reason 随 PUT body 提交，保存成功后清空
- **测试**：`__tests__/payment-products-guard.test.ts` 补 reason + 新增缺 reason 拒绝用例；`__tests__/notify-settings-mask.test.ts` 三处 PUT body 补 reason。

### 1.13 第六批验证结果（2026-08-30 续）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 全量 Vitest：**53 个测试文件、227 个用例通过**（3 个并发用例跳过）。
- [x] ESLint：0 errors（124 个既有 warnings，与本批无关）。
- [x] **待办已闭合**：审批队列/双人复核（✅ 2026-09-01 0030，见 §1.23）；管理员操作 outbox 持久化（✅ 0029，见 §1.22）。

### 1.14 第七批开发（2026-08-30 续，纯代码：P0-1 webhook 中间态 + 副作用 after() 调度）

- **P0-1 剩余：webhook 退款只登记中间态（docs/05 §4.3）**
  - 迁移 `0022_webhook_refund_registration.sql`（待连库应用）：
    - 新增 `register_order_refund_request` 存储过程：写 `refunds` 退款单 + 订单置 `refund_requested` 中间态 + `debt_regulate_order_refund` 债务化准入（渠道已退钱、积分未回收 → 已消费部分直接欠款 + restricted）；`provider_refund_id` / 同订单 pending 单幂等；已终态订单（refunded/refund_blocked/charged_back）只登记退款单不动状态。
    - `process_order_refund` 扩展接受 `refund_requested`（webhook 先登记、后台/回收流程闭合终态），回收完成同步 pending 退款单为 succeeded。
  - `services/refund.ts` 新增 `registerRefundRequest()`（webhook 路径专用，serverClient + `payment.refund_requested` warn 告警）；`processRefund`（admin 路径）保持直回收 + 终态不变。
  - `lib/payment/index.ts` `refund_succeeded` 分支：改为 `registerRefundRequest`，不再直接扣积分/终态化；缺 `user_uuid` 的事件不登记不回收，发 `payment.refund_event_missing_user` critical 告警人工核查。
  - `lib/payment/types.ts` `PaymentEvent` 新增可选 `provider` / `provider_ref_id`；stripe（`charge.refunds.data[0].id`）、creem（`obj.id`）、waffo（顶层 `event.id`，SDK 事件幂等 ID）三个适配器已填充。
  - 测试：`__tests__/payment-event.test.ts` 改登记断言 + 缺 user_uuid 用例；`__tests__/refund.test.ts` 新增 `registerRefundRequest` 3 用例；`__tests__/db-rbac-static.test.ts` fundsRpcs 增 `register_order_refund_request`/`debt_regulate_order_refund`（断言改逐 serverClient() 分段检查，适配多函数文件）。
- **副作用执行模型（P1「副作用执行模型」纯代码部分）**
  - 新增 `lib/after-response.ts` `runAfterResponse()`：请求作用域内走 `after()`（next/server，Next 16 stable）——响应完成后、函数冻结前的平台保证窗口执行，响应失败/redirect/notFound 仍执行；请求作用域外（迁移/cron/单测）回退裸后台执行。
  - 接入：`lib/audit.ts`（`fireAndForgetAudit`）、`lib/oplog.ts`（`recordOpEvent` 改 void + `trackCriticalEvent` 告警外呼）、`lib/email/index.ts`（`fireAndForgetEmail`）、`lib/payment/index.ts`（站内通知 + 支付成功邮件 IIFE）。
  - **边界**：transactional outbox（N-4）仍是正解——`after()` 只保证「进程不被提前冻结」，不提供持久化重试；断电/崩溃仍会丢。~~outbox 需新表，归迁移批次~~（✅ 已关闭，0029，见 §1.22）。
  - 测试：`__tests__/oplog.test.ts` mock `next/server` 的 `after` 为微任务立即执行，新增「同步返回不阻塞」用例。

### 1.15 第七批验证结果（2026-08-30 续）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 全量 Vitest：**53 个测试文件、232 个用例通过**（3 个并发用例跳过）。
- [x] ESLint：0 errors（124 个既有 warnings，与本批无关）。
- [ ] **待办**：迁移 0021/0022 应用（连库后）；回收工作台 + 审批队列（需新表，归迁移批次）。

### 1.16 第八批：对抗式审查修复（2026-08-30 续）

对全部未提交改动做对抗式审查（双子代理 + 支付链路自查），发现并修复 P0×2 / P1×5 / P2×4：

- **P0（资金安全）**
  - 0022 登记路径死锁：初版 `register_order_refund_request` 登记时即调 `debt_regulate_order_refund(p_refunded_credits=0)`——未尝试回收就把全额发放积分打成欠款 + `refund_blocked`，而 `process_order_refund` 不接受 `refund_blocked`，**订单永久无法闭合**。修复：登记只写退款单 + 置 `refund_requested`，不做债务化；债务化统一由闭合方 `processRefund` 按实际扣回量判定。
  - admin 退款路由对 `refund_requested` 订单报"不可退"且强行调渠道会**双重退款**。修复：识别中间态，只本地闭合（`processRefund` 扣积分 + 终态），绝不二次触达渠道。
- **P1**
  - Waffo 退款事件恒缺 `user_uuid`，登记形同虚设 → 反查 `findOrderByOrderNo` 补齐（查不到则 critical 告警，不登记）。
  - `runAfterResponse` 无差别 catch 静默降级 → 按 `__NEXT_ERROR_CODE` 区分：E468（作用域外，合法）静默回退；其他（E91 waitUntil 不可用等）模块级一次性 `console.error` 显式暴露。
  - `fireAndForgetAudit` 回调内裸调 `getClientIp()`（headers()），抛错丢整条审计 → IP 在注册时解析（失败只丢 IP 不丢审计）。
  - `parseReason` 零宽字符（U+200B-200D/U+FEFF/U+2060/U+00AD）可绕过长度下限 → 清洗后再校验；`__tests__/admin-reason.test.ts` 5 用例回归。
  - webhook-guard 只信 `content-length`（chunked/谎报可绕过 64KB 限制）→ 流式实测截断 + 返回 `rawBody`，`requestWithRawBody()` 重建 Request 供验签；三 notify 路由接入。
- **P2**
  - `payment-settings` 定价旁路缺反套利校验（`payment-products` 有、settings JSON 无）→ 抽 `lib/pricing-guard.ts` 共用（credits≤amount、上限、floor 后成组校验）。
  - `processRefund` 内部重复审计且缺 reason → 审计只在 admin 路由层落一条带 reason 的；`processRefund` 增加 `reason` 透传债务化与埋点；对应测试用例改为断言不重复写审计。
  - checkout per-IP 限流在 `TRUSTED_PROXY=none`（默认）时 `getClientIp` 恒返 127.0.0.1，IP 桶退化为**全站单桶 20 次/分**，高峰误拒正常买单 → 仅在声明可信代理时启用 IP 维度，用户维度恒生效。
  - `trackCriticalEvent` 动态 `import("@/lib/notify")` 无 catch（unhandled rejection）；内存限流 Map 只增不删（随机 IP 撑爆内存）→ import 链加 catch 降级；Map 每 256 次写入惰性清理过期项 + 10,000 条硬上限。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 239 用例通过**（3 并发跳过）；ESLint 0 errors（124 warnings 与 master 持平，非本批引入）。

### 1.17 第九批：连库收尾（2026-09-01，Supabase 恢复可达）

- **迁移全部应用**：`pnpm migrate` 一次性应用 0017–0022（0019 默认管理员禁用、0020 积分并发锁、0021 退款债务化、0022 webhook 退款登记），`schema_migrations` 24 条记录确认。
- **P0-2 正式关闭**：`TEST_DATABASE_URL` 下 `credit-concurrency.test.ts` **4/4 通过**（5 并发扣 4 恰好 2 成功、空账本并发全败无负流水、负流水 expired_at NULL），测试数据零残留。测试修正：`credits.user_uuid` 外键指向 `users.uuid`，seed 需先建 users 行并同步清理。
- **N-2 正式关闭（迁移 0023 + 调用点 + Dashboard 手动步骤）**：
  - 迁移 `0023_private_schema_fund_rpcs.sql`：新建 `private` schema；五个资金函数（decrease_credits/handle_order_payment/process_order_refund/debt_regulate_order_refund/register_order_refund_request，取各自最新定义）全部迁入 `private` 并 `SET search_path` 防劫持；REVOKE PUBLIC/anon/authenticated + 仅 GRANT service_role；`credits/orders/refunds/credit_debts` 四表启用 RLS（无 policy=deny-all，service_role bypassrls 读写）。注意 `handle_order_payment` 历史三个签名（0003 四参/0010 六参/0017 八参）全清，代码只走八参。
  - 应用侧 6 处 RPC 调用点改 `serverClient().schema("private")`（services/credit、services/order、services/refund×3、lib/payment/index）。
  - **Dashboard 手动步骤（代码无法替代）**：Project Settings → API → Exposed schemas 加 `private`（原因：supabase-js 走 Data API REST，非 exposed schema 直接 4xx；函数层权限与 schema 暴露是两层独立关卡）。
  - 验证（连库实测）：5 个 RPC 经生产同款路径全部可达（传非法参数回业务错误=执行到函数体）；anon 三层被拒（public 无函数 PGRST202 / private schema `permission denied` / Data API 拒绝未暴露 schema PGRST106）；并发+静态 14 测试全过。
  - 新增静态断言：`db-rbac-static.test.ts` 增 3 用例（调用点必须 `.schema("private")`；0023 内容完备性；任何迁移不得再把资金函数建回 public）。
- **advisors 安全扫描（19 项发现，处置）**：
  - ✅ 已闭环：资金 4 表 RLS（0023）；advisors 不再报资金函数 search_path（0023 已 `SET search_path`）。
  - ⚠️ **新发现（登记为 P1 债务，本批不动）**：`users/apikeys/affiliates/anonymous_usage/audit_logs/op_events/notifications/posts/payment_products/payment_settings/verification_codes/system_settings/*_orders/schema_migrations` 等表 RLS 未启用（`rls_disabled_in_public` ERROR）；`apikeys.api_key`、`waffo_orders.session_id` 敏感列暴露（`sensitive_columns_exposed`）；两个 anonymous_usage 函数 search_path 可变（WARN）。**当前 anon key 在无 RLS 表上可全量读写**——生产开放收费前必须逐表配 RLS 策略（依赖 N-3 已有的 serverClient/userClient 分离，应用侧改造量可控）。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 242 用例通过**（3 并发用例已转真跑）；ESLint 0 errors（124 warnings 持平）。

### 1.18 第十批：public 全表 RLS 收口（2026-09-01 连库）

- **设计决策（deny-all，非逐表策略）**：动工前核实代码事实——应用**不存在 anon key / 浏览器端直连路径**（无 createBrowserClient/`@supabase/ssr`，`userClient()` 零调用点），全部读写经 Next.js 服务端 `getSupabaseClient()`，生产 service key 功能必填（docs/08）→ 运行时身份恒为 service_role（bypassrls）；且应用不用 Supabase Auth（NextAuth 自管 JWT），用户 uuid 不在 Supabase JWT 里，任何 `auth.uid()` 自访策略都不会命中。因此正确策略是**全拒 + 服务端特权**：与 0023 资金四表同 posture，未来接入 Supabase Auth/anon 直连时必须先显式设计策略（fail-loud）。
- **迁移 0024**：其余 15 张 public 业务表 ENABLE RLS（deny-all）+ 全部 19 张业务表 REVOKE anon/authenticated 全部表权限（含 0023 资金四表补 REVOKE——0023 只 ENABLE 了 RLS 没回收 Supabase 默认表特权）；RLS 与 REVOKE 是两层独立防线（未来误加宽松 policy 也不会静默放开）。`schema_migrations` 经 DATABASE_URL（表属主）读写，不受影响。
- **advisors WARN 收口**：`increment/decrement_anonymous_usage` 两 RPC `SET search_path` 钉死 + REVOKE PUBLIC/anon/authenticated + 仅 GRANT service_role——public schema 从此无任何 anon 可调用/可读对象。
- **连库验证**：19/19 表 `relrowsecurity=t`；anon/authenticated 表权限查询归零；PostgREST anon 直查 users/payment_products/posts/system_settings/verification_codes 全 401；service 路径读写正常；dev 起服关键路径回归（健康检查/首页/搜索/验证码）。
- **回归暴露并修复两个预存 bug（注册链路此前完全不可用）**：
  - **0025**：`verification_codes.code` VARCHAR(10) → VARCHAR(64)。2.15 round-7 改为存 SHA-256 哈希（64 hex）但迁移未同步，插入报 22001，send-verification 全挂。
  - **`consumeVerificationCode` 恒 false**：supabase-js `.update().select()` 不传 `{ count: "exact" }` 时 count 恒 null，代码 `if (!count) return false` 永远命中——验证码被标记 used 但路由报 invalid，注册/重置全挂。修 `models/verification.ts` 传 `{ count: "exact" }`。端到端复测：发码 → 校验 → 建号 → 赠 10 积分全通过，测试数据零残留。
- **静态断言**：`db-rbac-static.test.ts` 增 4 用例（0024 全表 ALTER/REVOKE 完备 + RPC 收口；任何迁移不得把表权限 GRANT 回 anon/authenticated；0025 列宽；consume 必须带 count exact）。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 246 用例通过**；ESLint 0 errors（124 warnings 持平）。

### 1.19 第十一批：credit_lots 批次账本 + 退款精确准入 + 回收工作台（2026-09-01 连库）

- **设计（双账本叠加，非替换）**：`credits` 流水表保留为展示层真相源（usage 页/后台流水/stats/邮件零改动）；新增 `credit_lots` 批次账本（每次发放一个批次：total/remaining/expired_at/status），作为退款精确准入的权威账本。消费明细落 `credit_consumptions`（一次消费跨多批次可追溯）。
- **迁移 0026**（已连库应用）：
  - `credit_lots` / `credit_consumptions` 两新表 ENABLE RLS（deny-all）+ REVOKE anon/authenticated（0024 同规）；
  - `grant_credit_lot` RPC：统一发放批次入口，幂等键 `lot_no = 'lot-'||trans_no`；
  - `decrease_credits` 重写：批次 FIFO（过期优先）+ `UPDATE ... WHERE remaining >= x` 行级原子（docs/03 #13 正解），advisory lock 保留覆盖空账本窗口；错误信息格式不变（`insufficient credits: %`）；
  - `handle_order_payment` 重写：订单发放同步建批次（同 trans_no，幂等）；
  - `process_order_refund` 重写：**精确准入**——回收量 = SUM(该订单批次 remaining)，过期批次 remaining 仍计入（防过期套利）；用户级 advisory lock 先于快照读取（与 decrease_credits 互斥）；扣完批次置 refunded；credits 负流水照旧；
  - `settle_credit_debt` RPC：债务清偿最后一环——outstanding→settled + 用户无其他 outstanding 债务时 restricted→active；幂等（已 settled 返回 0）；清偿说明追加进 reason；
  - 权限收口：5 个函数 REVOKE PUBLIC/anon/authenticated + 仅 GRANT service_role（0023 同规）。
- **应用层接线**：`services/credit.ts` 的 `increaseCredits` 与 `adjustCreditsByAdmin`（正数分支）在 `insertCredit` 后调 `grant_credit_lot`（`serverClient().schema("private")`）；`services/refund.ts` 口径注释更新。
- **回收工作台 `/admin/recovery`**（admin 导航「订单 → 回收工作台」）：队列一 refund_requested/refund_blocked 订单「闭合退款」（复用 `/api/admin/refund` 闭合语义，绝不触达渠道）；队列二 outstanding 债务「清偿」（新 `/api/admin/debt-settle` 路由，N-6 强制理由 + `admin.credit_debt.settle` 审计）。浏览器实测：登录→改密→页面渲染→导航入口全通过。
- **真库 e2e 回归（事务内回滚，零残留）**：发放 100 → 消费 30（批次剩 70 + consumption 明细）→ 再发 50 花光 → 退 order-A 精确回收 20（批次剩余，而非近似口径）→ 债务登记 → settle 清偿 + 账号恢复 + 重复 settle 返回 0。
- **测试**：`credit-concurrency.test.ts` seed 同步建批次（0026 后批次不随 credits 行自动创建）+ 清理含 lots/consumptions；`db-rbac-static.test.ts` 增第十一批 5 用例（0026 deny-all、grant/settle REVOKE/GRANT 成对、批次语义、双 advisory lock、发放路径同步建批次）；`credit.test.ts`/`credit-service.test.ts` mock 补 `.schema()` 链。
- **迁移写法教训**：CREATE OR REPLACE 不能移除既有参数默认值——0023 的 `handle_order_payment`/`process_order_refund` 带参数 DEFAULT，0026 重写必须原样保留默认值。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 251 用例通过**（静态 250 + 真库并发 4/4）；ESLint 0 errors；`pnpm build` 通过。

### 1.20 第十二批：默认管理员恢复 + 强制改密闭环（2026-09-02，产品决策）

- **产品决策**：恢复内置默认管理员 `admin@shipany.local` / 初始密码 `123456`，第一次登录强制更改密码。此前 0019 因「迁移不得内置公开凭据」禁用了历史账号；本批口径调整为——**公开初始凭据允许，但只能进一次性强制改密流程**（bcrypt 哈希入库，明文不进仓库）。
- **迁移 0027**（已连库应用，幂等）：INSERT/UPDATE 恢复默认管理员为 `pending_activation` + `must_change_password=true` + bcrypt(12) hash；文件末尾注释保留「生产不需要时 DELETE 或置 banned」的出口。
- **强制改密链路修复（浏览器实测发现的三个断点，全部修复）**：
  1. `lib/auth.ts getAdminUser()`：原对 `status !== "active"` 一律返回 null，pending_activation 管理员访问 `/admin` 被当无权限踢到 signin → 弹回 `/`，改密重定向永不可达。修复：放行 `pending_activation`（banned/deleted 照旧拦截）；
  2. `services/user.ts getUserInfo()`：原走 `getUserUuid()`，其 session 分支同样对非 active 返回空——`/change-password` 页面自己把待激活管理员重定向走了。修复：`getUserInfo()` 直读 session uuid（调用方 layout 自带状态守卫；**资金路径继续用 `getUserUuid()` 严格门，不受影响**）；
  3. `app/[locale]/(default)/(console)/layout.tsx`：`must_change_password` 重定向提到 status 拦截之前（否则待激活管理员进控制台被直接踢回 signin，同样到不了改密页）。
- **API 层防线**：`requireAdmin()` 新增 `must_change_password` 拦截（`password change required`）——未完成首次改密的管理员即使能登录，也调不了任何后台 API（退款/调账/改角色/定价全在 requireAdmin 后面）。`/api/user/change-password` 原本就直读 session、允许 pending_activation 完成改密并激活（0012 批设计，未动）。
- **浏览器 e2e 全链路通过**：`123456` 登录成功 → 访问 `/admin` 落在 `/change-password`（而非 signin 弹回）→ 提交当前密码+新密码 → toast「密码已修改」+ DB 确认 `active`/`must_change_password=false`/hash 更新 → 新密码重新登录 → `/admin` 看板正常渲染。测试后本地账号已重置回 pending_activation 态（便于回归）。
- **测试**：`db-rbac-static.test.ts` 增第十二批 4 用例（0027 默认账号形态：pending_activation + must_change_password 双路径 + 无明文密码；getAdminUser 放行/拦截顺序；console layout 重定向顺序；getUserInfo 直读 session）。
- **文档同步**：README（管理员段重写）、docs/07 §5.2.1+故障表、docs/04 #15、boundary-spec §二+§九 N-7 均改为新口径。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 255 用例通过**（静态 254 + 真库并发 4/4）；ESLint 0 errors。

### 1.21 第十三批：联盟奖励冲销 + 争议收入确认口径（2026-09-01 连库）

- **N-13 剩余闭环**：退款/拒付成立时同步冲销联盟佣金——否则「邀请人与被邀请人合谋：首付拿佣金 → 退款/拒付」套利成立。
- **迁移 0028**（已连库应用）：`private.reverse_affiliate_reward(p_order_no, p_reason) RETURNS INT`——SECURITY DEFINER + `SET search_path` + `FOR UPDATE` 行锁，仅 `completed` 可冲销（置 `reversed` 终态），无佣金/已冲销幂等返回 0；REVOKE PUBLIC/anon/authenticated、仅授 service_role（与 0023 同规）。
- **接线**：`processRefund`（admin 退款 + 回收工作台共用）与 `dispute_lost` 分支各加冲销调用，失败不阻塞主流程（console.error + 埋点人工核查），冲销金额进 `payment.refund_processed` / `payment.dispute_lost` 埋点 detail（`reversed_affiliate_reward`）。
- **收入确认口径核实**：`services/stats.ts` 的 `total_revenue` / `revenue_30d` 均只计 `status='paid'`——refunded/disputed/charged_back 天然不计入，实现已正确，仅补口径注释。
- **UI**：「我的邀请」页 status 渲染 `reversed`（en "Reversed" / zh "已冲销（退款/拒付）"）。0017 部分唯一索引语义：冲销后邀请人可因新真实订单再获佣金（可接受，冲销只作废该笔订单奖励）。
- **真库 e2e**：建佣金（completed, 2000）→ 冲销返回 2000 且状态 reversed → 二次调用 0（幂等）→ 不存在订单 0 → anon key 调 RPC 42501 拒绝（401）。
- **测试**：`db-rbac-static.test.ts` 增第十三批 3 用例（0028 RPC 静态断言；refund/dispute 接线 + schema("private") + detail 字段；my-invites/i18n 渲染）；`refund.test.ts` 加冲销成功/失败降级 2 用例、rpc mock 改为多 RPC 兼容；`dispute.test.ts` mock 补 `schema()` 链 + 冲销断言 + opened/won 不冲销用例；静态断言 RPC 清单拆分 `fundsRpcsM0023`（0028 的函数不在 0023 清单内）。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 262 用例通过**；ESLint 0 errors（124 warnings 均为既有）。

### 1.22 第十四批：运营事件 Transactional Outbox（N-4 关闭，2026-09-02 连库）

- **缺口**：`recordOpEvent` 对 `op_events` 是 fire-and-forget 直插、吞错——数据库闪断/进程崩溃会让 warn+ 关键事件（支付、退款、调账、webhook 伪造告警）永久丢失。第七批 `after()`（P1-A）只解决「有没有开始跑」，不提供持久化重试。
- **迁移 0029**（已连库应用）：`private.op_event_outbox` 队列表（pending→processing→删/dead；attempts/max_attempts=8 + last_error + available_at 指数退避）+ `op_events.event_id` UUID 部分唯一索引（投递幂等键）+ 六个 RPC，全部 private schema、REVOKE 后仅授 service_role（与 0023 同规）：`enqueue`/`claim`（`FOR UPDATE SKIP LOCKED` + processing 超 stale 分钟崩溃残留回收）/`deliver`（`ON CONFLICT (event_id) DO NOTHING` 幂等落库，返回是否新插入）/`ack`（成功删队列行）/`fail`（退避 2^n 分钟封顶 1h，超限置 dead）/`cleanup`（清死信）。注意：RPC 为 SECURITY INVOKER，需 GRANT service_role 表 + 序列权限。
- **oplog 分级改造**：info 直插（可丢，docs/16 明确允许）；warn/error/critical 走 `enqueue`（一条 INSERT，成功即持久化）→ ①本轮内联 dispatch ②后续 trackCriticalEvent 顺带清积压 ③每日 cron `outboxMaintenance()`（投递 100 批 + 清死信）兜底。入队失败退回直插（outbox 故障不丢主流程事件）。**告警外呼移到持久化成功之后**——notifyChannel 故障只丢告警不丢事件（解耦此前告警与落库同回调的耦合）。
- **cron 接入**：`/api/cron/daily` 增加 `outboxMaintenance()`，响应带 `outbox_delivered/deduped/failed/cleaned_dead`。
- **真库 e2e**：enqueue×2 → claim 领取 2 行(attempts=1) → deliver(true) → 重复 deliver(false 幂等) → ack → fail（退避生效，立即 claim 空）→ 重投 → op_events 落库 2 行且队列清空 → cleanup 返 0；service_role EXECUTE=真 / anon=假（42501）。
- **测试**：`oplog.test.ts` 重写 9 用例（info 直插/warn+ 入队/入队成功告警/入队失败退回直插/吞错纪律/void 语义/dispatch delivered+dedup+ack/dispatch fail 退避/cron 兜底）；`db-rbac-static.test.ts` 第十四批 3 用例（0029 表+幂等键+RLS+GRANT；六 RPC REVOKE/GRANT 成对+SKIP LOCKED/ON CONFLICT/退避/死信四要素；oplog 接线+cron）。

**验证**：`tsc --noEmit` 通过；全量 Vitest **54 文件 270 用例通过**；ESLint 0 errors。
**已知边界**：入队与业务变更不在同一事务（oplog 是旁路记录，业务 RPC 自带事务），极端窗口「业务成功但入队前崩溃」仍可能丢事件——对账任务（P1）为最后防线；文档已如实标注。

### 1.23 第十五批：管理员审批队列/双人复核（N-6 关闭，2026-09-01 连库）

- **缺口**：N-6 第一阶段（§1.12）只做了强制理由，管理员单账号即可执行退款/调账/改角色/封禁/定价——被盗号或误操作仍可直接造成资金损失，缺第二人复核。
- **迁移 0030**（已连库应用）：`private.admin_approvals` 审批单表（action/required_level/target/payload JSONB 快照/reason/status CHECK 七态 pending→approved→executing→executed、rejected/cancelled 终态、failed 可重试/requester+approver 双方身份/approve_reason/exec_error）+ 双索引（open 队列 partial、requester 历史）+ RLS deny-all + REVOKE anon/authenticated + 仅授 service_role（表+序列，0024/0023 同规）。private schema 无需 RPC，全部走 `serverClient()`。
- **双人复核语义**：**发起人不得批准/驳回自己的单据**（`decideApproval` 服务端硬校验 `requester_uuid === approver_uuid` 即拒）；批准人须达单据 `required_level`（user_role 单据要求 super_admin）。**单管理员部署不死锁**：`submitApproval` 检查是否存在其他活跃管理员（role∈admin/super_admin 且 active，判定失败抛错不放行）——有则 pending 等复核；无则自动置 approved（`approve_reason='single-admin mode'`）照常执行，流程审计统一。**双人复核保护要求生产部署 ≥2 个活跃管理员**（boundary-spec 已标注）。
- **5 类动作强制审批**（提交即落单、不再原路由执行）：退款/闭合退款（`/api/admin/refund`，refund_requested 闭合与 Stripe 退款都进队列；无商户退款 API 渠道仍走手动指引豁免）、积分调账（`/api/admin/user/credits` + credits/adjust 页 server action）、改角色（`/api/admin/user` role 段 + users 详情 server action，required_level=super_admin）、封禁/解禁（同路由 status 段；super_admin 账号延续不可改）、渠道+定价（`/api/admin/payment-products` 与 `/api/admin/payment-settings` 双入口合一类 action，payload 服务端快照）。告警密钥（notify-settings）豁免审批保留 reason（应急及时性）。
- **批准即执行**：`/api/admin/approvals`（GET 队列；POST op=submit/decide/retry/cancel）。`decideApproval` 批准 = 条件更新占用 executing（status 前置匹配防并发双批）→ 按 action 分发复用既有 service（processRefund/adjustCreditsByAdmin/updateUserByAdmin/updatePaymentProduct…），执行前重新校验（定价不变量、目标存在性、refundable 状态）；失败置 failed 留 exec_error（LEFT 500）可重试；重试与 5 分钟 stale 回收走条件占用防双执行。执行成功/失败/提交/驳回全部 trackCriticalEvent（warn+ 走 outbox 持久化）。
- **UI**：`/admin/approvals` 审批队列页（待处理+最近记录双表、内容摘要/发起人/复核人/失败原因、本人发起单据只可撤回）+ 侧边栏「审批队列」入口；5 个前端调用点 toast 适配 `approval_required/single_admin` 响应。
- **真库 e2e**：pending 单 → 条件占用 executing（第二个复核人抢占返 0 行）→ executed；failed 重占用；executing 超 5 分钟 stale 回收命中；anon/authenticated 对表零权限（仅 service_role）；RLS 启用。e2e 数据已清理。
- **测试**：`__tests__/admin-approval.test.ts` 16 用例（双人不变量/单管理员降级/自批拒绝/级别不足/并发抢占/批准即执行/执行失败/驳回/撤回/5 类 dispatch 校验）；`db-rbac-static.test.ts` 第十五批 3 用例（0030 表结构+权限收口；lib 双人复核语义；5 路由不再直改+approvals 路由+页面）；`payment-products-guard.test.ts` 适配审批语义。

**验证**：`tsc --noEmit` 通过；全量 Vitest **55 文件 289 用例通过**；ESLint 0 errors（124 个既有 warnings 不变）。
**已知边界**：①批准与执行在同一请求内完成（跨服务原子性由各 service 内部事务保证，审批单状态先行）；②CSRF 防护已于第十九批闭合（2026-09-01，middleware 加固，见 §1.27）；③单人部署降级语义使双人复核退化为记录留痕——安全水位取决于管理员账号数量。

### 1.24 第十六批：支付事件 Inbox 与每日对账（P1-inbox 关闭，2026-09-01 连库）

- **缺口**：三渠道 webhook 验签后直接调 `handlePaymentEvent`——处理崩溃/DB 闪断时事件永久丢失（渠道重试是唯一兜底，且 Stripe 默认仅 3 天）；渠道重试与本地处理之间无去重（幂等只靠 `handle_order_payment` 订单状态机）；无「远端成功但本地失败」的事后发现手段（§1.22 outbox 已知窗口的最后防线）。
- **迁移 0031**（已连库应用）：public `payment_events` inbox 表——provider/provider_event_id/event_type/order_no/amount_cents/currency/`raw_body JSONB`（原始 payload 存档）/signature_verified/status CHECK 五态（pending/processing/processed/failed/ignored）/retry_count/last_error/processed_at；**幂等键 `UNIQUE (provider, provider_event_id)`**；`idx_payment_events_order` + partial `idx_payment_events_status`（仅 pending/failed/processing）；RLS deny-all + REVOKE anon/authenticated + 仅授 service_role（表+序列，0024/0023 同规）。
- **幂等键来源**：`PaymentEvent.provider_event_id` 由三渠道适配器回传——Stripe = `event.id`（4 处）、Creem = `event.id`（3 处）、Waffo = Pancake delivery `WebhookEvent.id`（2 处，d.ts 明注 usable for idempotent deduplication）；拿不到时 fallback = `sha256(raw)` 前 40 位（`sha-` 前缀）。
- **处理链**（`lib/webhook-process.ts processWebhookEvent`，三路由共用）：parseWebhook（验签）→ **先落 inbox**（raw 存档 + 顶层冗余 `____normalized` 归一化摘要，cron 重放据此重建事件）→ duplicate（processed_at 已落 = 渠道重放）直接 ack 跳过 → `handlePaymentEvent` → 成功 markInboxProcessed / 失败留 pending+last_error+retry_count+1 并向路由抛错（返回 500 让渠道重试）。非业务事件（parseWebhook 返回 null，如 subscription.* 日志类）不落 inbox 直接 ack。三路由 stripe-notify/creem-notify/waffo-notify 已全部接入（不再直接调 handlePaymentEvent）。
- **cron 重放 + 对账**（`lib/webhook-inbox.ts`，接入 `/api/cron/daily` 第 6 项，失败不阻塞其他任务）：①`replayPendingEvents(20)`——pending/failed 且超 5 分钟（给渠道重试让路）按 created_at 升序有界重放，无摘要的历史行置 ignored；②`reconcilePayments()` 三规则——**漏单嫌疑**（近 7 天 paid 订单无任何 payment_succeeded 事件，事件落过库即算到达）、**失败积压**（pending/failed 且 retry≥3）、**金额抽核**（事件金额≠本地订单金额，实时链路由 handle_order_payment 精确比对兜底，此处为事后档案核）；有异常发 `payment.reconcile_anomaly`（warn，source=cron，走 0029 outbox 持久化，含 missing/mismatch 样本各 5 条）；结果计入 cron 响应（inbox_replayed/processed/failed + reconcile_* 五字段 + inbox_error）。
- **真库 e2e**：UNIQUE 幂等键冲突复现（同 (provider, provider_event_id) 二次 INSERT 被拒）；anon 直查/改/删零权限、service_role 有效权限 SELECT/INSERT/UPDATE/序列 USAGE 齐备（`has_table_privilege` 验证）；markProcessed 成功/失败留痕语义、cron 重放查询形态、对账三规则联查形态在真库可执行；e2e 数据已清理。
- **测试**：`__tests__/webhook-inbox.test.ts` 21 用例（fallbackEventId 稳定性/新事件落库/processed 重放 duplicate/pending 重放不算重/未知 provider 拒绝/upsert 失败抛错/markProcessed 成败两路/摘要重建/无摘要 ignored/重放成败计数/processWebhookEvent 三分支/reconcile 三规则+告警触发条件）；`db-rbac-static.test.ts` 第十六批 6 用例（0031 表结构+幂等键+权限收口；三路由 inbox 接入且不直调 handlePaymentEvent；三适配器 provider_event_id 计数；lib 幂等/重放/三规则语义；cron 接线）；`webhook-signature-alert.test.ts` 适配 inbox 链（mock inbox 层，保留 400/200/500 响应契约与 invalid_signature 告警断言）。

**验证**：`tsc --noEmit` 通过；全量 Vitest **56 文件 315 用例通过**（基线 289 + 本批 26）；ESLint 0 errors（124 个既有 warnings 不变）。
**已知边界**：①inbox 落库与业务处理仍非同一事务（inbox 先行持久化，处理失败由重试+重放兜底——这正是 inbox 的设计语义，与 outbox 旁路窗口互补）；②`____normalized` 摘要只覆盖归一化字段，渠道侧扩展字段仍以 raw_body 为准；③对账窗口默认 7 天/500 单上限，超量需人工介入（告警样本已含 order_no）。

### 1.25 第十七批：AI 请求状态机（P1-AI 关闭，2026-09-01 连库）

- **缺口**：generate 路由无幂等（客户端超时重试 = 重复扣费，每次生成新 trans_no）；「失败退款」依赖请求进程存活——扣费后进程崩溃积分永久丢失；无请求持久化，不可审计、不可恢复（docs/13 v1 上线门槛 v1.5 整块缺失）。
- **迁移 0032**（已连库应用）：public `ai_requests`——request_id/user_uuid/model/provider/estimated_credits/body_fingerprint（请求体指纹）/status CHECK 六态（created/running/succeeded/failed/refund_pending/refunded）/input_tokens/output_tokens/error_message/refund_attempts/completed_at；**幂等键 `UNIQUE(user_uuid, request_id)` 按用户隔离**（P1-5：防客户端可控公共键空间跨租户抢注）；partial `idx_ai_requests_recover`（仅 running/refund_pending）；RLS deny-all + REVOKE anon/authenticated + 仅授 service_role（表+序列）。
- **幂等语义**（`lib/ai-request.ts beginAiRequest`）：`Idempotency-Key` 头可选（1~128 位 URL 安全字符，非法 400；未提供服务端生成 `srv-*` 键不可重试）；请求体指纹 `sha256(model+prompt|messages+max_tokens)`——同键同体 running/succeeded 返 409（带已有记录摘要，另有 `GET /api/v1/ai/generate?request_id=` 查询端点），同键异体返 422，failed/refunded 终态条件重占 running 可重跑（与崩溃补偿互斥，0 行命中当 409）。**幂等判定发生在扣费之后**：409/422 路径一律先退本次扣费（refundQuietly，退不掉记日志），不能吞用户的钱。
- **状态机**：**行存在即代表已扣费**（扣费成功后才建 running 行，消除「扣费后崩溃已扣未记」歧义）；`markAiRequestSucceeded`（running→succeeded 记 usage）、`markAiRequestFailed`（running→refund_pending 条件占用→退款→failed；退款失败 refund_attempts+1 留 refund_pending；占用 0 行=崩溃补偿已处理不重复退）。
- **崩溃补偿**（cron `/api/cron/daily` 第 7 项，失败不阻塞其他任务）：`compensateStaleAiRequests`——running 超 30 分钟（扣费后进程崩溃）条件占用→退款→refunded；refund_pending 超 10 分钟退款重试；全部条件更新互斥防双退。`cleanupCompletedAiRequests`——completed 超 24h 终态行清理（幂等键 TTL 口径）。响应加 ai_compensated/ai_refunded/ai_still_pending/ai_cleaned + ai_error。
- **真库 e2e**：UNIQUE 冲突复现 + 不同用户同 request_id 可共存（按用户隔离验证）；running→refund_pending 条件流转、二次流转 0 行（互斥）；TTL 清理查询形态；anon/authenticated 零权限 + service_role 有效权限 + RLS 启用；e2e 数据已清理。
- **测试**：`__tests__/ai-request.test.ts` 15 用例（键格式/指纹稳定性/新键落账/409 两态/422/终态重占/重占 0 行/成功流转/退款成败两路/占用互斥/补偿两查询面/重试仍失败 still_pending/TTL 只删终态）；`db-rbac-static.test.ts` 第十七批 4 用例（0032 表结构+隔离键+权限收口；lib 条件流转/补偿/TTL 语义；路由幂等链接入+冲突退款；cron 接线）。

**验证**：`tsc --noEmit` 通过；全量 Vitest **57 文件 334 用例通过**（基线 315 + 本批 19）；ESLint 0 errors（124 个既有 warnings 不变）。
**已知边界**：①prompt/messages 字节与条数上限（413）已于 2026-09-01 补齐（见下方第十八批）；②幂等结果缓存不做——同键已成功只回状态摘要不给生成结果（结果不落库，客户端需自存）；③服务端生成键不可重试（客户端不传 Idempotency-Key 时超时重试仍会重复扣费，契约文档已注明强烈推荐）。

### 1.26 第十八批：AI 输入硬限制（413 / 白名单 400，2026-09-01）

- **generate 路由 3.1 节**（鉴权/限流之后、扣费之前）：prompt 非字符串 400、messages 非数组 400；`AI_MAX_PROMPT_BYTES`（默认 32768）prompt 超 413；`AI_MAX_MESSAGES`（默认 50）条数超 413；messages 逐项白名单 `{role: system|user|assistant, content: string}` 违规 400；messages 总字节超 `AI_MAX_PROMPT_BYTES` 413。校验在扣费之前且已过限流——413 不会成为计费绕过或免费重试通道。
- **测试**：`__tests__/ai-input-limit.test.ts` 7 用例（32KB 上限/环境变量调小/messages 总字节/条数上限/白名单 400/类型 400/合法放行到扣费）；`db-rbac-static.test.ts` 增 1 用例（静态断言限制块存在且位于 decreaseCredits 之前）。全量 **58 文件 342 用例**（基线 334 + 本批 8）。

### 1.27 第十九批：CSRF 防护加固 + 防护矩阵成文（N-6 收尾项 + P3-4 关闭，2026-09-01）

- **背景**：6.22 已有 middleware Origin 校验（所有非 GET /api/*，豁免 webhook/cron），本批为加固而非从零实现。admin 与用户端认证全部是 httpOnly session cookie（NextAuth v5 默认），跨站风险真实存在；`/api/v1/*` 的 Bearer sk- 调用无 cookie，无 CSRF 面。
- **middleware 加固**（`middleware.ts`）：①豁免从 `includes("-notify")` 子串匹配改为精确匹配（`/api/cron/*` 前缀 + `/api/*-notify` 后缀正则），防未来路径名意外命中绕过 CSRF（fail-open）；②允许集合新增 `NEXT_PUBLIC_WEB_URL` 钉死站点 origin（不再纯依赖客户端可篡改的 Host 头派生）；③生产 https 站点拒绝 `http://` 同源 origin（HSTS 降级防护，开发环境保留）；④缺失 Origin 仍放行（curl/SDK/Bearer 无 cookie CSRF 面，设计行为写入文档）。
- **防护矩阵成文**（docs/02 §认证机制，P3-4 关闭）：全局规则 + 按端点族矩阵（admin / 用户 session / v1 generate 双认证 / demo / NextAuth 自管 / webhook-cron 豁免）。
- **测试**：`__tests__/middleware-csrf.test.ts` 10 用例（同源放行/跨站 403/缺 Origin 放行/WEB_URL 钉死/生产 http 降级拒绝/CORS 白名单/四类豁免/子串不豁免/GET-HEAD-OPTIONS 不校验/非 API 路径不走 CSRF）。全量 **59 文件 352 用例**（基线 342 + 本批 10）。

### 1.28 第二十批：定价/渠道配置事务化批量写入（P0-定价-1 全关闭，2026-09-01 连库）

- **缺口**：审批批准后逐条 `updatePaymentProduct` / `updatePaymentSettingDetail`（独立 autocommit）——中途失败把真相源留在半更新状态（amount 已改 credits 未改，积分≤金额不变量在中间态被打破 = 可套利定价），重试前线上就是半套定价。
- **迁移 0033**（已连库）：`private.apply_payment_config(JSONB)` SECURITY DEFINER RPC（search_path 钉死）——payload 与审批快照同构（`{settings, products}`）；**先全量校验后写入**（product_id/provider 必填且目标必须已存在、金额/积分/有效期上限、积分≤金额、币种 USD、enabled/priority 类型校验——与 `lib/pricing-guard` 同规，DB 层纵深防御）；写入阶段任一语句失败整体回滚（PL/pgSQL 函数体原子）。REVOKE PUBLIC/anon/authenticated，仅授 service_role（0023/0028/0029 同规）。
- **接线**（`lib/admin-approval.ts`）：`payment_settings` 执行分发器改调 RPC（payload 原样透传），移除逐条 UPDATE 路径与 `@/models/payment` 更新函数依赖（不变量预验保留在应用层作快速失败）。
- **真库 e2e**：混合批次（合法+不存在产品）整体回滚零残留；两 RPC 连调中途失败回滚；成功路径写入后 ROLLBACK 无残留；注入 payload 安全拒绝；anon/authenticated 无执行权 + service_role 有效 + SECURITY DEFINER/search_path 确认。
- **测试**：`admin-approval.test.ts` +2（RPC 调用与快照透传 / RPC 失败上抛落 failed 可重试）；`db-rbac-static.test.ts` +2（0033 结构与权限收口 / 逐条 UPDATE 路径移除断言）。全量 **60 文件 356 用例**（基线 352 + 本批 4）。

### 1.29 第二十一批：CONCURRENTLY 非事务迁移入口 + expand-contract 模板（N-11 全关闭，2026-09-01）

- **缺口**：`CREATE INDEX CONCURRENTLY` 不能在事务内执行，runMigrations 全程单事务无法承载；expand-contract 执行模板只存在于部署文档一句话，无固化纪律。
- **`lib/migrate-concurrent.ts` + `scripts/migrate-concurrent.ts`（`pnpm migrate:concurrent`）**：`data/migrations-concurrent/` 专用目录，autocommit 逐文件执行（无 BEGIN）；`assertConcurrentOnly` 静态拒绝非 CONCURRENTLY 语句（autocommit 无回滚，混入普通 DDL 失败即留半成品）；版本写入 `schema_migrations.mode='concurrent'`（表自动补 mode 列）；与事务迁移共用 advisory lock 键防多实例并发；失败提示 INVALID 索引需 DROP INDEX CONCURRENTLY 后重试。
- **版本冲突防护**（`findVersionConflicts`，接入 runMigrations 与 verifyMigrations）：同一版本号不得同时出现在两个迁移目录——重号会被先执行方抢先注册、另一方静默跳过。
- **expand-contract 模板固化**（`data/migrations-concurrent/README.md`）：expand（可空/带默认值加列）→ migrate（分批回填）→ contract（全实例发布后删旧结构，禁止同发布内做 contract）三段纪律 + 大表判定基准（>100 万行或持续写入走并发目录）。
- **真库 e2e**：mode 列自动补齐；真实 `CREATE INDEX CONCURRENTLY` 迁移执行 + version 记录 mode='concurrent' + DROP INDEX CONCURRENTLY 清理；两迁移入口均幂等可重入。
- **测试**：`__tests__/migrate-concurrent.test.ts` 4 用例（CONCURRENTLY 放行/事务 DDL 拒绝/版本冲突检测/目录空态）。全量 **61 文件 362 用例**（基线 356 + 本批 6）。

### 1.11 本次验证结果（第一批）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 定向 ESLint：迁移与引导相关文件通过。
- [x] 全量 Vitest：**45 个测试文件、185 个用例通过**。
- [x] `git diff --check` 通过。
### 1.29 第二十一批：CONCURRENTLY 非事务迁移入口 + expand-contract 模板（N-11 全关闭，2026-09-01）

- **缺口**：`CREATE INDEX CONCURRENTLY` 不能在事务内执行，runMigrations 全程单事务无法承载；expand-contract 执行模板只存在于部署文档一句话，无固化纪律。
- **`lib/migrate-concurrent.ts` + `scripts/migrate-concurrent.ts`（`pnpm migrate:concurrent`）**：`data/migrations-concurrent/` 专用目录，autocommit 逐文件执行（无 BEGIN）；`assertConcurrentOnly` 静态拒绝非 CONCURRENTLY 语句（autocommit 无回滚，混入普通 DDL 失败即留半成品）；版本写入 `schema_migrations.mode='concurrent'`（表自动补 mode 列）；与事务迁移共用 advisory lock 键防多实例并发；失败提示 INVALID 索引需 DROP INDEX CONCURRENTLY 后重试。
- **版本冲突防护**（`findVersionConflicts`，接入 runMigrations 与 verifyMigrations）：同一版本号不得同时出现在两个迁移目录——重号会被先执行方抢先注册、另一方静默跳过。
- **expand-contract 模板固化**（`data/migrations-concurrent/README.md`）：expand（可空/带默认值加列）→ migrate（分批回填）→ contract（全实例发布后删旧结构，禁止同发布内做 contract）三段纪律 + 大表判定基准（>100 万行或持续写入走并发目录）。
- **真库 e2e**：mode 列自动补齐；真实 `CREATE INDEX CONCURRENTLY` 迁移执行 + version 记录 mode='concurrent' + DROP INDEX CONCURRENTLY 清理；两迁移入口均幂等可重入。
- **测试**：`__tests__/migrate-concurrent.test.ts` 4 用例（CONCURRENTLY 放行/事务 DDL 拒绝/版本冲突检测/目录空态）。全量 **61 文件 362 用例**（基线 356 + 本批 6）。

### 1.11 本次验证结果（第一批）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 定向 ESLint：迁移与引导相关文件通过。
- [x] 全量 Vitest：**45 个测试文件、185 个用例通过**。
- [x] `git diff --check` 通过。

### 1.30 第二十二批：Upstash 限流路径 fail-closed 加固（2026-09-01）

**背景**：`lib/ratelimit.ts` 在配置 Upstash 后走 `@upstash/ratelimit` SDK。审查发现两处 fail-open 面：
① SDK `applyTimeout` 在超过 `timeout`（默认 **5000ms**）后仍 resolve `{success:true, reason:"timeout"}`——此时 Redis 计数并未确认，高并发/Redis 抖动下等于限流失效静默放行；
② prefix 固定 `@upstash/ratelimit`（SDK 默认），多环境/多站点共用同一 Redis 时计数互相串扰。

**修复**（`lib/ratelimit.ts`）：
- `timeout: 500`——超时窗口收窄到 500ms，Redis 抖动时不再挂 5 秒；
- `rateLimit()` 检测 `res.reason === "timeout"` 后 **回落内存降级**（`rateLimitByIp`），把"计数未确认"当不可信继续计数并拒绝，不静默放行（fail-closed）；
- prefix 按环境隔离：分钟级 `ratelimit:${NEXT_PUBLIC_PROJECT_NAME || "app"}`、日配额 `ratelimit-daily:...`；
- 新增 `isUpstashConfigured()` 导出，供观测/诊断判断当前限流模式。

**测试**：`__tests__/ratelimit.test.ts` 扩至 11 用例——timeout 回落（mock limit 返回 `reason:"timeout"`，连打 31 次 > DEFAULT_MAX=30 后第 31 次拒绝）、prefix/timeout 配置捕获（`vi.resetModules()` 强制重建单例后断言 `ratelimit:proj-a` 隔离与未设 env 回退 `ratelimit:app`）、`isUpstashConfigured()` 两态。

**文档同步**：docs/13（6.18 行 + 跨实例限流块改"已落地" + 风险表 P1 行关闭）、docs/08（Upstash 行注记 + NEXT_PUBLIC_PROJECT_NAME prefix 隔离行）。

**遗留**：生产 Vercel 需确认已配置 `UPSTASH_REDIS_REST_URL/TOKEN`——未配置时仍是内存限流（单实例有效）。

### 1.30 第二十二批：Upstash 限流路径 fail-closed 加固（2026-09-01）

**背景**：`lib/ratelimit.ts` 在配置 Upstash 后走 `@upstash/ratelimit` SDK。审查发现两处 fail-open 面：
① SDK `applyTimeout` 在超过 `timeout`（默认 **5000ms**）后仍 resolve `{success:true, reason:"timeout"}`——此时 Redis 计数并未确认，高并发/Redis 抖动下等于限流失效静默放行；
② prefix 固定 `@upstash/ratelimit`（SDK 默认），多环境/多站点共用同一 Redis 时计数互相串扰。

**修复**（`lib/ratelimit.ts`）：
- `timeout: 500`——超时窗口收窄到 500ms，Redis 抖动时不再挂 5 秒；
- `rateLimit()` 检测 `res.reason === "timeout"` 后 **回落内存降级**（`rateLimitByIp`），把"计数未确认"当不可信继续计数并拒绝，不静默放行（fail-closed）；
- prefix 按环境隔离：分钟级 `ratelimit:${NEXT_PUBLIC_PROJECT_NAME || "app"}`、日配额 `ratelimit-daily:...`；
- 新增 `isUpstashConfigured()` 导出，供观测/诊断判断当前限流模式。

**测试**：`__tests__/ratelimit.test.ts` 扩至 11 用例——timeout 回落（mock limit 返回 `reason:"timeout"`，连打 31 次 > DEFAULT_MAX=30 后第 31 次拒绝）、prefix/timeout 配置捕获（`vi.resetModules()` 强制重建单例后断言 `ratelimit:proj-a` 隔离与未设 env 回退 `ratelimit:app`）、`isUpstashConfigured()` 两态。

**文档同步**：docs/13（6.18 行 + 跨实例限流块改"已落地" + 风险表 P1 行关闭）、docs/08（Upstash 行注记 + NEXT_PUBLIC_PROJECT_NAME prefix 隔离行）。

**遗留**：生产 Vercel 需确认已配置 `UPSTASH_REDIS_REST_URL/TOKEN`——未配置时仍是内存限流（单实例有效）。

### 1.31 第二十三批：多供应商数据边界声明（P1 关闭，2026-09-01）

**背景**：AI 网关只做功能路由（哪家有 key 走哪家，`lib/ai/registry.ts`），没有声明各供应商对请求内容的处理边界——用户输入被转发到哪家、该家是否保留/用于训练、区域在哪、出问题找谁，模板运营方无从得知，无法向最终用户公示。

**落地**（声明式，不引入运行时开销）：
- `data/model-pricing.ts` 新增 `PROVIDER_DATA_BOUNDARY` 常量表：五字段（`dataRetention` 保留期 / `trainsOnInputs` 训练用途（boolean | "unknown" 三态）/ `region` 区域 / `piiAdvice` 脱敏建议 / `incidentContact` 事件联系）；
- 覆盖 registry 全部 4 家：openai（官方有出处：30 天滥用监测、可零保留、不训练）、deepseek / openrouter / siliconflow（未核实口径一律 `"unknown"`，禁止乐观默认 false）；
- 维护纪律成文（docs/13 决策 3.1）：新增 provider 缺声明不合并（PR 必填项）；年度复核；该表是声明而非技术拦截，运行时 PII 脱敏留给产品方按 piiAdvice 自实现。

**测试**（`__tests__/db-rbac-static.test.ts` +2 用例）：①registry 每个 provider 必须在 PROVIDER_DATA_BOUNDARY 有对应声明（新增供应商缺声明 = CI 红）；②五字段齐全（trainsOnInputs 允许 boolean | "unknown" 三态，禁止 undefined 缺省乐观默认）。

**文档同步**：docs/13 决策 3.1 + 风险表 P1 行关闭；docs/15 AI 能力表新增一行。

**遗留**：表中声明值需运营方上线前按最新供应商官方文档复核（尤其 deepseek/siliconflow 保留口径）。

### 1.31 第二十三批：多供应商数据边界声明（P1 关闭，2026-09-01）

**背景**：AI 网关只做功能路由（哪家有 key 走哪家，`lib/ai/registry.ts`），没有声明各供应商对请求内容的处理边界——用户输入被转发到哪家、该家是否保留/用于训练、区域在哪、出问题找谁，模板运营方无从得知，无法向最终用户公示。

**落地**（声明式，不引入运行时开销）：
- `data/model-pricing.ts` 新增 `PROVIDER_DATA_BOUNDARY` 常量表：五字段（`dataRetention` 保留期 / `trainsOnInputs` 训练用途（boolean | "unknown" 三态）/ `region` 区域 / `piiAdvice` 脱敏建议 / `incidentContact` 事件联系）；
- 覆盖 registry 全部 4 家：openai（官方有出处：30 天滥用监测、可零保留、不训练）、deepseek / openrouter / siliconflow（未核实口径一律 `"unknown"`，禁止乐观默认 false）；
- 维护纪律成文（docs/13 决策 3.1）：新增 provider 缺声明不合并（PR 必填项）；年度复核；该表是声明而非技术拦截，运行时 PII 脱敏留给产品方按 piiAdvice 自实现。

**测试**（`__tests__/db-rbac-static.test.ts` +2 用例）：①registry 每个 provider 必须在 PROVIDER_DATA_BOUNDARY 有对应声明（新增供应商缺声明 = CI 红）；②五字段齐全（trainsOnInputs 允许 boolean | "unknown" 三态，禁止 undefined 缺省乐观默认）。

**文档同步**：docs/13 决策 3.1 + 风险表 P1 行关闭；docs/15 AI 能力表新增一行。

**遗留**：表中声明值需运营方上线前按最新供应商官方文档复核（尤其 deepseek/siliconflow 保留口径）。

### 1.32 第二十四批：P2 批量第一组——过期时刻重算 / Stripe 订阅清单 / 邮件触发点核实（2026-09-01）

**① `orders.expired_at` 支付时刻重算（迁移 0034）**
- 问题：checkout 在下单时把 `expired_at = now() + valid_months` 冻结，webhook 落账时直接复制进 credits——迟到支付（含 expired 恢复）的用户被吃掉间隔天数的有效期。
- 修复：`private.handle_order_payment` 以 `v_expired_at := p_paid_at + make_interval(months => v_order.valid_months)` 重算（valid_months 空/0 保留原值兼容永不过期），写回 `orders.expired_at` 与 `credits.expired_at` 口径一致；重算位于金额比对之后，mismatch 无副作用。
- 顺带：`DROP FUNCTION public.handle_order_payment`——0023 后的残留僵尸副本（Data API 可见但无调用方），N-2 暴露面收紧。
- e2e（连库）：迟到 2 天支付 → `expired_at - paid_at = 30 days`、`gap_from_now = 0`；重放后 anon 无法 EXECUTE private 函数、service_role 可用；迁移器应用 + psql 重放双通道验证。

**② Stripe webhook 订阅清单文档补齐**
- docs/07 §2.5：Events 补 `charge.dispute.created` + `charge.dispute.closed`（N-13 已实现处理逻辑，漏订阅则拒付不冻结）。
- docs/payment/stripe-integration.md §2.3：争议两行改 ✅ 已处理，P2-2 警告块改已关闭 + 部署注意四事件。

**③ payment_success 邮件触发点核实（无需改动）**
- 真实触发点：lib/payment/index.ts 归一化路径落账成功后 `runAfterResponse` 内发送（after() 调度冻结安全）。
- services/order.ts `handleOrderSession` 是 pay-success 页面收敛为纯跳转（2.19-①）后的无调用方遗留代码，仅测试引用；其邮件块属死路径。挂账清零但不删除（保留 RPC 契约测试价值，删除与否留待专门清理批次）。

**测试**：db-rbac-static +3 用例（0034 重算 CASE/Interval、mismatch 前后序、expired_at 写回一致 + public DROP 断言；断言锚定非注释代码行，头部伪代码不计入）。

### 1.32 第二十四批：P2 批量第一组——过期时刻重算 / Stripe 订阅清单 / 邮件触发点核实（2026-09-01）

**① `orders.expired_at` 支付时刻重算（迁移 0034）**
- 问题：checkout 在下单时把 `expired_at = now() + valid_months` 冻结，webhook 落账时直接复制进 credits——迟到支付（含 expired 恢复）的用户被吃掉间隔天数的有效期。
- 修复：`private.handle_order_payment` 以 `v_expired_at := p_paid_at + make_interval(months => v_order.valid_months)` 重算（valid_months 空/0 保留原值兼容永不过期），写回 `orders.expired_at` 与 `credits.expired_at` 口径一致；重算位于金额比对之后，mismatch 无副作用。
- 顺带：`DROP FUNCTION public.handle_order_payment`——0023 后的残留僵尸副本（Data API 可见但无调用方），N-2 暴露面收紧。
- e2e（连库）：迟到 2 天支付 → `expired_at - paid_at = 30 days`、`gap_from_now = 0`；重放后 anon 无法 EXECUTE private 函数、service_role 可用；迁移器应用 + psql 重放双通道验证。

**② Stripe webhook 订阅清单文档补齐**
- docs/07 §2.5：Events 补 `charge.dispute.created` + `charge.dispute.closed`（N-13 已实现处理逻辑，漏订阅则拒付不冻结）。
- docs/payment/stripe-integration.md §2.3：争议两行改 ✅ 已处理，P2-2 警告块改已关闭 + 部署注意四事件。

**③ payment_success 邮件触发点核实（无需改动）**
- 真实触发点：lib/payment/index.ts 归一化路径落账成功后 `runAfterResponse` 内发送（after() 调度冻结安全）。
- services/order.ts `handleOrderSession` 是 pay-success 页面收敛为纯跳转（2.19-①）后的无调用方遗留代码，仅测试引用；其邮件块属死路径。挂账清零但不删除（保留 RPC 契约测试价值，删除与否留待专门清理批次）。

**测试**：db-rbac-static +3 用例（0034 重算 CASE/Interval、mismatch 前后序、expired_at 写回一致 + public DROP 断言；断言锚定非注释代码行，头部伪代码不计入）。

### 1.33 第二十五批：P2 批量第二组——GDPR 日志匿名化 + PostHog 删除联动（2026-09-01）

**① 迁移 0035：`private.anonymize_user_personal_data(TEXT)`**
- 问题：`delete-account` 软删除只匿名化 users 行；`op_events.subject_uuid/ip/detail`、`audit_logs.admin_uuid/target_uuid/ip` 属 GDPR「个人数据」却无限期残留（docs/04 §8 待补 6，第十轮 P3-7）。
- 修复：SECURITY DEFINER RPC（search_path 钉死、REVOKE 后仅授 service_role）匿名化三张表——op_events、op_event_outbox 队列残留（防投递又写出真实 uuid）、audit_logs；uuid 字段改 `deleted+{uuid}` 占位（保住审计可关联性，不再指向真实身份），ip 置空，detail 内 `user_uuid/user_email/ip` 键移除；`order_no` 保留（财务关联键，非直接标识符）。UPDATE 而非 DELETE，幂等可重放。
- e2e（连库）：三类日志各 1 行匿名化后 subject/uuid 全为占位、ip/PII 键清空。

**② delete-account 路由接入**
- 匿名化 RPC 调用吞错（失败不阻塞删除主流程，占位符规则可人工重放）；`getSupabaseClient()` 升级为 `serverClient()`（跨 schema RPC + 与 N-3 服务端边界一致）。
- PostHog 联动（docs/04 §8 待补 1）：posthog-node v5 已移除 deletePerson API（`Object.getOwnPropertyNames` 原型链核实无 delete/gdpr 方法），按官方口径改发 `$delete_person` capture 事件；`lib/telemetry/server.ts` 新增 `deleteTelemetryUser()`，吞错 + 未配置静默跳过。

**测试**：db-rbac-static +3（0035 三表覆盖/权限/definer 静态断言、路由接线断言、telemetry `$delete_person` 断言）。

**文档**：docs/04 §8 待补清单 1/2/6 关闭（4 数据导出/5 冷静期留产品项）、docs/15 checklist 行更新、docs/03 迁移清单补 0035。

### 1.33 第二十五批：P2 批量第二组——GDPR 日志匿名化 + PostHog 删除联动（2026-09-01）

**① 迁移 0035：`private.anonymize_user_personal_data(TEXT)`**
- 问题：`delete-account` 软删除只匿名化 users 行；`op_events.subject_uuid/ip/detail`、`audit_logs.admin_uuid/target_uuid/ip` 属 GDPR「个人数据」却无限期残留（docs/04 §8 待补 6，第十轮 P3-7）。
- 修复：SECURITY DEFINER RPC（search_path 钉死、REVOKE 后仅授 service_role）匿名化三张表——op_events、op_event_outbox 队列残留（防投递又写出真实 uuid）、audit_logs；uuid 字段改 `deleted+{uuid}` 占位（保住审计可关联性，不再指向真实身份），ip 置空，detail 内 `user_uuid/user_email/ip` 键移除；`order_no` 保留（财务关联键，非直接标识符）。UPDATE 而非 DELETE，幂等可重放。
- e2e（连库）：三类日志各 1 行匿名化后 subject/uuid 全为占位、ip/PII 键清空。

**② delete-account 路由接入**
- 匿名化 RPC 调用吞错（失败不阻塞删除主流程，占位符规则可人工重放）；`getSupabaseClient()` 升级为 `serverClient()`（跨 schema RPC + 与 N-3 服务端边界一致）。
- PostHog 联动（docs/04 §8 待补 1）：posthog-node v5 已移除 deletePerson API（`Object.getOwnPropertyNames` 原型链核实无 delete/gdpr 方法），按官方口径改发 `$delete_person` capture 事件；`lib/telemetry/server.ts` 新增 `deleteTelemetryUser()`，吞错 + 未配置静默跳过。

**测试**：db-rbac-static +3（0035 三表覆盖/权限/definer 静态断言、路由接线断言、telemetry `$delete_person` 断言）。

**文档**：docs/04 §8 待补清单 1/2/6 关闭（4 数据导出/5 冷静期留产品项）、docs/15 checklist 行更新、docs/03 迁移清单补 0035。

### 1.34 第二十六批：P2 批量第三组——备份策略成文 + SSE 加密 + P2 清单核实收口（2026-09-01）

**① 备份加密（lib/storage.ts）**
- `uploadFile` 强制带 `ServerSideEncryption`：默认 `AES256`（SSE-S3）；`STORAGE_SSE_KMS_KEY` 设置后升级 `aws:kms`（`kms-default` = 账户默认密钥，其他值为指定 key id）。全站上传统一受益，备份文件（含用户 email）落盘即加密。

**② 备份策略成文（docs/07 §2.4.1）**
- 内容/加密/脱敏/保留周期（S3 生命周期 90 天 + Supabase 自带快照互补）/月度恢复演练五项口径表；部署检查项：bucket Public Access Block 全开。
- 注意事项成文：应用层 JSON 导出不含结构变更，新增关键表须同步 `lib/backup.ts` 表清单。

**③ P2 清单核实收口**
- 部分退款/多次退款：核实 0026 `process_order_refund` 已按订单 credit_lots 批次 remaining 精确回收（含过期批次防套利）+ 0021/0022 债务化/回收工作台已上线——docs/05 P0-退款-1 验收三项齐备，docs/15 两行陈旧口径修正；金额比例拆分式部分退款标记 v2 需求驱动。
- 争议举证导出：明确 v1 口径（admin 从 /admin/logs + my-orders 手工导出），自动化导出接口需求驱动。

**测试**：无新逻辑分支（SSE 参数为上传元数据），既有 371 用例回归通过。


---

## 2. 已具备的模块能力（已有实现，不等于生产就绪）

| 模块 | 当前能力 | 状态 | 主要实现位置 |
|---|---|---|---|
| Landing / i18n | Landing 区块、中英双语、法律页、主题切换 | ✅ 可用 | `app/[locale]/`、`components/blocks/`、`i18n/` |
| OAuth / 密码登录 | Google、GitHub、Google One-Tap、Credentials、验证码、登录失败限制 | ✅ 可用 | `auth/config.ts`、`app/api/send-verification/`、`models/verification.ts` |
| RBAC / 后台 | admin / super_admin / operator、用户、订单、积分、文章、审计管理 | ✅ 基础可用 | `lib/auth.ts`、`app/[locale]/(admin)/`、`app/api/admin/` |
| 积分系统 | 新用户赠分、订单充值、API 扣减、管理员调整、余额/流水 | ⚠️ 有实现但资金并发模型未达标 | `services/credit.ts`、`data/migrations/0002_credits_safe_decrease.sql` |
| 多支付渠道 | Stripe / Creem / Waffo Adapter、checkout、webhook、退款入口、健康路由 | ⚠️ 有实现但 webhook/inbox/退款闭环未达标 | `lib/payment/`、`app/api/checkout/`、`app/api/*-notify/` |
| AI 网关 | 认证、模型白名单、预估扣费、生成失败退款、匿名 demo | ⚠️ 有实现但缺请求状态机与崩溃补偿 | `app/api/v1/ai/`、`lib/ai/`、`data/model-pricing.ts` |
| 用户控制台 | API Key、积分、订单、邀请、资料、用量、通知、订阅展示 | ✅ 基础可用 | `app/[locale]/(default)/(console)/` |
| 邮件 / 埋点 / 告警 | Resend 模板、PostHog、op_events、飞书/企微通知 | ⚠️ 副作用投递模型仍有缺口 | `lib/email/`、`lib/telemetry/`、`lib/oplog.ts`、`lib/notify/` |
| 备份 / 健康 | health、daily cron、备份封装 | ⚠️ 生产配置与恢复演练待验证 | `app/api/health/`、`app/api/cron/`、`lib/backup.ts` |
| 迁移 / 初始管理员 | 有序迁移、版本校验、受控管理员引导 | ✅ 本批已加固 | `lib/migrate.ts`、`lib/bootstrap-admin.ts` |

---

## 3. 未完成项：生产 No-Go（必须优先）

> 详细方案分别位于 `docs/boundary-spec.md`、`docs/03-database-schema.md`、`docs/05-payment-credits-flow.md`、`docs/13-ai-gateway.md`、`docs/14-anonymous-trial.md`。

### P0：真实收费前必须关闭

| 优先级 | 未完成项 | 风险 / 验收目标 | 建议起点 |
|---|---|---|---|
| P0-1 | 退款对已消费积分无回收路径 | ✅ **已关闭（2026-09-01，连库，见 §1.19）**：迁移 0026 `credit_lots` 批次账本落地——退款按订单批次 remaining 精确回收（防「先消费再退款」稀释 + 防过期套利），缺口照旧债务化（0021）；webhook 中间态闭合入口 = 回收工作台 `/admin/recovery`（0022→工作台→processRefund）；债务清偿闭环 = `settle_credit_debt` + 工作台清偿按钮；真库 e2e 全链路通过 | `data/migrations/0026_credit_lots_refine.sql`、`services/refund.ts`、`services/credit.ts`、`app/[locale]/(admin)/admin/recovery/`、`app/api/admin/debt-settle/` |
| ~~P0-2~~ | ~~`decrease_credits` 并发安全不成立~~ | **已关闭（2026-09-01，连库）**：迁移 0020 已应用，`TEST_DATABASE_URL` 真实并发用例 4/4 通过（见 §1.17） | `data/migrations/0020_decrease_credits_user_lock.sql`、`__tests__/credit-concurrency.test.ts` |
| ~~P0-4~~ | ~~匿名 demo 可通过失败退还绕过次数~~ | **已关闭（2026-08-30）**：输入硬限制 413 计次、退还仅限无上游费用错误、当日失败封顶、限流不 fail-open（见 §1.4） | `app/api/v1/ai/demo/route.ts`、`__tests__/ai-demo-guard.test.ts` |
| ~~N-1~~ | ~~管理员通知 API 回显完整 webhook secret~~ | **已关闭（2026-08-30）**：GET/RSC 只出 set 标志 + 末四位掩码，PUT 留空保留现值（见 §1.4） | `models/notify.ts`、`__tests__/notify-settings-mask.test.ts` |
| N-2 | 资金 RPC 没有数据库权限边界 | ✅ **已关闭（2026-09-01，连库，见 §1.17）**：迁移 0023 五个资金函数迁 `private` + REVOKE/仅授 service_role + 四资金表 RLS；6 处调用点 `serverClient().schema("private")`；Dashboard Exposed schemas 已加 private；连库验证 anon 三层被拒、应用通路 5/5 可达 | `data/migrations/0023_private_schema_fund_rpcs.sql`、`__tests__/db-rbac-static.test.ts`、docs/03 §生产权限基线 |
| N-3 | 服务端与用户数据库 client 未分离 | **已关闭（2026-08-30）**：`models/db.ts` 拆 `serverClient()`/`userClient()`，资金/支付/退款/后台统计改走 `serverClient()`；兼容入口保留（见 §1.4 续） | `models/db.ts`、`__tests__/db-rbac-static.test.ts` |
| ~~N-4~~ | ~~关键审计事件 fire-and-forget 会丢失~~ | **已关闭（2026-09-02，0029，见 §1.22）**：Transactional Outbox 队列 + 幂等投递 + 退避死信 + 每日 cron 兜底 | `lib/oplog.ts`、`data/migrations/0029_op_event_outbox.sql` |
| ~~N-5~~ | ~~高成本端点限流 fail-open~~ | **已关闭（2026-08-30，见 §1.9）**：`rateLimitUser` 回落内存日窗口（fail-closed）；checkout 加 per-IP/per-user 限流；webhook 加 body 64KB 上限。**Upstash 路径 fail-open 已补齐（2026-09-01，见 §1.30）**：SDK 超时不再静默放行，prefix 按环境隔离 | `lib/ratelimit.ts`、`lib/webhook-guard.ts`、checkout/webhook 路由 |
| ~~N-6~~ | ~~管理员高风险操作无二次确认/审批~~ | **基本关闭（2026-09-01，见 §1.12 + §1.23）**：第一阶段 6 路由服务端强制理由（§1.12）；第二阶段审批队列/双人复核（§1.23）——5 类高危动作（退款/调积分/改角色/封禁/渠道定价）落 `admin_approvals` 审批单，发起人≠批准人硬校验，批准即执行、失败可重试，单管理员部署自动降级留痕（双人复核需 ≥2 活跃管理员）。CSRF 防护已闭合（第十九批 §1.27，middleware 加固 + 豁免精确化 + 防护矩阵成文） | `lib/admin-approval.ts`、`data/migrations/0030_admin_approval_queue.sql`、`app/api/admin/approvals/route.ts`、`/admin/approvals` 页面、`lib/admin-reason.ts` |
| ~~N-13~~ | ~~争议 / 拒付链路缺失~~ | **已关闭（2026-08-30，见 §1.7 + §1.9；剩余部分 2026-09-01 关闭，见 §1.21）**：状态机 + 三渠道解析器归一化 + 测试齐备；联盟奖励冲销（0028）+ 争议收入确认口径核实均已完成 | `services/dispute.ts`、`services/refund.ts`、`data/migrations/0028_affiliate_reward_reversal.sql`、`lib/payment/types.ts` |
| ~~P0-定价-1~~ | ~~管理员定价写入在自己收款金额权威源上~~ | ✅ **全部关闭**：加固（2026-08-30，§1.9）+ 双人复核（2026-09-01，§1.23）+ **事务化批量写入（2026-09-01，§1.28，迁移 0033 `apply_payment_config` RPC 原子写入，任一失败整体回滚，DB 层再验不变量）** | `app/api/admin/payment-products/route.ts`、`__tests__/payment-products-guard.test.ts`、`lib/admin-approval.ts`、`data/migrations/0033_transactional_pricing_write.sql` |

---

## 4. 未完成项：P1 / P2 / P3

### P1（高优先级）

- [x] **~~AI 请求幂等与状态机~~（已关闭 2026-09-01，见 §1.25/§1.26）**：迁移 0032 `ai_requests`（`UNIQUE(user_uuid, request_id)` + 请求体指纹 422 + running/refund_pending 崩溃补偿 + 24h TTL）；输入硬限制已补齐（§1.26：白名单 400 + 字节/条数 413）。
- [x] **~~支付 webhook inbox 与每日对账~~（已关闭 2026-09-01，见 §1.24）**：迁移 0031 `payment_events`（三渠道先落库再处理 + `UNIQUE(provider, provider_event_id)` 幂等）+ `replayPendingEvents` cron 重放 + `reconcilePayments` 三规则对账（漏单/失败积压/金额抽核）+ `payment.reconcile_anomaly` 告警走 outbox。
- [x] **~~定价真相源统一~~（已关闭 2026-08-30，见 §1.9；事务化批量写入 2026-09-01 闭合，见 §1.28）**：运行时权威 = `payment_products`，`data/pricing.ts` 仅种子/回退；写入路由加不变量校验；双人复核（§1.23）；批准执行走事务化 RPC（迁移 0033）。
- [x] **~~迁移发布机制补全~~（已关闭 2026-09-01，见 §1.29）**：`pnpm migrate:concurrent` 非事务迁移入口（CONCURRENTLY 专用，autocommit + 静态语句校验 + 版本冲突防护）+ expand-contract 模板固化。
- [x] **副作用执行模型**：邮件、埋点、告警统一挂 `after()`（第七批）；关键事件 Transactional Outbox（0029，第十四批）。

### P2（中优先级）

- [x] **~~部分退款、多次退款与按批次积分回收规则~~（已核实 2026-09-01 全链路已落地，docs/05 P0-退款-1 验收标准三项齐备）**：按批次精确回收（0026 `process_order_refund` 读订单 credit_lots remaining + advisory 锁）+ 债务化/回收工作台（0021/0022 + /admin/recovery）此前已分批上线，本次核实文档口径并把金额比例拆分式部分退款标记为 v2 需求驱动项（v1 未启用，无收入路径依赖）。
- [ ] 争议 / 拒付的运营处理与举证导出（dispute 时导出该用户 AI 调用日志 + 消费流水作为渠道举证材料；v1 由 admin 从 /admin/logs 与 my-orders 手工导出，自动化导出接口待需求驱动）。
- [x] **~~GDPR 删除覆盖 `op_events.subject_uuid` 与 `audit_logs` 中的个人数据~~（已关闭 2026-09-01，迁移 0035 + e2e，见 §1.33）**：`private.anonymize_user_personal_data` RPC 匿名化三张日志表（uuid 占位 + ip 抹除 + detail 脱敏），delete-account 路由接入；PostHog `$delete_person` 联动同批落地。
- [x] **~~`payment_success` 邮件触发点改到真实 webhook 成功路径~~（已核实无需改动，2026-09-01，见 §1.32）**：webhook 归一化路径（lib/payment/index.ts）已在落账成功后经 `runAfterResponse` 发送；services/order.ts 的 `handleOrderSession` 是 pay-success 页面收敛后的无调用方遗留代码（仅测试引用），其邮件块属死路径，不构成重复触发。
- [x] **~~Stripe 部署文档补 `charge.refunded` 订阅事件~~（已关闭 2026-09-01，见 §1.32）**：docs/07 §2.5 事件清单补齐 `charge.dispute.created/closed`；docs/payment/stripe-integration.md §2.3 争议行改"已处理"+ P2-2 警告块闭合。
- [x] **~~`orders.expired_at` 从支付时刻计算，而不是下单时刻冻结~~（已关闭 2026-09-01，迁移 0034 + e2e，见 §1.32）**：落账时 `paid_at + valid_months` 重算并写回订单行与积分行；public 残留副本顺带 DROP。
- [x] **~~数据备份加密、脱敏、保留周期与恢复演练~~（已关闭 2026-09-01，见 §1.34）**：S3 上传强制 SSE（AES256 默认 / KMS 可选 `STORAGE_SSE_KMS_KEY`）、users 字段白名单脱敏（2.13 已有）、保留周期与月度恢复演练口径成文 docs/07 §2.4.1；bucket 防公开读列为部署检查项。

### P3（工程与文档收口）

- [ ] 清理根目录 `README.md` / `DEVELOPMENT_PLAN.md` 中已删除 `docs/12` 的悬空链接。
- [ ] 统一文档章节编号及过时“已完成”标记。
- [x] **~~明确 `/api/v1/*` 的 CORS / CSRF / Bearer API Key 防护矩阵~~（已关闭，第十九批 §1.27）**：矩阵成文于 docs/02 §认证机制；middleware CSRF 加固（豁免精确化 + NEXT_PUBLIC_WEB_URL 钉死 + 生产 http 降级拒绝）+ `__tests__/middleware-csrf.test.ts` 10 用例。
- [ ] 中文 prompt 的 token 估算不能继续用 `prompt.length / 4`。
- [ ] 新用户赠分的批量注册防刷策略。
- [ ] 评估并补充用户导出、运营审批和高风险操作确认 UX。

---

## 5. 推荐下一位 Agent 的执行顺序

1. **~~P0-2 积分并发扣减~~（已关闭，2026-09-01 连库）**：0020 已应用、真实并发用例 4/4 通过。
2. **~~N-2 资金 RPC 库级权限边界~~（已关闭，2026-09-01 连库）**：迁移 0023 + 调用点 + Exposed schemas 全部完成，见 §1.17。
3. **~~P0-4 匿名 demo 限制~~（已关闭）**：已落地输入硬限制 + 失败封顶 + fail-closed 限流（见 §1.4）。
4. **~~N-1 通知密钥脱敏~~（已关闭）**：见 §1.4。
5. **~~N-5 限流 fail-closed / N-13 争议链路 / P1-8+pricing 写入校验~~（已关闭，见 §1.9）**：纯代码批次已完成。P0-1 剩余与 N-13 剩余见本行下面：
   - ~~P0-1:webhook 只登记 `refund_requested` 中间态~~（已接线，见 §1.14）：剩 credit_lots 精确批次准入校验、后台回收工作台；~~应用 0021/0022~~（0021/0022 已应用，2026-09-01）。
   - ~~N-13 剩余:联盟奖励冻结、争议收入确认~~（已关闭，见 §1.21）：0028 冲销 RPC + refund/dispute_lost 接线；收入确认口径核实为已正确（stats 只计 paid）。
6. **~~N-6 高风险操作强制理由 + 审批队列~~（全部关闭，见 §1.12 + §1.23）**：5 类高危动作落审批单双人复核（0030），单管理员部署降级留痕；outbox 底座（0029）已承接其审计事件。
7. **~~新 P1（advisors 扫描 2026-09-01）：public 其余表 RLS~~（已关闭，2026-09-01 连库）**：迁移 0024 对 public 全部 19 张业务表 ENABLE RLS（deny-all）+ REVOKE anon/authenticated 全部表权限（含 0023 资金四表补 REVOKE），anonymous_usage 两 RPC EXECUTE 仅授 service_role + search_path 钉死；连库验证 anon 直查全部 401、权限归零、应用关键路径回归通过。附带修复两个回归暴露的预存 bug：0025（verification_codes.code 列宽 VARCHAR(10)→64，SHA-256 哈希存不进去，注册/重置全挂）+ `consumeVerificationCode` update 未传 `{ count: "exact" }`（恒 return false）。见 §1.18。
8. **~~P0-1 剩余：credit_lots 批次账本 + 回收工作台~~（已关闭，2026-09-01 连库）**：迁移 0026 已应用（批次 FIFO 扣减 + 退款精确准入 + `settle_credit_debt` 清偿闭环）；回收工作台 `/admin/recovery` 上线（闭合 webhook 登记的退款 + 清偿债务 + 恢复账号）；真库 e2e 全链路（发放→消费→精确退款→债务→清偿）通过。见 §1.19。
9. **~~默认管理员恢复 + 强制改密闭环~~（已关闭，2026-09-02）**：迁移 0027 + getAdminUser/getUserInfo/console layout/requireAdmin 四处修复 + 浏览器 e2e 全链路通过。见 §1.20。
10. **~~N-13 剩余：联盟奖励冲销 + 争议收入确认~~（已关闭，2026-09-01 连库）**：迁移 0028 `private.reverse_affiliate_reward`（completed→reversed，幂等）+ `processRefund`/`dispute_lost` 接线 + my-invites reversed 状态；真库 e2e（冲销/幂等/anon 拒绝）通过；收入确认口径核实 stats 只计 paid。见 §1.21。
11. **~~N-4：运营事件 Transactional Outbox~~（已关闭，2026-09-02 连库）**：迁移 0029 `private.op_event_outbox` + 六 RPC（enqueue/claim SKIP LOCKED/deliver 幂等/ack/fail 退避死信/cleanup）+ `lib/oplog.ts` warn+ 分级入队（入队即持久化）+ 三触发面投递（内联/顺带/每日 cron 兜底）+ 告警外呼后移；真库 e2e 全链路通过。见 §1.22。
12. **~~Webhook inbox、对账~~（已关闭，2026-09-01 连库）**：迁移 0031 + 三路由 inbox 链 + cron 重放/三规则对账，见 §1.24。副作用调度已切 `after()`（见 §1.14），outbox 持久化重试已完成（0029，见 §1.22）。**~~AI 请求状态机~~（已关闭，2026-09-01 连库）**：迁移 0032 + 幂等/崩溃补偿/TTL，见 §1.25。可靠副作用与支付/AI 崩溃补偿闭环至此完成。

> 注意：每一批完成后要同步更新本文件、对应方案文档、测试和 `.workbuddy-ai/memory/2026-08-30.md`。不要把“有 UI / 有接口”误标为“生产就绪”。
> **当前债务优先级（下一步）**：进入 P2 批量（部分退款/争议运营/GDPR/邮件触发点等，见 §4 P2 清单）。P1 级安全/架构债务已全部关闭（分布式限流 §1.30、多供应商数据边界 §1.31）。注：P0 全部关闭（P0-1/P0-2/P0-3/P0-4），N-1~N-6 全部关闭（N-6 双人复核 0030，见 §1.23）、P1-inbox/对账（0031，见 §1.24）、P1-AI 状态机（0032，见 §1.25）与其输入硬限制（见 §1.26）、CSRF（§1.27）均已关闭、N-13/RLS（0024）/迁移应用（0019–0032）均已关闭。

---

## 6. 常用验证命令

```bash
# 类型检查
pnpm tsc --noEmit

# 全量测试
pnpm test

# 代码规范
pnpm lint

# 数据库迁移（唯一写 schema 的入口）
pnpm migrate

# 启动开发服务器（只校验迁移版本，不运行 DDL）
pnpm dev
```

## 7. 工作区注意事项

- 不要删除 `.workbuddy-ai/`，其中保存项目协作记忆。
- 不要提交 `.env.local`、真实 key、私钥或 webhook secret。
- 当前工作区还有 `app/api/metrics/`、`lib/metrics-auth.ts`、`docs/16-observability-alerting.md` 等未提交改动；它们不是本轮迁移/管理员安全改造的产物，继续前请单独审阅。

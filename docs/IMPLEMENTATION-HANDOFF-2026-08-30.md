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
- [ ] 尚未形成 `CREATE INDEX CONCURRENTLY` 的非事务专用迁移机制。
- [ ] 尚未把 expand-contract 的执行模板固化为脚本或 CI 规则。

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
- [ ] **待办（N-6 剩余，需新表 → 归迁移批次）**：审批队列/双人复核；管理员操作走 transactional outbox 持久化（依赖 N-4）。

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
  - **边界**：transactional outbox（N-4）仍是正解——`after()` 只保证「进程不被提前冻结」，不提供持久化重试；断电/崩溃仍会丢。outbox 需新表，归迁移批次。
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

### 1.11 本次验证结果（第一批）

- [x] TypeScript：`tsc --noEmit` 通过。
- [x] 定向 ESLint：迁移与引导相关文件通过。
- [x] 全量 Vitest：**45 个测试文件、185 个用例通过**。
- [x] `git diff --check` 通过。

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
| N-4 | 关键审计事件 fire-and-forget 会丢失 | 支付、退款、调账无法可靠追溯；需 transactional outbox、重试和最后错误 | `lib/oplog.ts`、`data/migrations/0014_op_events.sql` |
| ~~N-5~~ | ~~高成本端点限流 fail-open~~ | **已关闭（2026-08-30，见 §1.9）**：`rateLimitUser` 回落内存日窗口（fail-closed）；checkout 加 per-IP/per-user 限流；webhook 加 body 64KB 上限 | `lib/ratelimit.ts`、`lib/webhook-guard.ts`、checkout/webhook 路由 |
| N-6 | 管理员高风险操作无二次确认/审批 | ⚠️ **部分关闭（2026-08-30，见 §1.12）**：6 路由（退款/调账/角色封禁/定价/渠道/告警密钥）服务端强制理由（`lib/admin-reason.ts` parseReason 5~200 字符）+ reason 入审计 + 后台 UI 全部同步。剩余：审批队列/双人复核（需新表，归迁移批次）、CSRF 防护 | `lib/admin-reason.ts`、6 个 admin 路由、`components/dashboard/stats/order-actions.tsx`、3 个 admin 表单 |
| ~~N-13~~ | ~~争议 / 拒付链路缺失~~ | **已关闭（2026-08-30，见 §1.7 + §1.9；剩余部分 2026-09-01 关闭，见 §1.21）**：状态机 + 三渠道解析器归一化 + 测试齐备；联盟奖励冲销（0028）+ 争议收入确认口径核实均已完成 | `services/dispute.ts`、`services/refund.ts`、`data/migrations/0028_affiliate_reward_reversal.sql`、`lib/payment/types.ts` |
| P0-定价-1 | 管理员定价写入在自己收款金额权威源上（真相源钉死后升级） | ✅ **已加固（2026-08-30，见 §1.9）**：写入路由加金额/积分/有效期上限 + 币种仅 USD + 积分≤金额。仍待办：事务化批量写入、双人复核 | `app/api/admin/payment-products/route.ts`、`__tests__/payment-products-guard.test.ts` |

---

## 4. 未完成项：P1 / P2 / P3

### P1（高优先级）

- [ ] **AI 请求幂等与状态机**：落地 `ai_requests`，按 `(user_uuid, request_id)` 隔离；同键不同请求体返回 422；补 24h 生命周期、崩溃补偿、退款 pending worker。见 `docs/13-ai-gateway.md`。
- [ ] **支付 webhook inbox 与每日对账**：所有渠道事件先持久化，再幂等处理；处理远端成功但本地失败、退款成功但积分回收为 0 等差异。见 `docs/03-database-schema.md` 中 `payment_events`。
- [x] **~~定价真相源统一~~（已关闭 2026-08-30，见 §1.9）**：运行时权威 = `payment_products`，`data/pricing.ts` 仅种子/回退；写入路由加不变量校验。剩余：事务化批量写入、双人复核（排产 N-6/P1 项）。
- [ ] **迁移发布机制补全**：为 `CONCURRENTLY` 索引和 expand-contract 建立专用部署过程/CI job（本批只完成了常规事务迁移）。
- [ ] **副作用执行模型**：邮件、埋点、告警不能裸 fire-and-forget；Vercel 场景使用 `after()`、critical 同步发送或 transactional outbox。

### P2（中优先级）

- [ ] 部分退款、多次退款与按批次积分回收规则。
- [ ] 争议 / 拒付的运营处理与举证导出。
- [ ] GDPR 删除覆盖 `op_events.subject_uuid` 与 `audit_logs` 中的个人数据。
- [ ] `payment_success` 邮件触发点改到真实 webhook 成功路径。
- [ ] Stripe 部署文档补 `charge.refunded` 订阅事件。
- [ ] `orders.expired_at` 从支付时刻计算，而不是下单时刻冻结。
- [ ] 数据备份加密、脱敏、保留周期与恢复演练。

### P3（工程与文档收口）

- [ ] 清理根目录 `README.md` / `DEVELOPMENT_PLAN.md` 中已删除 `docs/12` 的悬空链接。
- [ ] 统一文档章节编号及过时“已完成”标记。
- [ ] 明确 `/api/v1/*` 的 CORS / CSRF / Bearer API Key 防护矩阵。
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
6. **~~N-6 高风险操作强制理由~~（服务端+UI 已关闭，见 §1.12）**：纯代码部分完成。剩余归迁移批次：审批队列/双人复核（需新表）+ 管理员操作 outbox 持久化（依赖 N-4）。
7. **~~新 P1（advisors 扫描 2026-09-01）：public 其余表 RLS~~（已关闭，2026-09-01 连库）**：迁移 0024 对 public 全部 19 张业务表 ENABLE RLS（deny-all）+ REVOKE anon/authenticated 全部表权限（含 0023 资金四表补 REVOKE），anonymous_usage 两 RPC EXECUTE 仅授 service_role + search_path 钉死；连库验证 anon 直查全部 401、权限归零、应用关键路径回归通过。附带修复两个回归暴露的预存 bug：0025（verification_codes.code 列宽 VARCHAR(10)→64，SHA-256 哈希存不进去，注册/重置全挂）+ `consumeVerificationCode` update 未传 `{ count: "exact" }`（恒 return false）。见 §1.18。
8. **~~P0-1 剩余：credit_lots 批次账本 + 回收工作台~~（已关闭，2026-09-01 连库）**：迁移 0026 已应用（批次 FIFO 扣减 + 退款精确准入 + `settle_credit_debt` 清偿闭环）；回收工作台 `/admin/recovery` 上线（闭合 webhook 登记的退款 + 清偿债务 + 恢复账号）；真库 e2e 全链路（发放→消费→精确退款→债务→清偿）通过。见 §1.19。
9. **~~默认管理员恢复 + 强制改密闭环~~（已关闭，2026-09-02）**：迁移 0027 + getAdminUser/getUserInfo/console layout/requireAdmin 四处修复 + 浏览器 e2e 全链路通过。见 §1.20。
10. **~~N-13 剩余：联盟奖励冲销 + 争议收入确认~~（已关闭，2026-09-01 连库）**：迁移 0028 `private.reverse_affiliate_reward`（completed→reversed，幂等）+ `processRefund`/`dispute_lost` 接线 + my-invites reversed 状态；真库 e2e（冲销/幂等/anon 拒绝）通过；收入确认口径核实 stats 只计 paid。见 §1.21。
11. **Webhook inbox、对账、AI 请求状态机、outbox**：完成可靠副作用与支付/AI 崩溃补偿闭环。副作用调度已切 `after()`（见 §1.14），outbox 持久化重试仍需新表。

> 注意：每一批完成后要同步更新本文件、对应方案文档、测试和 `.workbuddy-ai/memory/2026-08-30.md`。不要把“有 UI / 有接口”误标为“生产就绪”。
> **当前债务优先级（下一步）**：N-4（outbox，after() 只是过渡）> N-6 剩余（审批队列，需新表）> P1（AI 请求状态机、webhook inbox/对账）。注：P0 全部关闭（P0-1/P0-2/P0-3/P0-4），N-1/N-2/N-3/N-5/N-13（含联盟奖励冲销）/public 表 RLS（0024）/迁移应用（0019–0028）均已关闭。

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

# 提交前自查清单（Pre-Commit Checklist）

> 每次提交/推送前按顺序过一遍。**全项通过才能 `git push`**。
> 本清单是项目的硬性工作流约束，配套规范见 `docs/boundary-spec.md`（密钥边界、支付/积分/RBAC 边界）与 `docs/README.md`（文档索引）。
> 维护方式：新增检查项时同步更新本文件；发现漏检事故（如 CI 挂了本地绿）就把「为什么漏」补进对应条目。

---

## 1. 密钥与敏感信息（红线，一票否决）

- [ ] `git diff --cached | grep` 扫描无真实密钥：数据库密码、`service_role` key（JWT 格式 eyJ 开头）、各渠道 webhook 签名密钥、`sk-` API key、私钥块（`BEGIN ... PRIVATE KEY`）
- [ ] `.env.local` / `.env*` 不在暂存区（`git diff --cached --name-only | grep env` 应为空）
- [ ] `.workbuddy-ai/` 不在暂存区（本地笔记，不入库也不删除）
- [ ] 无明文密码进仓库（默认管理员只允许哈希入库；README/docs 写默认凭据是用户批准的产品决策，除此之外一律禁止）
- [ ] 测试 / e2e 用过的真实数据已清理（数据库 e2e 行、临时账号、临时订单）

## 2. 构建与类型（与 CI 完全同命令）

- [ ] `npx tsc --noEmit` 通过 —— **必须用 `npx tsc` 而不是 `pnpm tsc`，且在所有代码（含测试文件）写完之后跑**。教训：`pnpm tsc` 与 CI 的 `npx tsc` 行为有差异，且写完测试只跑 vitest 不重跑 tsc，会导致 CI 挂而本地「绿」（2026-09-02 第十七批事故）
- [ ] `pnpm lint` 0 errors（既有 warnings 基线：124 个，不得新增 errors）

## 3. 测试

- [ ] **一键门禁：`pnpm gate`** —— 串联 e2e 数据清理 → `npx tsc --noEmit` → `pnpm test` → `pnpm lint` → **API 全量接口测试（本地 Supabase 栈）** → Playwright E2E 全链路（smoke + 注册/登录/登出/积分）→ 事后清理，全绿才 push。git 钩子已配置（`core.hooksPath=.githooks`，push 时自动跑；紧急跳过用 `git push --no-verify`）。**新机器克隆后需手动执行一次：`git config core.hooksPath .githooks && chmod +x .githooks/*`**
- [ ] `pnpm test` 全绿，并核对用例数不少于上一批基线（当前：57 文件 334 用例 + 3 skipped）
- [ ] 新增 DB 表/权限/迁移 → `__tests__/db-rbac-static.test.ts` 加静态断言（表结构 + RLS + REVOKE/GRANT 收口 + 调用点约束）
- [ ] 新增资金/幂等/状态机逻辑 → 有对应单测（supabase 链式桩模式参考 `__tests__/ai-request.test.ts` 的「from() 调用队列弹出」）
- [ ] 涉及既有行为变更（如路由改走审批/inbox 链）→ 同步适配既有测试，不留红

### E2E 补充说明（2026-09-03 起）

- 用例在 `e2e/`（Playwright，vitest include 不覆盖，互不干扰）；配置 `playwright.config.ts` 复用已跑的 dev server（localhost:3000），没跑会自动拉起
- E2E 写入的是 `.env.local` 指向的库，测试用户统一 `e2e-*@test.local` 前缀，`pnpm e2e:cleanup` 清理（含 credit_lots/affiliates/credits/orders/apikeys/notifications 关联表 + 验证码）
- 注册防刷限流（每 IP 日注册 5 个）是 dev server 内存级：本地反复跑 E2E 触发上限时重启 dev server 即可；CI 每次全新进程天然不受影响
- 本地库 `shipany_e2e`（本机 Homebrew Postgres）已验证 36 个迁移全量可跑（需先补建 Supabase 等价角色 anon/authenticated/service_role，见 git 历史批次记录）；E2E 全链路切到本地库需应用支持直连（当前 models 走 supabase-js REST），暂用 Supabase 测试项目 + e2e 前缀隔离

### API 测试补充说明（2026-09-04 起）

- 全量 HTTP 接口测试在 `api-tests/`（Playwright APIRequestContext，独立配置 `playwright.api.config.ts`，与 E2E 互不干扰）；覆盖全部 40 个路由方法，按功能分 8 组（public/auth/user/v1/admin/payment/cron/coverage），`pnpm api-test` 一键跑，报告落 `api-tests/output/report-summary.{md,json}`（分组成功率 + 每用例耗时/结果）
- **门禁要求 100% 通过**：gate.sh 与 CI（`ci.yml` 的 `api-test` job）都会跑；CI 该 job 已是合并闸口，报告以 artifact 留存 30 天。gate.sh 里若检测不到 Docker/本地栈会**警告并跳过**（不假装绿）——但新接口没进测试就是欠债，CI 那道闸口兜底
- **新增/修改接口必须**：在 `api-tests/suites/` 对应分组补用例，并在 `coverage.spec.ts` 的 COVERED 注册表登记 `METHOD /api/path`（注册表与实际路由不一致会直接红测，防止漏测）
- 前置依赖：Docker + `supabase start`（本地栈，端口 54321/54322）。测试全程离线跑真实业务逻辑（webhook 签名、资金 RPC、RBAC、限流都是真断言），`.env.api-test` 全部是本地假密钥，严禁换成真实密钥
- 方案/架构/本地栈与云的坑（service_role 授权、private schema、`supabase stop --no-backup` 会删数据卷）：见 `docs/18-api-testing.md`

## 4. 数据库迁移（若有）

- [ ] 迁移文件序号递增、命名规范（`00NN_描述.sql`），已 `pnpm migrate` 连库应用成功
- [ ] 新表：`ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated` + 仅授 `service_role`（表 + 序列）；参照 0024/0031/0032 模式
- [ ] 新 RPC/函数：迁 `private` schema 或 REVOKE/GRANT 成对；`SECURITY INVOKER` 函数必须同时授 service_role 表与序列权限
- [ ] 幂等键设计有明确注释（UNIQUE 作用域：全局/按用户/按渠道，为什么）
- [ ] `docs/03-database-schema.md` 迁移清单已追加该迁移

## 5. 真库 e2e（涉及 DB 行为变更时）

- [ ] 连库验证核心路径（用 `DATABASE_URL` + psql 或应用路由）
- [ ] 验证权限面：anon/authenticated 零权限、service_role 通路可达（用 `has_table_privilege()` / `has_sequence_privilege()`，不要只看 `information_schema.role_table_grants`——Supabase 默认 ACL 不显示在那里）
- [ ] **Supavisor 事务池（6543 端口）坑**：psql 里 `SET ROLE` 会泄漏到池化连接，后续会话粘成低权限。用完必须 `RESET ROLE`；发现「整个库突然没权限」先试 `RESET ROLE` 再慌
- [ ] e2e 数据清理（`DELETE ... WHERE` 精确条件 + 复查 count）

## 6. 文档同步（每批必做）

- [ ] `docs/IMPLEMENTATION-HANDOFF-2026-08-30.md`：新增 §1.NN 批次记录（缺口/实现/e2e/测试/验证/已知边界）+ §3/§4 勾选 + §5 优先级更新
- [ ] `docs/boundary-spec.md`：对应债务行（N-XX）更新状态
- [ ] `docs/03-database-schema.md`（迁移清单）及对应方案文档（05 支付 / 13 AI / 14 匿名试用等）
- [ ] `.workbuddy-ai/memory/当日.md` 追加批次笔记（不入库）

## 7. 提交与推送

- [ ] commit message 带模块与意图（`feat(module): ... (closes X-N)`）+ 正文 bullet 列要点
- [ ] 分支默认前缀 `codex/`（用户另有指定除外）；GitHub 仓库保持 private
- [ ] push 用本地代理：`https_proxy=http://127.0.0.1:12334 http_proxy=http://127.0.0.1:12334 git push origin master`
- [ ] **push 后确认 CI 转绿**：仓库有自动 CI（`.github/workflows/ci.yml`，push 即触发），用 `gh run watch <run-id> --repo Kaizen9588/my-shipany-template --exit-status` 或 `gh run list --limit 2` 确认；红了立即修复，不留红提交在 master

---

## 快捷命令

```bash
# 密钥扫描（staged diff；-f 选项见 grep 用法，命中需人工确认真伪）
git diff --cached | grep -iE "$(< docs/boundary-spec.md grep -o '密钥正则' 2>/dev/null)" 2>/dev/null || true
# 实际使用（把 <PATTERNS> 换成 boundary-spec「附：Push 前最小自查命令」里维护的正则）：
#   git diff --cached | grep -iE "<PATTERNS>" && echo "HIT(需人工确认)" || echo clean

# 类型检查（CI 同款命令）
npx tsc --noEmit

# 全量测试
pnpm test

# CI 状态
gh run list --repo Kaizen9588/my-shipany-template --limit 2
```

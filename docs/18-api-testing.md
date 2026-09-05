# 18 · API 接口自动化测试

> 覆盖 `app/api` 全部 40 个路由方法 / 59 条用例，本地离线跑，CI 卡点必过。
> 工具：Playwright API 测试模式（`APIRequestContext`，自带 cookie 罐）。

## 一、快速上手

```bash
# 前置（一次性）：Docker 运行时（OrbStack/Docker Desktop）+ Supabase CLI
supabase start -x studio   # 起本地 Supabase 栈（API 54321 / DB 54322）

pnpm api-test              # 全量接口测试（自动: db reset+seed → 起 3100 server → 跑 → 报告）
pnpm api-test:db-reset     # 单独重置测试库（truncate → migrate → seed）
pnpm api-test:routes       # 打印当前全部路由清单（用于更新守卫登记表）

# 只跑某一组
npx playwright test --config=playwright.api.config.ts suites/payment.spec.ts
```

报告产物（`api-tests/output/`，已 gitignore）：

| 文件 | 用途 |
|---|---|
| `report-summary.md` | 人读汇总：分组成功率表 + 每条用例耗时/结果/错误（CI 渲染进 Job Summary） |
| `report-summary.json` | 机器可读，供趋势系统/门户 |
| `junit.xml` | CI 平台消化 |
| `results.json` | Playwright 原始结果 |

## 二、架构

```
api-tests/
  helpers.ts             # 登录/注册/管理员激活 链式助手（CSRF→session）
  db-lifecycle.ts        # truncate + service_role GRANT + pnpm migrate + seed
  run-db-lifecycle.ts    # CLI 入口（pnpm api-test:db-reset）
  global-setup.ts        # Playwright globalSetup：跑 db-lifecycle
  summary-reporter.ts    # 自定义汇总 reporter（分组成功率/每用例耗时）
  suites/
    coverage.spec.ts     # ★ 覆盖防倒退守卫：app/api 全部路由必须登记
    public.spec.ts       # 无鉴权：health/ping/search/verify-code/metrics/...
    auth.spec.ts         # NextAuth：CSRF→登录→session→登出、失败分支
    user.spec.ts         # 登录态资源：profile/password/notifications/invite/avatar
    v1.spec.ts           # 对外 AI API：匿名额度、sk- key、幂等键、模型白名单
    admin.spec.ts        # RBAC 矩阵 + 全部管理接口主路径（审批单）
    payment.spec.ts      # checkout 分支 + 三渠道 webhook（签名/幂等/资金闭环）
    cron.spec.ts         # CRON_SECRET Bearer 鉴权
```

关键机制：

- **环境隔离**：`.env.api-test`（独立端口 3100、本地 Supabase 栈、无任何真实凭据），
  由 `scripts/test-server.mjs .env.api-test 3100` 注入后 spawn `next dev -p 3100`。
  与日常 dev(3000)、E2E(3101) 完全隔离，可离线跑。
- **干净库起步**：globalSetup 先 truncate 全表（RESTART IDENTITY CASCADE）→
  补 service_role 表权限（本地栈 DDL 走 postgres 角色，云端走 supabase_admin，权限
  不继承，见下「本地栈差异」）→ `pnpm migrate` 重放迁移找回种子（0027 默认管理员等，
  全幂等）→ 补 seed 用户/文章。
- **覆盖防倒退**：`coverage.spec.ts` 用 `find app/api -name route.ts` 提取
  「METHOD /api/path」清单，与登记表比对。**新增接口不写测试 = CI 红**；
  删接口不清理登记表也红。
- **无外呼**：webhook 签名本地构造（creem HMAC hex / stripe `t=..,v1=..`），
  AI 接口走「provider 未配置」的本地 500 分支，邮件走响应体降级通道。
  API 测试 100% 离线可跑，这是它能进 CI 挡门的前提。

## 三、流水线卡点

- **本地（pre-push，`.githooks/` → `scripts/gate.sh`）**：tsc → 单测 → lint →
  API 全量 → **db-reset（管理员状态复位，见下）** → E2E。supabase 栈未起时
  API 组自动跳过并提示（不会卡死 push）。门禁只访问本地资源，入口处显式
  清代理变量（钩子继承 `git push` 的代理时 dev server 编译外呼可能拖死
  webServer 探测，2026-09-05 实测两连挂后修复）。
  - **db-reset 交接的原因**：api-tests 的 `activatedAdmin` 把管理员密码激活为
    `ApiAdminNew123456`，e2e fixtures 只认自己激活的 `ApiTestAdmin123New`/临时
    密码两段——不复位则 e2e admin 组 13 条用例双密码不中 + 登录失败锁连锁挂。
    中间跑 `pnpm api-test:db-reset` 让管理员回到临时密码 + 未激活态。
- **CI（`.github/workflows/ci.yml`）**：`api-test` 与 `e2e-test` 两个 job 在
  `test`（tsc/单测/lint/build）之后跑——起一次性 Supabase 栈 →
  `scripts/gen-test-env.mjs` 运行时生成测试 env（env 文件不入库；supabase
  本地栈公开固定 key 从 `supabase status -o env` 取回映射，其余凭据按次随机）
  → api 组跑测试；e2e 组先 `pnpm migrate`（无 globalSetup，webServer 起来前
  必须建表 + bootstrap 管理员）→ `pnpm e2e` → 上传报告 artifact（30 天）→
  渲染 Job Summary。**在 GitHub 仓库设置里把两个测试 job 设为 required
  check，即实现「100% 通过才能 merge」**。

## 四、本地栈与云端 Supabase 的已知差异

1. **service_role 表权限**：云端 DDL 由 `supabase_admin` 执行、默认授权
   service_role；本地 `pnpm migrate`（postgres 角色）建的表不继承。`db-lifecycle.ts`
   幂等补 `GRANT ALL ... TO service_role`（云端重复执行无害）。
2. **private schema**：资金 RPC 走 `supabase-js .schema("private")`，要求 PostgREST
   暴露该 schema。`supabase/config.toml` 的 `api.schemas` 已加 `private`。
   注意：全新库首次 start 前需先以 public-only 起、`pnpm migrate` 建出 private、
   再切换并重启（REST 启动时 schema 不存在会 503）。
3. **`supabase stop --no-backup` 会删库卷**：日常用 `supabase stop`（带备份）。

## 五、写新用例的约定

- 命名：「`METHOD /api/path` 场景描述」，分组取 spec 文件名。
- 响应约定（`lib/resp.ts`）：成功 `{code:0, message:"ok", data}`；多数错误是
  **HTTP 200 + `{code:-1}`**（除显式传 status 的 401/403/413/429/500）。
- 一次性用户用时间戳邮箱（send-verification 每邮箱 60s 冷却、每 IP 30/min）；
  故意打错密码用一次性邮箱（登录锁定按邮箱计，5 次锁 15 分钟）。
- 全局内存限流（metrics 60/min 等）是进程级单例：一个 suite 内少打、别循环打。
- webhook 断言口径：`credits` 表是充值流水真源（`handle_order_payment` 写
  credits）；`credit_lots` 由 `grant_credit_lot` 单独维护，勿混用。
- 支付 webhook 后注意清理 `payment_events` / `anonymous_usage`
  （e2e-cleanup 不覆盖这两张表；API 测试有干净库起步，无历史包袱）。

## 六、报告契约与内网门户

报告由 `summary-reporter.ts` 单点生成，**API 与 E2E 共用**（E2E 经构造参数
`{ outDir: "../e2e-report-output", groupPrefix: "e2e:" }` 复用，见 playwright.config.ts）。
每次运行三份产物：

| 文件 | 角色 |
|---|---|
| `report-summary.json` | 机器契约：内网门户看板/趋势系统解析的唯一数据源 |
| `report-summary.md` | 人读原件：门户/CI Summary 直接展示，**不做结构化解析** |
| `junit.xml` | 通用格式：供后续第三方测试平台接入 |

**JSON 字段契约（schemaVersion=1）**：`schemaVersion` / `generatedAt` / `status`
/ `wallClockMs` / `total` / `passed` / `failed` / `successRate`(0-1) /
`groups[]{group,total,passed,failed,successRate,durationMs}` /
`entries[]{group,title,ok,durationMs,error?}`。
破坏性变更必须递增 `schemaVersion`（`summary-reporter.ts` 导出常量），消费方先看版本再解析。

**内网门户**（192.168.3.22:8686，nginx 静态容器，compose 在服务器 `~/apps/test-portal/`）：

- 导航：首页项目卡片**内嵌 API / E2E 两个入口行**（各带最新状态徽章与时间，
  点击直达对应类型页；卡片头大数字取 API 最新，无 API 时退 E2E）→
  类型页（最新摘要 + 历史列表，默认 20 条，「更多历史记录」翻页）→
  单次运行用例明细；浏览器前进/后退可用。
  E2E 组名带 `e2e:` 前缀（e2e:auth / e2e:smoke），与 API 组区分
- 数据落点（`<type>` 为 `api` / `e2e`）：
  - `~/reports/current/<project>/<type>/` 门户"最新一次"读这里
  - `~/reports/history/<project>/<type>/<时间戳>/` 历史运行（列表由 nginx
    autoindex JSON 直接输出，无索引文件，不会与数据失同步）
- 推送：`scripts/push-test-report.sh`（gate.sh 第 7 步自动调，api + e2e 各推一次；
  手动跑法：`./scripts/push-test-report.sh` 推 API，`TEST_REPORT_TYPE=e2e` 推 E2E，
  产物目录随类型自动切换）——**尽力而为**，服务器不可达或
  scp 失败只警告，绝不阻塞门禁
- 门户部署/更新：`./scripts/deploy-test-portal.sh`（幂等，同步门户三件套 +
  `docker compose up -d --force-recreate`——bind-mount 单文件被替换后 inode
  变化，必须重建容器才读到新内容；首次跑会顺带建 `~/reports/` 目录树）
- 一站式入口：`./scripts/run-all-tests.sh`——不带提交门禁的「跑测试 + 推报告」：
  `--skip-api` / `--skip-e2e` 跳过某类，`--push-only` 只推现有报告，
  `--no-push` 只跑测试。自动处理 e2e 数据清理，supabase 栈没起会尝试拉起。
  与 gate.sh 的分工：gate 带全量质量检查（tsc/单测/lint）且 push 自动触发；
  本脚本只要新鲜报告，随时手动跑
- 项目注册：门户页 `PROJECTS` 数组加一行 + 推送到对应目录即接入
- CI（GitHub 托管 runner）在内网之外够不到服务器，其报告暂存 GitHub artifact（30 天）；
  以后自建 runner 或加穿透后可同样推 `current/`

## 七、E2E 端到端测试（本地库）

```bash
pnpm e2e          # 起 3101 server（.env.e2e-test）→ 跑 e2e/ 全部用例 → 汇总报告
pnpm e2e:cleanup  # 删除全部 e2e-* 测试用户及关联数据（跑完巡检/清理）
pnpm e2e:server   # 单独起 E2E 专用 dev server（不跑用例）
```

- **独立环境**：`.env.e2e-test`（gitignore，端口 3101）连**同一个本地 Supabase 栈**
  （54321/54322），与 `.env.local`（云测试项目）完全隔离——E2E 注册/登录写的
  用户、积分全部落在本地库，绝不碰线上或云上数据。webServer 由
  `scripts/test-server.mjs` 拉起，env 文件缺失直接拒绝启动；
  `reuseExistingServer: false` 防止误连日常 dev server。
- **报告**：复用 `summary-reporter.ts`（`outDir: ../e2e-report-output`、
  组名 `e2e:` 前缀）+ junit.xml，同 schemaVersion=1 契约。
- **数据清理**：跑完 `pnpm e2e:cleanup`（自动读 `.env.e2e-test` 的
  DATABASE_URL，文件缺失退回 `.env.local` 兼容旧流程），删除 e2e-* 用户及其
  credits/orders/apikeys/notifications/affiliates/credit_lots 与验证码。
- **依赖的开发期设计**：RESEND_API_KEY 未配置时验证码走响应体降级通道
  （生产不可用，E2E 只在 dev/测试环境跑）。
- gate.sh 在 E2E 跑过后自动以 `TEST_REPORT_TYPE=e2e` 推报告到内网门户。

### 7.1 用例覆盖（2026-09-05 空库冷启动全绿：61 用例 / 6 组，无跳过）

| 组（文件） | 数量 | 覆盖点 |
|---|---|---|
| `e2e/landing.spec.ts` | 13 | header 导航（logo/锚点/Showcase 子菜单/CTA）、主题切换、中英切换、cookie 横幅（Reject/Customise）、FAQ 网格 + benefit 手风琴、定价三档卡片、未登录点购买弹登录框、页脚法务链接、博客列表 |
| `e2e/auth.spec.ts` | 3 | 注册全链路（发码→验证→自动登录→送 10 积分）、登出、登录态见余额 |
| `e2e/auth-extended.spec.ts` | 9 | 登录弹窗分支（ESC 关闭/模式切换保邮箱/空邮箱/错密码/非法邮箱/弱密码）、独立 signin 页渲染/登录成功/已登录弹回 |
| `e2e/console.spec.ts` | 16 | 7 条受保护路由守卫、侧边栏 7 项逐一可达、API Key 创建全流程、充值弹窗（三档 + 无支付渠道 toast）、邀请码设置弹窗、Settings（只读邮箱/改昵称/Delete confirm）、通知/订单/订阅/Usage、头像菜单三项 |
| `e2e/admin.spec.ts` | 15 | 后台守卫（普通用户/未激活管理员）、侧边栏 12 入口、用户搜索、用户详情三大操作（积分调整/角色变更/封禁，审批单落库 + 单管理员自动执行）、HTML 校验拦截、审批队列/定价映射/文章管理/7 页可达、登出 |
| `e2e/smoke.spec.ts` | 5 | health/API/landing/pricing/console/admin 基础可达性 |

- **fixtures（e2e/fixtures.ts）**：`signedInPage`（seed-user）/`adminPage`
  （bootstrap 管理员自动激活：先用「临时密码+New」登录，失败则临时密码登录
  → 改密激活，幂等）。`.env.e2e-test` 故意不配 `ADMIN_BOOTSTRAP_*`，避免
  E2E server 启动覆盖管理员密码状态；跨套件的密码态由两分支兜底。
- **选择器约定（踩坑沉淀）**：
  - `getByRole("link", { name })` 是**子串匹配**——「管理」会命中侧边栏
    「用户管理」，必须用表格行作用域（`getByRole("row")`）收窄；
  - `getByText` 容易撞 heading + toast 同名双元素，标题类断言用
    `getByRole("heading")`；
  - 客户端导航注水期间 DOM 会出现**瞬态双份内容**（约 1s 内收敛），紧跟
    导航的交互前先等 `toHaveCount(1)` 收敛，否则 strict mode 报错；
  - landing 没有语义 `<header>`（右上角图标在 nav 里）、`#footer` 无
    contentinfo role、FAQ 区块是静态网格而非手风琴——选择器以真实 DOM 为准，
    不按语义惯例猜。
- **reporter skipped 计数**：`summary-reporter.ts` 把 `skipped` 排除在
  通过率分母外（管理员未激活分支在已激活库上常态跳过），全绿 = 60/60。

## 八、维护

- 改接口 → 跑 `pnpm api-test:routes`，同步 `coverage.spec.ts` 登记表 + 补用例。
- 新增分组 → 建对应 `suites/<group>.spec.ts`，reporter 自动归组。
- 多项目复用：整体拷 `api-tests/` + `playwright.api.config.ts` +
  `.env.api-test` 模板 + `scripts/test-server.mjs` + ci.yml 的 `api-test` job。
- 服务器统一 Docker 管理约定：长驻服务一律「一个项目一个目录一个 compose」
  放 `~/apps/<名>/`，数据 bind-mount 到 `~/` 明确路径，端口集中记录。

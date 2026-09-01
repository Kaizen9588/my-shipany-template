# 部署文档

## 1. 部署方式对比

| 方式 | 推荐度 | 说明 |
|------|--------|------|
| Vercel | ⭐⭐⭐⭐⭐ | 首选，Next.js 原生支持，零配置 |
| Cloudflare Workers | ⭐⭐⭐ | 备选，需 @cloudflare/next-on-pages |
| Docker | ⭐⭐⭐⭐ | 自托管，output: standalone |

## 2. Vercel 部署（推荐）

### 2.1 前置条件

- Vercel 账号
- GitHub 仓库（已 Fork 到 Kaizen9588/my-shipany-template）
- Supabase 项目（已执行 `data/install.sql` 建表，迁移 0000-0017 部署时自动应用，见 §5.2.1）
- Google OAuth 凭据（如需 Google 登录）
- GitHub OAuth 凭据（如需 GitHub 登录）
- 支付渠道账号（按需）：Stripe / Creem / Waffo（多渠道架构见 [payment/provider-abstraction.md](./payment/provider-abstraction.md)）

> ⚠️ **P1-6（第九轮，2026-08-26）——建库路径三处并存，本文件是唯一的离群且最权威入口**：本文件在 §2.1、§5.2.1、§5.2.2 三处仍要求先手工执行
> `data/install.sql`（并写「顺序硬约束：必须先跑 install.sql 再让迁移跑起来」）。这条硬约束的理由本身已过期——基础表由
> `0000_install_base.sql` 创建（7 表），0004 的依赖天然由迁移序列满足；而 `docs/03 §概述` 明写 `install.sql`「与迁移基线存在出入，勿再参考」。
> README 又给了第三条路径（从 0000 起逐条粘贴）。按本文字面推演最可能是首次启动 `relation already exists` 崩溃。
> **修法**：统一为「空库 → 只跑 `data/migrations/*`，0000 即基线」；`data/install.sql` 移入 `legacy/` 并标废弃；
> `lib/migrate.ts` 加基线断言（`schema_migrations` 为空但 `users` 已存在 → fail-fast）；三处建库说明只保留一处，其余改链接。

### 2.2 部署步骤

1. **连接仓库**：
   - Vercel Dashboard -> New Project -> Import `Kaizen9588/my-shipany-template`
   - Framework Preset: Next.js（自动检测）
   - Build Command: `next build`（默认）
   - Output Directory: `.next`（默认）

2. **环境变量配置**：
   在 Vercel Project Settings -> Environment Variables 中配置（参见 [08-config-env.md](./08-config-env.md)）

3. **部署**：
   - Push 代码到 GitHub -> Vercel 自动部署
   - 或手动触发：Vercel Dashboard -> Redeploy

### 2.3 Vercel 配置

项目已包含 `vercel.json`：

```json
{
  "functions": {
    "app/api/**/*": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/daily",
      "schedule": "0 2 * * *"
    }
  ]
}
```

- API 路由最大执行时间 60 秒（适用于 AI 生成等长耗时操作）
- Vercel Hobby 计划最大 60 秒，Pro 计划最大 300 秒
- `crons`：每日 02:00 UTC 触发 `/api/cron/daily`（订单过期/验证码清理/匿名用量清理/备份），
  这也是 `CRON_SECRET` 生产必填的触发源（2.13 fail-fast）

### 2.4 output: standalone 说明

`next.config.mjs` 使用**条件 standalone**（P-1.6 修复）：仅当构建时设置 `NEXT_OUTPUT=standalone` 才启用 `output: "standalone"`。

```bash
NEXT_OUTPUT=standalone pnpm build   # 生成 standalone 输出（Docker 用）
pnpm build                          # 默认不启用（Vercel / next start 兼容）
```

**影响**：
- `next start` 与 Vercel 部署不再冲突（默认不启用 standalone）
- Docker 构建命令已内置 `NEXT_OUTPUT=standalone`；standalone 产物被复制到镜像 `/app` 根目录，启动命令为 `CMD ["node", "server.js"]`
- Dockerfile 中的 `RUN NEXT_OUTPUT=standalone pnpm build` 已处理

### 2.5 Stripe Webhook 配置

1. Stripe Dashboard -> Developers -> Webhooks -> Add Endpoint
2. URL: `https://your-domain.com/api/stripe-notify`
3. Events: `checkout.session.completed` + `charge.refunded`
4. 复制 Signing Secret 到环境变量 `STRIPE_WEBHOOK_SECRET`

> ⚠️ **P2-C（第十轮对抗式审查，2026-08-26）——订阅清单必须与代码处理清单同步**：
> 本节原先只订阅 `checkout.session.completed`，与 docs/02 §3、stripe-integration §2.3 已标 ✅ 的
> `charge.refunded`（6.21 已实现处理逻辑）不一致。按旧文字面配置的生产站：渠道侧（含 Dashboard 手动）退款
> 不会触发回调 → 本地订单不置 refunded、积分不扣回，退款同步**整体失效**且只有 No-Go 清单里的每日对账才能兜住。
> **维护规则**：凡 [stripe-integration §2.3](./payment/stripe-integration.md) 事件白名单新增条目，本节第 3 步同步更新；
> 后续接入争议事件时同样加在这里（`charge.dispute.created` / `charge.dispute.closed`，见第九轮 P2-2）。

### 2.6 Creem 配置

1. 注册 Creem：https://creem.io，在 Dashboard 预建产品（获取 `product_id`）
2. 获取 API Key（Dashboard > Developers）
3. Webhook URL: `https://your-domain.com/api/creem-notify`
4. 环境变量：`CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`；`payment_products` 表填 `creem_product_id`
5. 详见 [creem-integration.md](./payment/creem-integration.md)

### 2.7 Waffo 配置

1. 注册 Waffo：https://pancake.waffo.ai/merchant/auth/signin，完成 KYC/KYB
2. Integration 菜单：获取 API Key + merchantId；生成 RSA 密钥对（公钥上传 Waffo，私钥自己保存）
3. Webhook URL: `https://your-domain.com/api/waffo-notify`
4. 环境变量：`WAFFO_API_KEY`、`WAFFO_PRIVATE_KEY`、`WAFFO_PUBLIC_KEY`、`WAFFO_MERCHANT_ID`
5. 详见 [waffo-integration.md](./payment/waffo-integration.md)（含 Sandbox 测试）

## 3. Cloudflare Workers 部署

### 3.1 配置文件

项目已包含 `wrangler.toml.example`，复制为 `wrangler.toml` 并填写环境变量。

### 3.2 部署命令

```bash
# 构建
pnpm cf:build    # npx @cloudflare/next-on-pages

# 预览
pnpm cf:preview  # wrangler pages dev

# 部署
pnpm cf:deploy   # wrangler pages deploy
```

### 3.3 已知限制

| 项 | 说明 |
|----|------|
| @cloudflare/next-on-pages | 可能不支持 Next.js 16，需验证 |
| Node.js API | 部分 Node.js API 在 Workers 中不可用 |
| 文件系统 | 无持久文件系统，S3 存储必须使用外部服务 |
| 执行时间 | Workers 有 CPU 时间限制 |

## 4. Docker 部署

### 4.1 Dockerfile

项目已包含 `Dockerfile`，基于 standalone 输出：

```bash
# 构建镜像
pnpm docker:build
# 等同于: docker build -f Dockerfile -t my-shipany-template:latest .

# 运行容器
docker run -p 3000:3000 \
  -e SUPABASE_URL=... \
  -e SUPABASE_ANON_KEY=... \
  -e AUTH_SECRET=... \
  my-shipany-template:latest
```

### 4.2 Docker 注意事项

- 镜像基于 standalone 输出，体积较小
- 需通过环境变量传入所有配置
- 建议配合 Docker Compose 管理

## 5. 本地开发

### 5.1 环境准备

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入实际值

# 3. 启动开发服务器
pnpm dev
# 或: npx next dev -p 3000
```

### 5.2 Supabase 数据库配置

#### 5.2.1 云端项目（生产/联调）

1. 创建 Supabase 项目：https://supabase.com
2. 获取连接信息填入部署环境变量：
   - Settings -> API -> Project URL -> `SUPABASE_URL`
   - Settings -> API -> anon public -> `SUPABASE_ANON_KEY`
   - Settings -> API -> service_role -> `SUPABASE_SERVICE_ROLE_KEY`
   - Settings -> Database -> Connection string（pooler/transaction 模式）-> `DATABASE_URL`
3. **在部署发布应用实例之前执行** `pnpm migrate`。该命令从 `data/migrations/0000` 开始建库、记录 `schema_migrations` 版本，并在同一事务中持有 advisory lock；失败会整体回滚。
4. 仅当迁移成功后再启动或扩容应用。`instrumentation.ts` 只读检查版本，发现任何 pending migration 会拒绝服务启动，绝不在冷启动时执行 DDL。

> **唯一建库路径**：空库只运行 `pnpm migrate`。禁止执行 `data/install.sql`，也禁止手工粘贴单个迁移。若迁移器发现已有 `users` 表但没有 `schema_migrations`，会 fail-fast，防止两条建库路径混用。

> **发布顺序（P1-7）**：先以单个受控 job 运行 `pnpm migrate`，再发布应用实例；回滚应用代码不得回滚已经提交的 schema。新增破坏性字段/约束时采用 expand-contract 两次发布。普通迁移在事务中串行化；需要 `CREATE INDEX CONCURRENTLY` 的未来大表索引必须拆为专用、非事务迁移 job，不能混入当前迁移器。
>
> ✅ **P0-3 已关闭（2026-08-30，2026-09-02 调整口径）**：迁移 0012 不再写入任何管理员；历史固定默认账号由迁移 0019
> 识别其原始 hash 后禁用。迁移 0027 恢复**内置默认管理员** `admin@shipany.local`（初始密码 `123456`，仅 bcrypt
> 哈希入库，明文不进仓库/迁移文件），状态 `pending_activation` + `must_change_password`：可登录但只能进入
> `/change-password`，改密前 `requireAdmin` 拒绝一切后台 API，改密成功自动转 `active`。不需要时按 0027 末尾注释
> 删除或禁用。另保留 `ADMIN_BOOTSTRAP_EMAIL` 显式引导：创建一次 `status='pending_activation'` 的超级管理员，
> 密码优先取 `ADMIN_BOOTSTRAP_PASSWORD`，未设置时生成随机临时密码并仅写入受限启动日志。
> 首次强制改密成功后账号自动转为 `active`。完整边界见 boundary-spec §二/§九。

#### 5.2.2 本地 Supabase（本地开发，Docker 或 CLI 二选一）

**前置**：Docker Desktop（OrbStack 等兼容 runtime 均可），项目端口 54322(Postgres)/54323(Studio)。

方式 A：**Supabase CLI**（推荐，一条命令起全套，自带 Studio 管理界面）：

```bash
brew install supabase/tap/supabase    # 或 npm i -g supabase
supabase init                          # 项目根目录，生成 supabase/config.toml（已有则跳过）
supabase start                         # 拉起本地全套（Postgres/Studio/Auth 等）
# 完成后输出本地凭据，填入 .env.local：
#   SUPABASE_URL=http://127.0.0.1:54321
#   SUPABASE_ANON_KEY=<输出的 anon key>
#   SUPABASE_SERVICE_ROLE_KEY=<输出的 service_role key>
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
supabase stop                          # 停止（数据保留在 ./supabase/）
supabase stop --no-backup              # 停止并清空本地数据
```

方式 B：**纯 Docker**（serverless 模式，无 CLI 依赖）：

```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml
curl -o .env.docker https://raw.githubusercontent.com/supabase/supabase/master/docker/.env.example
# 编辑 .env.docker 生成 POSTGRES_PASSWORD/JWT_SECRET 等，然后：
docker compose up -d
# 凭据以 .env.docker 中实际值为准（默认 postgres/54322）
```

**选择建议**：日常开发用 CLI（`supabase start/stop` 简单、Studio 可视化看表）；
仅想跑个 Postgres 验证迁移时，甚至可以 `docker run -d -p 54322:5432 -e POSTGRES_PASSWORD=postgres postgres:17`
再用 `DATABASE_URL` 指过去执行 `pnpm migrate`（项目不依赖 Supabase 专属扩展，
全部表结构均由迁移 0000 起创建）。

**建表**：本地库与云端一样，配置 `DATABASE_URL` 后执行一次 `pnpm migrate`；`pnpm dev` 只校验迁移版本，不会自动建表。

**注意**：本地 Auth（邮件验证码/OAuth 回调）需要额外配置回调地址，本地开发通常只测
数据库 + 支付链路，OAuth 登录用云端项目更省事。

### 5.3 Google OAuth 配置

1. Google Cloud Console -> APIs & Services -> Credentials
2. Create OAuth 2.0 Client ID
3. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`（开发）
   - `https://your-domain.com/api/auth/callback/google`（生产）
4. 填入 `.env.local`：
   - `AUTH_GOOGLE_ID` = Client ID
   - `AUTH_GOOGLE_SECRET` = Client Secret
   - `NEXT_PUBLIC_AUTH_GOOGLE_ID` = Client ID
   - `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` = `true`

### 5.4 GitHub OAuth 配置

1. GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App
2. Authorization callback URL:
   - `http://localhost:3000/api/auth/callback/github`
3. 填入 `.env.local`：
   - `AUTH_GITHUB_ID` = Client ID
   - `AUTH_GITHUB_SECRET` = Client Secret
   - `NEXT_PUBLIC_AUTH_GITHUB_ENABLED` = `true`

### 5.5 Stripe 本地 Webhook 测试

```bash
# 安装 Stripe CLI
brew install stripe/stripe-cli/stripe

# 登录
stripe login

# 转发 Webhook 到本地
stripe listen --forward-to localhost:3000/api/stripe-notify

# 复制 webhook signing secret 到 .env.local
# STRIPE_WEBHOOK_SECRET=whsec_...
```

> Creem / Waffo 的本地测试：两者无官方 CLI 转发工具，用 ngrok 等内网穿透工具将本地端点暴露到公网后，在各自 Dashboard 配置测试 Webhook。Waffo Sandbox 测试步骤见 [waffo-integration.md](./payment/waffo-integration.md)。

### 5.6 已知问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `next dev` 在沙箱中 EMFILE 循环重启 | 文件描述符限制 | 用户本地终端运行不受影响；沙箱内用 `next build && next start` |
| npm EPERM 错误 | root-owned cache files | `npm install --cache /tmp/npm-cache` 或 `sudo chown -R 501:20 ~/.npm` |
| 端口 3000 被占用 | 旧进程未退出 | `lsof -ti:3000 | xargs kill -9` |
| 生产冷启动种入默认弱口令 | 迁移 0012 无条件创建 `admin@shipany.local/123456` | 条件建号 + 随机密码 + pending_activation + 生产不建号（P0-3，见 §5.2.1 与 boundary-spec §九）；2026-09-02 起默认管理员恢复但哈希入库 + pending_activation + 强制改密（0027），公开凭据只能进一次性改密流程 |

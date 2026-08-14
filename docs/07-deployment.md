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
- Supabase 项目（已执行 `data/install.sql` 建表）
- Google OAuth 凭据（如需 Google 登录）
- GitHub OAuth 凭据（如需 GitHub 登录）
- Stripe 账号（如需支付）

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
  }
}
```

- API 路由最大执行时间 60 秒（适用于 AI 生成等长耗时操作）
- Vercel Hobby 计划最大 60 秒，Pro 计划最大 300 秒

### 2.4 output: standalone 说明

`next.config.mjs` 中配置了 `output: "standalone"`，这会生成独立的 Node.js 服务器。

**影响**：
- `next start` 会警告不兼容 standalone 模式
- Vercel 部署不受影响（Vercel 自动处理）
- Docker 部署使用 `node .next/standalone/server.js`

### 2.5 Stripe Webhook 配置

1. Stripe Dashboard -> Developers -> Webhooks -> Add Endpoint
2. URL: `https://your-domain.com/api/stripe-notify`
3. Events: `checkout.session.completed`
4. 复制 Signing Secret 到环境变量 `STRIPE_WEBHOOK_SECRET`

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

### 5.2 Supabase 本地配置

1. 创建 Supabase 项目：https://supabase.com
2. 在 SQL Editor 中执行 `data/install.sql`
3. 获取 URL 和 Key：
   - Settings -> API -> Project URL -> `SUPABASE_URL`
   - Settings -> API -> anon public -> `SUPABASE_ANON_KEY`
   - Settings -> API -> service_role -> `SUPABASE_SERVICE_ROLE_KEY`

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

### 5.6 已知问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `next dev` 在沙箱中 EMFILE 循环重启 | 文件描述符限制 | 用户本地终端运行不受影响；沙箱内用 `next build && next start` |
| npm EPERM 错误 | root-owned cache files | `npm install --cache /tmp/npm-cache` 或 `sudo chown -R 501:20 ~/.npm` |
| 端口 3000 被占用 | 旧进程未退出 | `lsof -ti:3001 | xargs kill -9` |

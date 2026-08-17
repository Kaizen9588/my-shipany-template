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
| Docker 构建镜像不得包含 `.env*` | 🚧 docs/12 §2.17 | `.dockerignore` 应排除 `.env*`（保留 `.env.example`），避免镜像历史层泄露 |
| Push 前必须先自查 staged diff | ✅ 本次已执行 | `git diff --cached` 扫描 `sk-*` / `AKIA*` / 私钥块 / 真实 `password=` 等；并确认 `.env.local` 不在 `git status` |

---

## 二、密钥与敏感数据安全边界

| 规则 | 状态 |
|---|---|
| `.env.*` 只给服务端读；`NEXT_PUBLIC_*` 只放公开数据（URL、开关、分析 ID） | ✅ docs/12 §61 |
| API 返回给客户端禁止带 `password_hash`、`password_updated_at`、`signin_ip`、`signin_openid`、OAuth token、支付密钥 | ✅ `toSafeUser()` 白名单出口 |
| 用户 API Key 存 SHA-256 hash，创建时只展示一次明文 | ✅ 已落地 |
| 邮箱验证码不应明文存库；应存 hash 并定期清理过期记录 | 🚧 docs/12 待办 |
| `AUTH_SECRET` 必须由部署者自己生成，禁止共用默认示例值 | ✅ `.env.example` 已置空 + 文档说明 |
| 数据库迁移不能写真实生产密钥；默认管理员 `123456` 仅作模板初始化并要求首次强制改密 | ✅ 已落地 |
| 告警 webhook 可存 `system_settings`，但页面不回显完整 secret | ✅ 当前 FE 不回显密钥 |

---

## 三、API / 业务边界（越权与资金风险）

| 边界 | 状态 |
|---|---|
| 后台必须是管理员才能访问，非管理员一律 403 | ✅ `requireAdmin()` |
| 管理员分级：operator/admin/super_admin；operator 不能自我提权、不能授 super_admin | 🚧 docs/12 §2.7（P1 待办） |
| 被封禁的管理员不能继续操作后台 | 🚧 docs/12 §2.7（P1 待办） |
| 支付金额/定价只信服务端，客户端传的价格一律忽略 | ✅ `data/pricing.ts` 服务端单一真相源 |
| 支付回调必须验签；金额/币种必须比对，不匹配不充值并告警 | ✅ 已落地 |
| 积分扣减必须事务 + 行锁 + 余额校验，不能透支 | ✅ 已落地 |
| 退款必须幂等，不能重复扣回积分 | ✅ 已落地 |
| Webhook 签名非法应告警 | 🚧 `payment.webhook_invalid_signature` 为「预留」事件 |
| AI 网关：鉴权 → 限流 → 402 → 原子扣费 → 失败退款 | ✅ 已落地 |
| 匿名试用限流：IP + 设备指纹双维度防刷 | ✅ 已落地 |
| CORS 白名单、CSRF、安全响应头 | ✅ 已落地 |
| CSP / HSTS | 🚧 docs/12 §2.18 待办 |

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
| `NEXT_PUBLIC_*` 数量克制，服务端 secret 不进客户端 bundle | ✅ |
| 单测、`tsc`、`pnpm build`、lint 通过后才能提交 | ✅ 当前 37 文件 / 147 用例 |
| 改 Next.js 相关代码前先读 `node_modules/next/dist/docs/` | ✅ AGENTS.md |

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-doc -->

# 项目边界与文档入口（adversarial review round7 补全）

本仓库是 AI SaaS 模板。进入项目后请先读这些文件再动手：

- `docs/README.md` —— 全量方案文档索引（架构/API/数据库/支付/安全/部署/边界）
- `docs/boundary-spec.md` —— **边界与安全规范**（禁止提交什么、密钥边界、支付/积分/后台 RBAC 边界、Git 工作流）
- `README.md` —— 项目命令与快速上手（本地 3000 端口、默认管理员账号）

常用命令：
- `pnpm dev`（本地 3000 端口，占用则先清端口进程）
- `pnpm test` / `pnpm lint` / `pnpm tsc --noEmit`
- `pnpm migrate`（DATABASE_URL 驱动，启动时自动执行）
- `pnpm build`

提交前必须自查 staged diff：禁止出现真实密钥/API key/私钥块/`.env.local`。

<!-- END:project-doc -->

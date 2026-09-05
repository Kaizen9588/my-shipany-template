#!/bin/zsh
# push 前质量门禁：单测 + 类型检查 + lint + E2E 全链路
# 用法：pnpm gate（手动跑）；git push 时经 pre-push 钩子自动跑（core.hooksPath=.githooks）
set -e
cd "$(dirname "$0")/.."

# 门禁全链路只访问本地资源（本地 Supabase 栈 / 3100·3101 dev server / 内网门户）。
# pre-push 钩子继承 git push 的代理环境变量时，dev server 首次编译的外呼
# （next/font 等）可能被代理拖住导致 webServer URL 探测超时（Ready 但探测不通）。
# 这里显式清掉代理变量并对 localhost 声明直连，保证门禁与代理环境解耦。
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY 2>/dev/null
export NO_PROXY="localhost,127.0.0.1"
export no_proxy="localhost,127.0.0.1"

FAIL=0

step() { echo "\n━━━ $1 ━━━"; }

# 0. E2E 前置：清理上次遗留的 e2e 测试数据（用户+关联表+验证码）
step "e2e data cleanup (pre)"
node --experimental-strip-types scripts/e2e-cleanup.ts || true

# 1. 类型检查（CI 同款命令，PRE-COMMIT-CHECKLIST §2 硬性要求 npx 而非 pnpm）
step "type check (npx tsc --noEmit)"
npx tsc --noEmit || FAIL=1

# 2. 单测（vitest）
step "unit tests (vitest)"
pnpm test || FAIL=1

# 3. lint（0 errors 才算过，warnings 有基线）
step "lint"
pnpm lint || FAIL=1

# 4. API 接口测试（本地 Supabase 栈 + 独立 3100 端口，全量必须过）
#    前置：docker 在跑（OrbStack/Docker Desktop）+ supabase start 已执行
API_TESTS_RAN=0
if docker info >/dev/null 2>&1 && supabase status >/dev/null 2>&1; then
  step "api tests (all routes)"
  npx playwright test --config=playwright.api.config.ts || FAIL=1
  API_TESTS_RAN=1
else
  echo "⚠ supabase 本地栈未就绪（docker info / supabase status 失败），跳过 API 测试"
  echo "  完整门禁请先: supabase start -x studio"
fi

# 4.5 管理员状态复位（api-test → e2e 交接）：
#     api-test 的 activatedAdmin 会把管理员密码激活为 ApiAdminNew123456，
#     而 e2e fixtures 只认自己激活的 ApiTestAdmin123New / 临时密码两段——
#     中间跑一次 db-reset（truncate + seed + migrate → 管理员回到临时密码 +
#     未激活态），e2e 的激活回退分支才能确定性接管，否则 13 条 admin 用例
#     因双密码不中 + 登录失败锁连锁挂掉
if [ $API_TESTS_RAN -eq 1 ]; then
  step "admin state reset (api-test → e2e handoff)"
  pnpm api-test:db-reset || FAIL=1
fi

# 5. E2E（独立 3101 server + .env.e2e-test 本地 Supabase 栈，与 dev/云端隔离）
step "e2e (playwright, local db)"
npx playwright test || FAIL=1
E2E_TESTS_RAN=1

# 6. E2E 后置清理：不留测试数据
step "e2e data cleanup (post)"
node --experimental-strip-types scripts/e2e-cleanup.ts || true

# 7. 推送测试报告到内网门户（尽力而为：服务器不可达/推送失败都不阻塞门禁）
if [ $API_TESTS_RAN -eq 1 ]; then
  step "push api test report to portal"
  ./scripts/push-test-report.sh || true
fi
if [ "${E2E_TESTS_RAN:-0}" -eq 1 ]; then
  step "push e2e test report to portal"
  TEST_REPORT_TYPE=e2e ./scripts/push-test-report.sh || true
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ gate passed — all checks green"
else
  echo "❌ gate FAILED — fix the red items before push"
  exit 1
fi

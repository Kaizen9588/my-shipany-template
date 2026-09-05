#!/bin/zsh
# push 前质量门禁：单测 + 类型检查 + lint + E2E 全链路
# 用法：pnpm gate（手动跑）；git push 时经 pre-push 钩子自动跑（core.hooksPath=.githooks）
set -e
cd "$(dirname "$0")/.."

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

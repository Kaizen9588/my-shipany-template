#!/usr/bin/env bash
# run-all-tests.sh —— 「跑测试 + 推报告」一站式脚本（不带提交门禁）
#
# 与 gate.sh 的分工：
#   gate.sh：push 前门禁，tsc/单测/lint + 测试，全绿才放行
#   本脚本：只要新鲜报告。可跳过某类测试、可只推已有报告，随时手动跑
#
# 用法：
#   ./scripts/run-all-tests.sh              # API + E2E 全跑 + 推报告
#   ./scripts/run-all-tests.sh --skip-api   # 只跑 E2E
#   ./scripts/run-all-tests.sh --skip-e2e   # 只跑 API
#   ./scripts/run-all-tests.sh --push-only  # 不跑测试，只把上次报告推到门户
#   ./scripts/run-all-tests.sh --no-push    # 跑测试但不推报告
#
# 推送原则：只推「本轮新跑出来的」报告，跳过的类型不把旧报告重推冒充新报告
#（--push-only 例外：它就是明确要推现有产物）。
set -uo pipefail
cd "$(dirname "$0")/.."

RUN_API=1 RUN_E2E=1 PUSH=1 PUSH_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-api)  RUN_API=0 ;;
    --skip-e2e)  RUN_E2E=0 ;;
    --push-only) PUSH_ONLY=1; RUN_API=0; RUN_E2E=0 ;;
    --no-push)   PUSH=0 ;;
    *) echo "未知参数：$arg（支持 --skip-api / --skip-e2e / --push-only / --no-push）"; exit 1 ;;
  esac
done

step() { printf '\n━━━ %s ━━━\n' "$1"; }
FAIL=0
API_RAN=0 E2E_RAN=0

# ---- 前置：本地 Supabase 栈（API 测试必需；E2E 跑它才有意义——都是同一个栈）----
STACK_READY=0
if docker info >/dev/null 2>&1 && supabase status >/dev/null 2>&1; then
  STACK_READY=1
elif [ $RUN_API -eq 1 ]; then
  # API 测试强依赖栈，栈没起就尝试拉起（headless，不进 studio）
  step "starting local supabase stack"
  if supabase start -x studio >/dev/null 2>&1; then
    STACK_READY=1
  else
    echo "❌ 本地 Supabase 栈起不来（docker 在跑？），API 测试无法进行"; exit 1
  fi
fi

if [ $RUN_E2E -eq 1 ]; then
  step "e2e data cleanup (pre)"
  node --experimental-strip-types scripts/e2e-cleanup.ts || true
fi

if [ $RUN_API -eq 1 ]; then
  if [ $STACK_READY -eq 1 ]; then
    step "api tests (all routes)"
    pnpm api-test || FAIL=1
    API_RAN=1
  else
    echo "⚠ supabase 栈未就绪，跳过 API 测试（E2E 报告不受影响）"
  fi
fi

if [ $RUN_E2E -eq 1 ]; then
  step "e2e tests (playwright, local db)"
  npx playwright test || FAIL=1
  E2E_RAN=1
  step "e2e data cleanup (post)"
  node --experimental-strip-types scripts/e2e-cleanup.ts || true
fi

if [ $PUSH -eq 1 ]; then
  if [ $PUSH_ONLY -eq 1 ] || [ $API_RAN -eq 1 ]; then
    step "push api report to portal"
    ./scripts/push-test-report.sh || true
  fi
  if [ $PUSH_ONLY -eq 1 ] || [ $E2E_RAN -eq 1 ]; then
    step "push e2e report to portal"
    TEST_REPORT_TYPE=e2e ./scripts/push-test-report.sh || true
  fi
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ all done — 门户: http://192.168.3.22:8686"
else
  echo "❌ 测试有失败项（报告已生成/推送，门户可见失败明细）"; exit 1
fi

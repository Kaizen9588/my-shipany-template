#!/usr/bin/env bash
# push-test-report.sh —— 把本地 API 测试报告推送到内网报告门户（192.168.3.22）
#
# 产物三件套（api-tests/output/）：
#   report-summary.json  机器契约，门户看板解析（schemaVersion 见 docs/18-api-testing.md）
#   report-summary.md    人读原件，门户直接展示
#   junit.xml            通用格式，供后续第三方平台接入
#
# 服务器目录布局（门户按此导航）：
#   ~/reports/current/<project>/<type>/        门户"最新一次"读这里
#   ~/reports/history/<project>/<type>/<ts>/   历史运行（ts=YYYYmmdd-HHMMSS）
#   <type> 目前为 api；以后接 E2E 报告用 e2e，门户零改动
#
# 行为约定：服务器不可达时警告并退出 0 —— 报告推送是尽力而为，绝不阻塞 push 门禁。
set -uo pipefail

SERVER="${TEST_REPORT_SERVER:-wang@192.168.3.22}"
PROJECT="${TEST_REPORT_PROJECT:-my-shipany-template}"
TYPE="${TEST_REPORT_TYPE:-api}"
# 报告产物目录随类型切换：api → api-tests/output；e2e → e2e-report-output
if [[ "$TYPE" == "e2e" ]]; then
  OUT_DIR="${TEST_REPORT_OUT_DIR:-e2e-report-output}"
else
  OUT_DIR="${TEST_REPORT_OUT_DIR:-api-tests/output}"
fi

for f in "$OUT_DIR/report-summary.json" "$OUT_DIR/report-summary.md" "$OUT_DIR/junit.xml"; do
  if [[ ! -f "$f" ]]; then
    echo "[report-push] 跳过：缺少 $f（本轮没跑对应测试？junit.xml 仅 API 测试 reporter 生成）"
    exit 0
  fi
done

TS=$(date +%Y%m%d-%H%M%S)

if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$SERVER" \
  "mkdir -p ~/reports/current/$PROJECT/$TYPE ~/reports/history/$PROJECT/$TYPE/$TS" 2>/dev/null; then
  echo "[report-push] 内网报告服务器不可达（$SERVER），跳过推送（不阻塞门禁）"
  exit 0
fi

scp -q "$OUT_DIR/report-summary.json" "$OUT_DIR/report-summary.md" "$OUT_DIR/junit.xml" \
  "$SERVER:~/reports/current/$PROJECT/$TYPE/" \
  && scp -q "$OUT_DIR/report-summary.json" "$OUT_DIR/report-summary.md" "$OUT_DIR/junit.xml" \
    "$SERVER:~/reports/history/$PROJECT/$TYPE/$TS/" \
  && echo "[report-push] 已推送 → $SERVER (current/$PROJECT/$TYPE + history/$PROJECT/$TYPE/$TS)，门户: http://192.168.3.22:8686" \
  || { echo "[report-push] 推送失败（scp），跳过（不阻塞门禁）"; exit 0; }

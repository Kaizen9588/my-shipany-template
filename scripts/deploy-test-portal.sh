#!/usr/bin/env bash
# deploy-test-portal.sh —— 部署/更新内网报告门户（192.168.3.22:8686）
#
# 幂等，覆盖两种场景：
#   首次部署：建 ~/reports/{current,history} 目录树 + docker compose up
#   日常更新：同步门户三件套（index.html / nginx.conf / docker-compose.yml）+ 重建容器
#             （bind-mount 单文件被 scp 替换后 inode 变化，必须重建容器才能读到新内容）
#
# 用法：./scripts/deploy-test-portal.sh
set -euo pipefail

SERVER="${TEST_REPORT_SERVER:-wang@192.168.3.22}"
PORTAL_DIR="${TEST_PORTAL_DIR:-apps/test-portal}"
SRC="$(cd "$(dirname "$0")/test-portal" && pwd)"

if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$SERVER" true 2>/dev/null; then
  echo "[portal-deploy] 服务器不可达（$SERVER），中止"; exit 1
fi

# 报告目录树（幂等；推送脚本 push-test-report.sh 也按此布局落文件）
ssh "$SERVER" "mkdir -p ~/reports/current ~/reports/history"

# 同步门户文件（服务器侧目录不存在时 scp 会失败，先建）
ssh "$SERVER" "mkdir -p ~/$PORTAL_DIR"
scp -q "$SRC/index.html" "$SRC/nginx.conf" "$SRC/docker-compose.yml" "$SERVER:~/$PORTAL_DIR/"

# up -d --force-recreate：首次创建、更新配置、刷新 bind-mount 三合一
if ssh "$SERVER" "cd ~/$PORTAL_DIR && docker compose up -d --force-recreate" 2>/dev/null; then
  echo "[portal-deploy] 已部署 → http://192.168.3.22:8686（$PORTAL_DIR/）"
else
  echo "[portal-deploy] compose 启动失败——排查：ssh $SERVER 'cd ~/$PORTAL_DIR && docker compose up -d'"
  exit 1
fi

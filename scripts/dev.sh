#!/usr/bin/env bash
# 一键启动本地开发环境：MariaDB + NestJS(4000) + Next.js(3000)
# 首次使用请先执行：bash scripts/setup.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ [1/3] 启动本地 MariaDB"
"$ROOT/.local/mysqlctl.sh" start

echo "▶ [2/3] 启动后端 NestJS（端口 4000，表结构自动同步）"
cd "$ROOT/backend"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run dev &
BACK_PID=$!

echo "▶ [3/3] 启动前端 Next.js（端口 3000）"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run dev &
FRONT_PID=$!

trap "kill $BACK_PID $FRONT_PID 2>/dev/null" EXIT
echo ""
echo "✅ 已启动：前端 http://127.0.0.1:3000  后端 http://127.0.0.1:4000"
echo "   测试账号：owner1 / cs1 / driver1 / rite1 / fire1 / art1 / fin1 / manager1（密码 123456）"
wait

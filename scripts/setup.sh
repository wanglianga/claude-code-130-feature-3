#!/usr/bin/env bash
# 首次环境准备：下载免安装 MariaDB（若缺失）→ 启动 → 建库 → 装依赖 → 建表 → 写入种子数据
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="mariadb-10.11.19-linux-systemd-x86_64"
LOCAL="$ROOT/.local"
mkdir -p "$LOCAL"

if [ ! -x "$LOCAL/mariadb/bin/mariadbd" ]; then
  echo "▶ 下载免安装 MariaDB（约 340MB，阿里云镜像）"
  curl -fL "https://mirrors.aliyun.com/mariadb/mariadb-10.11.19/bintar-linux-systemd-x86_64/${VER}.tar.gz" -o "$LOCAL/mariadb.tar.gz"
  tar xzf "$LOCAL/mariadb.tar.gz" -C "$LOCAL"
  ln -sfn "$VER" "$LOCAL/mariadb"
fi
chmod +x "$LOCAL/mysqlctl.sh" 2>/dev/null || true
"$LOCAL/mysqlctl.sh" start

echo "▶ 安装后端依赖并写入种子数据"
cd "$ROOT/backend"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run seed

echo "▶ 安装前端依赖"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund

echo "✅ 准备完成。运行 bash scripts/dev.sh 启动平台。"

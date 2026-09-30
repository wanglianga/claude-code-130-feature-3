#!/usr/bin/env bash
# 免 root 的本地 MariaDB 启停脚本（仅用于本地开发/验证）
# 用法：mysqlctl.sh start | stop | status
set -e
LOCAL="$(cd "$(dirname "$0")" && pwd)"
BASE="$LOCAL/mariadb"
DATA="$LOCAL/mysqldata"
SOCK="$LOCAL/mysql.sock"
PIDF="$LOCAL/mysqld.pid"
LOG="$LOCAL/mysql.log"
PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-pet_aftercare}"
DB_USER="${DB_USER:-petapp}"
DB_PASS="${DB_PASS:-petapp123}"

cmd() { "$BASE/bin/mariadb" --socket="$SOCK" -uroot "$@"; }

is_running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }

start() {
  if is_running; then echo "MariaDB 已在运行（pid $(cat "$PIDF")）"; return 0; fi
  if [ ! -d "$DATA/mysql" ]; then
    echo "▶ 首次初始化数据目录 $DATA"
    INSTALL_DB="$BASE/bin/mariadb-install-db"
    [ -x "$INSTALL_DB" ] || INSTALL_DB="$BASE/scripts/mariadb-install-db"
    "$INSTALL_DB" --basedir="$BASE" --datadir="$DATA" --auth-root-authentication-method=normal >/dev/null
  fi
  echo "▶ 启动 mariadbd（端口 $PORT，socket $SOCK）"
  "$BASE/bin/mariadbd" --basedir="$BASE" --datadir="$DATA" \
    --socket="$SOCK" --pid-file="$PIDF" --port="$PORT" \
    --bind-address=127.0.0.1 --skip-networking=0 \
    --log-error="$LOG" >/dev/null 2>&1 &
  for i in $(seq 1 60); do
    if "$BASE/bin/mariadb-admin" --socket="$SOCK" -uroot ping >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if ! "$BASE/bin/mariadb-admin" --socket="$SOCK" -uroot ping >/dev/null 2>&1; then
    echo "启动失败，见日志：$LOG"; tail -30 "$LOG" 2>/dev/null; exit 1
  fi
  cmd <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
  echo "✅ MariaDB 就绪：127.0.0.1:$PORT 库 $DB_NAME 账号 $DB_USER/$DB_PASS"
}

stop() {
  if is_running; then
    "$BASE/bin/mariadb-admin" --socket="$SOCK" -uroot shutdown && echo "已停止"
  else echo "未在运行"; rm -f "$PIDF"; fi
}

status() {
  if is_running; then
    "$BASE/bin/mariadb-admin" --socket="$SOCK" -uroot status
  else echo "MariaDB 未运行"; fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "用法: $0 start|stop|status"; exit 1 ;;
esac

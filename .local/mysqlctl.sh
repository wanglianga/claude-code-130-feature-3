#!/usr/bin/env bash
# 免 root / 免 docker 的本地 MariaDB 控制脚本。
# 数据目录：.local/mysqldata；Socket：.local/mysql.sock；端口 3306（仅绑定 127.0.0.1）。
# 用法：mysqlctl.sh start | stop | status | restart
set -e
LOCAL="$(cd "$(dirname "$0")" && pwd)"
MARIADB="$LOCAL/mariadb"
DATA="$LOCAL/mysqldata"
SOCK="$LOCAL/mysql.sock"
PIDF="$LOCAL/mysqld.pid"
ERRLOG="$LOCAL/mysql.err"
PORT="${DB_PORT:-3306}"
BIN="$MARIADB/bin"
# 免安装包中 mariadb-install-db 位于 scripts/，部分发行版位于 bin/
INSTALL_DB="$BIN/mariadb-install-db"
[ -x "$INSTALL_DB" ] || INSTALL_DB="$MARIADB/scripts/mariadb-install-db"

[ -x "$BIN/mariadbd" ] && [ -x "$INSTALL_DB" ] || {
  echo "未找到 MariaDB，请先运行：bash scripts/setup.sh" >&2
  exit 1
}

is_alive() {
  [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null
}

wait_socket() {
  for _ in $(seq 1 60); do
    if "$BIN/mariadb-admin" --protocol=socket --socket="$SOCK" -uroot ping >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "MariaDB 启动超时，错误日志：$ERRLOG" >&2
  tail -30 "$ERRLOG" >&2 || true
  exit 1
}

bootstrap_db() {
  "$BIN/mariadb" --protocol=socket --socket="$SOCK" -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS pet_aftercare CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'petapp'@'127.0.0.1' IDENTIFIED BY 'petapp123';
CREATE USER IF NOT EXISTS 'petapp'@'localhost' IDENTIFIED BY 'petapp123';
CREATE USER IF NOT EXISTS 'petapp'@'%' IDENTIFIED BY 'petapp123';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'127.0.0.1';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'localhost';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'%';
FLUSH PRIVILEGES;
SQL
}

start() {
  if is_alive; then echo "MariaDB 已在运行（端口 $PORT）"; return 0; fi
  if [ ! -d "$DATA/mysql" ]; then
    echo "▶ 首次初始化数据目录 $DATA"
    "$INSTALL_DB" \
      --basedir="$MARIADB" --datadir="$DATA" \
      --auth-root-authentication-method=normal --skip-test-db >/dev/null
    FRESH=1
  fi
  echo "▶ 启动 MariaDB（127.0.0.1:$PORT）"
  "$BIN/mariadbd" \
    --basedir="$MARIADB" --datadir="$DATA" \
    --socket="$SOCK" --pid-file="$PIDF" --port="$PORT" \
    --bind-address=127.0.0.1 --skip-name-resolve \
    --log-error="$ERRLOG" &
  wait_socket
  [ "${FRESH:-0}" = "1" ] && bootstrap_db && echo "▶ 已建库 pet_aftercare 与账号 petapp/petapp123"
  echo "✅ MariaDB 就绪：mysql -h127.0.0.1 -P$PORT -upetapp -ppetapp123 pet_aftercare"
}

stop() {
  if is_alive; then
    "$BIN/mariadb-admin" --protocol=socket --socket="$SOCK" -uroot shutdown
    echo "MariaDB 已停止"
  else
    echo "MariaDB 未运行"
    rm -f "$PIDF"
  fi
}

status() {
  if is_alive && "$BIN/mariadb-admin" --protocol=socket --socket="$SOCK" -uroot ping >/dev/null 2>&1; then
    echo "running: pid $(cat "$PIDF"), port $PORT, data $DATA"
  else
    echo "stopped"
    exit 1
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop || true; start ;;
  status) status ;;
  *) echo "用法: $0 {start|stop|status|restart}" >&2; exit 2 ;;
esac

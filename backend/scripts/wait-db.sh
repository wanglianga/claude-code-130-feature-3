#!/usr/bin/env bash
# 容器入口：等待 MySQL 就绪 → 空库时自动建表并写入种子数据 → 启动后端
set -e
echo "▶ 等待数据库 ${DB_HOST}:${DB_PORT} …"
for i in $(seq 1 60); do
  if node -e "
    const net=require('net');
    const s=net.connect({host:process.env.DB_HOST,port:Number(process.env.DB_PORT)},()=>{s.end();process.exit(0)});
    s.on('error',()=>process.exit(1));
    setTimeout(()=>process.exit(1),1500);
  " 2>/dev/null; then echo "  数据库已就绪"; break; fi
  sleep 2
  [ "$i" = "60" ] && { echo "数据库连接超时"; exit 1; }
done

# 同步表结构（synchronize 已在应用启动时执行）；空业务库则写入种子账号与资源
HAS_TABLES=$(node -e "
const mysql=require('mysql2/promise');
(async()=>{
  const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),
    user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME});
  const [r]=await c.query(\"SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=? AND table_name='users'\",[process.env.DB_NAME]);
  console.log(r[0].n);
  await c.end();
})().catch(()=>console.log('0'));
")
if [ "$HAS_TABLES" = "0" ]; then
  echo "▶ 空数据库：建表并写入种子数据（首次启动约需数秒）"
  # 先启动一次让 synchronize 建表，再执行 seed
  node dist/src/main.js &
  PID=$!
  for i in $(seq 1 30); do
    node -e "
    const mysql=require('mysql2/promise');
    (async()=>{const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME});
    const [r]=await c.query(\"SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=? AND table_name='users'\",[process.env.DB_NAME]);
    process.exit(r[0].n?0:1);await c.end();})().catch(()=>process.exit(1));" 2>/dev/null && break
    sleep 1
  done
  node dist/scripts/seed.js || echo "种子执行跳过（可能已初始化）"
  kill $PID 2>/dev/null || true
  wait $PID 2>/dev/null || true
fi

echo "▶ 启动后端服务（端口 4000）"
exec node dist/src/main.js

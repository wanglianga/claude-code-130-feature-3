/**
 * Docker 容器启动引导：
 * 1. 等待 MariaDB 就绪；
 * 2. 空库时自动建表（synchronize）并写入种子数据；已有数据则保留，不做任何清除；
 * 3. 设置 SEED_RESET=1 可在启动时强制重置演示数据。
 */
import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { DataSource } from 'typeorm';
import { Appointment, TimelineEvent } from '../src/entities/appointment';
import { Hospital, Store, User } from '../src/entities/core';
import {
  ColdStorage, Confirmation, CremationCertificate, FarewellRoomSlot, FeeItem, FurnaceSlot,
} from '../src/entities/ops';
import { AlbumMedia, Followup, Locker, Memento, Shipment } from '../src/entities/aftercare';
import {
  ContactAttempt, DispositionOrder, LockerDispositionCase, StorageAuthorization, StoragePreference,
} from '../src/entities/storage';
import { Message, Payment } from '../src/entities/billing';

const dbConfig = {
  type: 'mysql' as const,
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USER || 'petapp',
  password: process.env.DB_PASS || 'petapp123',
  database: process.env.DB_NAME || 'pet_aftercare',
  charset: 'utf8mb4' as const,
  entities: [
    Appointment, TimelineEvent, Store, User, Hospital,
    ColdStorage, Confirmation, FarewellRoomSlot, FeeItem, FurnaceSlot, CremationCertificate,
    AlbumMedia, Followup, Locker, Memento, Shipment,
    Message, Payment,
    StoragePreference, StorageAuthorization, ContactAttempt, LockerDispositionCase, DispositionOrder,
  ],
  synchronize: true,
  timezone: '+08:00',
};

async function waitForDb(ds: DataSource, retries = 60) {
  for (let i = 1; i <= retries; i++) {
    try {
      await ds.initialize();
      return;
    } catch (e: any) {
      console.log(`等待数据库就绪（${i}/${retries}）：${e.code || e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('数据库连接超时');
}

async function main() {
  const ds = new DataSource(dbConfig);
  await waitForDb(ds);
  const rows: any[] = await ds.query('SELECT COUNT(*) AS c FROM users');
  const count = Number(rows[0].c);
  if (process.env.SEED_RESET === '1') {
    console.log('SEED_RESET=1，重置演示数据…');
    await ds.destroy();
    execFileSync('npx', ['ts-node', 'scripts/seed.ts'], { stdio: 'inherit' });
  } else if (count === 0) {
    console.log('检测到空库，写入种子数据…');
    await ds.destroy();
    execFileSync('npx', ['ts-node', 'scripts/seed.ts'], { stdio: 'inherit' });
  } else {
    console.log(`数据库已有 ${count} 个账号，保留现有数据，跳过种子。`);
    await ds.destroy();
  }
  console.log('引导完成，启动后端服务…');
}

main().catch(e => { console.error(e); process.exit(1); });

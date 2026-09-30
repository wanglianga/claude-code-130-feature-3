/**
 * 种子数据：2 家门店、各角色账号（含客服主管/寄存主管）、宠物医院转介、
 * 冷藏位/火化炉/告别室/柜位，以及两个寄存到期处置演示场景。
 * 运行：npm run seed
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Appointment, TimelineEvent } from '../src/entities/appointment';
import { Hospital, Store, User } from '../src/entities/core';
import {
  ColdStorage, FarewellRoomSlot, FurnaceSlot, FeeItem, Confirmation, CremationCertificate,
} from '../src/entities/ops';
import { Followup, Locker, Memento, Shipment, AlbumMedia } from '../src/entities/aftercare';
import {
  ContactAttempt, DispositionOrder, LockerDispositionCase,
  StorageAuthorization, StoragePreference,
} from '../src/entities/storage';
import { Message, Payment } from '../src/entities/billing';
import { hashPassword } from '../src/auth/auth.service';

export const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USER || 'petapp',
  password: process.env.DB_PASS || 'petapp123',
  database: process.env.DB_NAME || 'pet_aftercare',
  charset: 'utf8mb4',
  entities: [
    Appointment, TimelineEvent, Store, User, Hospital,
    ColdStorage, FarewellRoomSlot, FurnaceSlot,
    FeeItem, Confirmation, CremationCertificate,
    Locker, Memento, Shipment, Followup, AlbumMedia,
    Message, Payment,
    StoragePreference, StorageAuthorization, ContactAttempt, LockerDispositionCase, DispositionOrder,
  ],
  synchronize: true,
  timezone: '+08:00',
});

async function main() {
  await ds.initialize();
  await ds.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of [
    'disposition_orders', 'contact_attempts', 'locker_disposition_cases', 'storage_authorizations',
    'storage_preferences',
    'messages', 'payments', 'album_media', 'followups', 'shipments', 'lockers',
    'mementos', 'cremation_certificates', 'cold_storage', 'farewell_room_slots', 'furnace_slots',
    'confirmations', 'fee_items', 'timeline_events', 'appointments', 'hospitals', 'users', 'stores']) {
    await ds.query(`TRUNCATE TABLE \`${t}\``).catch(() => {});
  }
  await ds.query('SET FOREIGN_KEY_CHECKS=1');

  const stores = await ds.getRepository(Store).save([
    { name: '星河路旗舰店', address: '本市星河路 88 号', phone: '021-55001001' },
    { name: '湖畔路服务点', address: '本市湖畔路 12 号', phone: '021-55001002' },
  ]);

  const hp = (p: Partial<User> & { username: string; name: string; role: any; store_id?: number }) =>
    ds.getRepository(User).create({
      password: hashPassword('123456'), phone: '13800000000', ...p,
    });

  const users = await ds.getRepository(User).save([
    hp({ username: 'owner1', name: '王女士', role: 'owner', phone: '13900010001' }),
    hp({ username: 'owner2', name: '李先生', role: 'owner', phone: '13900010002' }),
    hp({ username: 'cs1', name: '客服-周敏', role: 'customer_service', store_id: 1, phone: '13900020001' }),
    hp({ username: 'cs2', name: '客服-陈露', role: 'customer_service', store_id: 2, phone: '13900020002' }),
    hp({ username: 'cssup1', name: '客服主管-孟晴', role: 'cs_supervisor', store_id: 1, phone: '13900021001' }),
    hp({ username: 'cssup2', name: '客服主管-何岚', role: 'cs_supervisor', store_id: 2, phone: '13900021002' }),
    hp({ username: 'store1', name: '寄存主管-许伯安', role: 'storage_manager', store_id: 1, phone: '13900022001' }),
    hp({ username: 'store2', name: '寄存主管-白敬山', role: 'storage_manager', store_id: 2, phone: '13900022002' }),
    hp({ username: 'driver1', name: '接送员-老赵', role: 'driver', store_id: 1, phone: '13900030001' }),
    hp({ username: 'driver2', name: '接送员-小孙', role: 'driver', store_id: 2, phone: '13900030002' }),
    hp({ username: 'rite1', name: '礼仪师-安然', role: 'ceremonialist', store_id: 1, phone: '13900040001' }),
    hp({ username: 'rite2', name: '礼仪师-静怡', role: 'ceremonialist', store_id: 2, phone: '13900040002' }),
    hp({ username: 'fire1', name: '火化师-郑师傅', role: 'cremator', store_id: 1, phone: '13900050001' }),
    hp({ username: 'fire2', name: '火化师-高师傅', role: 'cremator', store_id: 2, phone: '13900050002' }),
    hp({ username: 'art1', name: '纪念品师-阿岚', role: 'artisan', store_id: 1, phone: '13900060001' }),
    hp({ username: 'fin1', name: '财务-唐会计', role: 'finance', store_id: 1, phone: '13900070001' }),
    hp({ username: 'manager1', name: '运营总监-林总', role: 'manager', phone: '13900080001' }),
  ]);

  await ds.getRepository(Hospital).save([
    { name: '爱诺宠物医院（星河路店）', contact: '刘医生', phone: '021-66001111', store_id: 1 },
    { name: '湖畔动物诊所', contact: '赵医生', phone: '021-66002222', store_id: 2 },
  ]);

  // 每店：3 个冷藏位、2 台火化炉、2 间告别室、12 个寄存柜位
  const cold: Partial<ColdStorage>[] = [];
  const rooms: Partial<FarewellRoomSlot>[] = [];
  const lockers: Partial<Locker>[] = [];
  for (const s of stores) {
    for (let i = 1; i <= 3; i++) {
      cold.push({ store_id: s.id, cell_name: `C${s.id}-0${i}`, status: 'free' });
    }
    for (const t of ['宁静厅', '追思厅']) {
      rooms.push({ store_id: s.id, room_name: `${t}(${s.id}号店)`,
        start_at: new Date(), end_at: new Date(), status: 'free', appointment_id: null });
    }
    for (let i = 1; i <= 6; i++) {
      for (const tier of ['standard', 'premium'] as const) {
        lockers.push({
          store_id: s.id,
          code: `${s.id === 1 ? 'A' : 'B'}-${tier === 'standard' ? '01' : '02'}-${String(i).padStart(2, '0')}`,
          tier, status: 'free', annual_fee: tier === 'standard' ? '600.00' : '980.00',
        });
      }
    }
  }
  await ds.getRepository(ColdStorage).save(cold as any);
  await ds.getRepository(FarewellRoomSlot).save(rooms as any);
  const savedLockers = await ds.getRepository(Locker).save(lockers as any);

  // ============ 寄存处置演示场景 ============

  // 场景一：王女士家「念念」（犬），柜位 15 天后到期，偏好转长期；
  // 当前柜位年费较入存时上调（600 → 680），用于演示续费三项校验中的「年费变更」。
  const mkCompleted = async (p: Partial<Appointment>): Promise<Appointment> => {
    const entity = ds.getRepository(Appointment).create({
      code: `PA-SEED-${Math.floor(Math.random() * 9000 + 1000)}`, store_id: 1, owner_id: 1,
      pet_name: '宠物', pet_type: 'dog', pet_breed: '串串', weight_kg: '8.00',
      death_time: new Date(Date.now() - 400 * 86400000),
      need_pickup: true, want_urn: true, storage_months: 12,
      quote_amount: '1500.00', final_amount: '1500.00', status: 'completed',
      completed_at: new Date(Date.now() - 360 * 86400000), ...p,
    } as any);
    return (await ds.getRepository(Appointment).save(entity)) as unknown as Appointment;
  };

  const a1 = await mkCompleted({
    store_id: 1, owner_id: 1, pet_name: '念念', pet_type: 'dog', pet_breed: '金毛寻回犬',
    weight_kg: '26.00',
  });
  const locker1 = savedLockers.find(l => l.code === 'A-02-01')!;
  const expire1 = new Date(Date.now() + 15 * 86400000);
  await ds.getRepository(Locker).update(locker1.id, {
    status: 'expiring', appointment_id: a1.id,
    occupied_since: new Date(Date.now() - 350 * 86400000), expire_at: expire1, annual_fee: '680.00',
  });
  await ds.getRepository(FeeItem).save([
    ds.getRepository(FeeItem).create({
      appointment_id: a1.id, kind: 'base_quote', title: '善终火化基础服务', amount: '900.00',
      entry_type: 'base', confirm_status: 'confirmed',
    }),
    ds.getRepository(FeeItem).create({
      appointment_id: a1.id, kind: 'storage', title: '柜位 A-02-01 首年寄存 12 个月', amount: '600.00',
      reason: '入存年费（去年价格）', entry_type: 'base', confirm_status: 'confirmed', period_months: 12,
    }),
  ]);
  await ds.getRepository(Payment).save(ds.getRepository(Payment).create({
    appointment_id: a1.id, amount: '1500.00', method: 'wechat', status: 'paid', finance_id: 16,
    note: '首年费用已结清',
  }));
  await ds.getRepository(StoragePreference).save(ds.getRepository(StoragePreference).create({
    appointment_id: a1.id, contact_name: '王女士', contact_phone: '13900010001',
    alt_contact_name: '王女士之子', alt_contact_phone: '13700010001',
    preferred_channel: 'wechat', preferred_action: 'longterm', notify_days: 30,
    contact_valid: 'valid', checked_by: 3, checked_at: new Date(),
    notes: '家属希望长期安葬式寄存，迁移需提前与儿子确认时间',
  }));
  await ds.getRepository(StorageAuthorization).save(ds.getRepository(StorageAuthorization).create({
    appointment_id: a1.id, doc_type: 'owner_id', title: '王女士身份证明（留档）',
    doc_no: 'ID-SEED-1001', file_url: 'https://example.com/auth/owner1-id.jpg',
    uploaded_by: 1, status: 'verified', verified_by: 7, verified_at: new Date(),
  }));
  await ds.getRepository(Followup).save(ds.getRepository(Followup).create({
    appointment_id: a1.id, trigger: 'locker_longterm_reminder', planned_at: new Date(),
    content: `柜位 A-02-01 将于 15 天后到期，您偏好「转长期寄存」，客服将与您比较长期柜位方案`,
  }));
  await ds.getRepository(TimelineEvent).save(ds.getRepository(TimelineEvent).create({
    appointment_id: a1.id, node_key: 'storage_in', flag: 'normal',
    title: '骨灰入寄存柜位 A-02-01', occurred_at: new Date(Date.now() - 350 * 86400000),
    note: '首年年费 600 元/年',
  }));

  // 场景二：李先生家「团团」（猫），2 号店柜位已逾期 40 天；
  // 处置案件多轮联系中（已完成 2 轮均无回应，尚缺第 3 轮），等待客服在系统中补齐后升级受保护。
  const a2 = await mkCompleted({
    code: 'PA-SEED-2002', store_id: 2, owner_id: 2, pet_name: '团团', pet_type: 'cat',
    pet_breed: '英国短毛猫', weight_kg: '4.50', want_urn: true,
    quote_amount: '1080.00', final_amount: '1680.00',
  });
  const locker2 = savedLockers.find(l => l.code === 'B-01-02')!;
  const expire2 = new Date(Date.now() - 40 * 86400000);
  await ds.getRepository(Locker).update(locker2.id, {
    status: 'expired', appointment_id: a2.id,
    occupied_since: new Date(Date.now() - 405 * 86400000), expire_at: expire2, annual_fee: '600.00',
  });
  await ds.getRepository(FeeItem).save([
    ds.getRepository(FeeItem).create({
      appointment_id: a2.id, kind: 'base_quote', title: '善终火化基础服务', amount: '480.00',
      entry_type: 'base', confirm_status: 'confirmed',
    }),
    ds.getRepository(FeeItem).create({
      appointment_id: a2.id, kind: 'storage', title: '柜位 B-01-02 寄存 12 个月', amount: '600.00',
      entry_type: 'base', confirm_status: 'confirmed', period_months: 12,
    }),
  ]);
  await ds.getRepository(Payment).save(ds.getRepository(Payment).create({
    appointment_id: a2.id, amount: '1080.00', method: 'alipay', status: 'paid', finance_id: 16,
  }));
  await ds.getRepository(StoragePreference).save(ds.getRepository(StoragePreference).create({
    appointment_id: a2.id, contact_name: '李先生', contact_phone: '13900010002',
    preferred_channel: 'phone', preferred_action: 'renew', notify_days: 30,
    contact_valid: 'invalid', checked_by: 4, checked_at: new Date(Date.now() - 35 * 86400000),
    notes: '到期前主号码已停机，备用号码未登记',
  }));
  const csCase = await ds.getRepository(LockerDispositionCase).save(
    ds.getRepository(LockerDispositionCase).create({
      code: `DC-SEED-${Math.floor(Math.random() * 9000 + 1000)}`,
      appointment_id: a2.id, locker_id: locker2.id, store_id: 2,
      reason: 'overdue_no_response', status: 'contacting', owner_choice: 'none',
      rounds_required: 3, remain_days_snapshot: -40, cs_id: 4,
    }));
  await ds.getRepository(ContactAttempt).save([
    ds.getRepository(ContactAttempt).create({
      case_id: csCase.id, appointment_id: a2.id, round: 1, channel: 'phone', result: 'no_answer',
      contacted_at: new Date(Date.now() - 30 * 86400000), cs_id: 4,
      note: '逾期第 10 天，工作时间三次拨打无人接听',
      evidence_urls: ['https://example.com/contact/round1-calllog.png'],
    }),
    ds.getRepository(ContactAttempt).create({
      case_id: csCase.id, appointment_id: a2.id, round: 2, channel: 'sms', result: 'bounced',
      contacted_at: new Date(Date.now() - 18 * 86400000), cs_id: 4,
      note: '续费提醒短信被运营商退回：号码停机',
      evidence_urls: ['https://example.com/contact/round2-sms-bounce.png'],
    }),
  ]);
  await ds.getRepository(TimelineEvent).save([
    ds.getRepository(TimelineEvent).create({
      appointment_id: a2.id, node_key: 'storage_in', flag: 'normal',
      title: '骨灰入寄存柜位 B-01-02', occurred_at: new Date(Date.now() - 405 * 86400000),
    }),
    ds.getRepository(TimelineEvent).create({
      appointment_id: a2.id, node_key: 'case_opened', flag: 'exception',
      title: `柜位到期处置案件已立案（${csCase.code}），启动多轮联系，柜位剩余期限 -40 天`,
      occurred_at: new Date(Date.now() - 31 * 86400000),
      note: '主号码停机，启动电话/短信/信函多轮联系',
    }),
  ]);

  console.log('种子完成：');
  console.log(`门店 ${stores.length} 家，账号 ${users.length} 个（密码均为 123456）`);
  console.log('主要账号：owner1/owner2 / cs1 / cssup1(客服主管) / store1(寄存主管) / fin1 / manager1');
  console.log('寄存场景：#1 念念 A-02-01 15天后到期(偏好转长期, 年费600→680)；#2 团团 B-01-02 逾期40天(处置案件多轮联系中)');
  await ds.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });

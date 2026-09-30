/**
 * 种子数据：2 家门店、各角色账号（含客服主管/寄存主管）、宠物医院转介、
 * 冷藏位/火化炉/告别室/柜位。
 * 运行：npm run seed
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Appointment, TimelineEvent } from '../src/entities/appointment';
import { Hospital, Store, User } from '../src/entities/core';
import {
  ColdStorage, FarewellRoomSlot, FeeItem, FurnaceSlot,
} from '../src/entities/ops';
import { Followup, Locker } from '../src/entities/aftercare';
import {
  ContactAttempt, FamilyCallback, StorageContact, StorageDirective, StorageDisposalCase,
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
    require('../src/entities/ops').FeeItem,
    require('../src/entities/ops').Confirmation,
    require('../src/entities/ops').CremationCertificate,
    Locker,
    require('../src/entities/aftercare').Memento,
    require('../src/entities/aftercare').Shipment,
    require('../src/entities/aftercare').Followup,
    require('../src/entities/aftercare').AlbumMedia,
    StorageContact, ContactAttempt, StorageDisposalCase, StorageDirective, FamilyCallback,
    Message, Payment,
  ],
  synchronize: true,
  timezone: '+08:00',
});

async function main() {
  await ds.initialize();
  await ds.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of [
    'messages', 'payments', 'album_media', 'family_callbacks', 'storage_directives',
    'storage_disposal_cases', 'contact_attempts', 'storage_contacts', 'followups',
    'shipments', 'lockers', 'mementos', 'cremation_certificates', 'cold_storage',
    'farewell_room_slots', 'furnace_slots', 'confirmations', 'fee_items',
    'timeline_events', 'appointments', 'hospitals', 'users', 'stores',
  ]) {
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
    hp({ username: 'owner2', name: '李先生', role: 'owner', phone: '13900020002' }),
    hp({ username: 'cs1', name: '客服-周敏', role: 'customer_service', store_id: 1, phone: '13900020001' }),
    hp({ username: 'cs2', name: '客服-陈露', role: 'customer_service', store_id: 2, phone: '13900020002' }),
    hp({ username: 'cslead1', name: '客服主管-秦岚', role: 'cs_lead', store_id: 1, phone: '13900020011' }),
    hp({ username: 'storelead1', name: '寄存主管-沈肃', role: 'storage_lead', store_id: 1, phone: '13900020012' }),
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
  await ds.getRepository(Locker).save(lockers as any);

  // —— 寄存续费/处置演示工单（账号自增 id：owner1=1 owner2=2 cs1=3 cs2=4 cslead1=5 storelead1=6）——
  const day = 86400000;
  const demoAppts = await ds.getRepository(Appointment).save([
    {
      code: 'PA-STORE-001', store_id: 1, owner_id: 1,
      pet_name: '糯米', pet_type: 'cat', pet_breed: '橘猫', weight_kg: '4.00',
      death_time: new Date(Date.now() - 400 * day),
      want_urn: true, storage_months: 12,
      quote_amount: '200.00', final_amount: '200.00', status: 'completed',
      completed_at: new Date(Date.now() - 360 * day),
    },
    {
      code: 'PA-STORE-002', store_id: 2, owner_id: 2,
      pet_name: '团子', pet_type: 'dog', pet_breed: '柴犬', weight_kg: '9.00',
      death_time: new Date(Date.now() - 380 * day),
      storage_months: 12, quote_amount: '0.00', final_amount: '600.00', status: 'completed',
      completed_at: new Date(Date.now() - 365 * day),
    },
    {
      code: 'PA-STORE-003', store_id: 2, owner_id: 2,
      pet_name: '年糕', pet_type: 'rabbit', pet_breed: '侏儒兔', weight_kg: '1.20',
      death_time: new Date(Date.now() - 420 * day),
      storage_months: 12, quote_amount: '0.00', final_amount: '600.00', status: 'completed',
      completed_at: new Date(Date.now() - 405 * day),
    },
  ]);
  const [n3, n4, n5] = demoAppts.map(a => a.id);

  // 工单3：临期 10 天 + 年费已涨价 + 有未结费用 → 续费三项校验都会被触发
  // 置为 occupied：由「到期扫描」自然标记 expiring 并按偏好生成提醒
  await ds.getRepository(Locker).update({ code: 'A-01-01' } as any, {
    status: 'occupied', appointment_id: n3, occupied_since: new Date(Date.now() - 365 * day),
    expire_at: new Date(Date.now() + 10 * day),
    annual_fee: '660.00', annual_fee_at_assign: '600.00',
  });
  await ds.getRepository(FeeItem).save([
    { appointment_id: n3, kind: 'base_quote', title: '善终服务（已完成）', amount: '200.00',
      entry_type: 'base', confirm_status: 'confirmed', operator_id: 3 },
  ]);
  await ds.getRepository(StorageContact).save({
    appointment_id: n3, reminder_pref: 'renew', channel_pref: 'sms',
    alt_contact_name: '王小明（儿子）', alt_contact_phone: '13700011111', alt_contact_relation: '儿子',
    validity: 'valid', last_reached_at: new Date(Date.now() - 60 * day),
  });
  await ds.getRepository(TimelineEvent).save([
    { appointment_id: n3, node_key: 'storage_in', title: '骨灰入寄存柜位 A-01-01',
      actor_id: 3, actor_role: 'customer_service',
      note: '入柜年费 600 元', occurred_at: new Date(Date.now() - 365 * day) },
  ]);

  // 工单4：临期 5 天，家属偏好转长期寄存，费用已结清
  // 置为 occupied：扫描时按「微信渠道提醒转长期寄存」生成回访
  await ds.getRepository(Locker).update({ code: 'B-01-02' } as any, {
    status: 'occupied', appointment_id: n4, occupied_since: new Date(Date.now() - 360 * day),
    expire_at: new Date(Date.now() + 5 * day),
    annual_fee: '600.00', annual_fee_at_assign: '600.00',
  });
  await ds.getRepository(FeeItem).save([
    { appointment_id: n4, kind: 'storage', title: '柜位 B-01-02 寄存年费', amount: '600.00',
      entry_type: 'base', confirm_status: 'confirmed', operator_id: 4 },
  ]);
  await ds.getRepository(Payment).save([
    { appointment_id: n4, amount: '600.00', method: 'wechat', status: 'paid', finance_id: 14 },
  ]);
  await ds.getRepository(StorageContact).save({
    appointment_id: n4, reminder_pref: 'long_term', channel_pref: 'wechat',
    validity: 'valid', last_reached_at: new Date(Date.now() - 20 * day),
  });
  await ds.getRepository(TimelineEvent).save([
    { appointment_id: n4, node_key: 'storage_in', title: '骨灰入寄存柜位 B-01-02',
      actor_id: 4, actor_role: 'customer_service', occurred_at: new Date(Date.now() - 360 * day) },
  ]);

  // 工单5：已过期 45 天，三轮两渠道联系无果，授权文件已登记待核实，等待处置流程
  await ds.getRepository(Locker).update({ code: 'B-01-03' } as any, {
    status: 'expired', appointment_id: n5, occupied_since: new Date(Date.now() - 400 * day),
    expire_at: new Date(Date.now() - 45 * day),
    annual_fee: '600.00', annual_fee_at_assign: '600.00',
  });
  await ds.getRepository(StorageContact).save({
    appointment_id: n5, reminder_pref: 'renew', channel_pref: 'phone',
    validity: 'invalid',
    validity_note: '三轮联系：手机空号、微信无回应；备用号码为空',
    auth_status: 'uploaded', auth_doc_no: 'AUTH-2026-0058',
    auth_media_urls: ['https://example.com/auth/letter-0058.jpg'],
  });
  await ds.getRepository(ContactAttempt).save([
    { appointment_id: n5, round: 1, channel: 'phone', result: 'no_answer',
      attempted_at: new Date(Date.now() - 40 * day), cs_id: 4,
      note: '工作时间拨打 3 次无人接听', proof_urls: ['https://example.com/proof/call-round1.png'] },
    { appointment_id: n5, round: 2, channel: 'sms', result: 'invalid_number',
      attempted_at: new Date(Date.now() - 33 * day), cs_id: 4,
      note: '短信回执：号码已停机', proof_urls: ['https://example.com/proof/sms-round2.png'] },
    { appointment_id: n5, round: 3, channel: 'letter', result: 'no_answer',
      attempted_at: new Date(Date.now() - 20 * day), cs_id: 4,
      note: '挂号信已寄原址，逾期未领取，回执存档',
      proof_urls: ['https://example.com/proof/letter-round3.jpg'] },
  ]);
  await ds.getRepository(TimelineEvent).save([
    { appointment_id: n5, node_key: 'storage_in', title: '骨灰入寄存柜位 B-01-03',
      actor_id: 4, actor_role: 'customer_service', occurred_at: new Date(Date.now() - 400 * day) },
    { appointment_id: n5, node_key: 'storage_expired', flag: 'exception',
      title: '柜位 B-01-03 已过期 45 天，多轮联系无果', occurred_at: new Date(Date.now() - 45 * day) },
  ]);
  await ds.getRepository(Followup).save({
    appointment_id: n5, trigger: 'locker_expired', planned_at: new Date(Date.now() - 45 * day),
    content: '柜位 B-01-03 已到期未续费（按偏好渠道：电话），联系家属确认续费；多轮联系无果将进入受保护待处置',
  });

  console.log('寄存演示数据：');
  console.log(`  #${n3} 糯米 A-01-01 临期10天（年费 600→660 涨价、欠费 200 元，用于续费校验）`);
  console.log(`  #${n4} 团子 B-01-02 临期5天（偏好转长期寄存，用于柜位比较+家属确认）`);
  console.log(`  #${n5} 年糕 B-01-03 过期45天（三轮两渠道联系无果+授权待核实，用于双审批处置/撤回）`);

  console.log('种子完成：');
  console.log(`门店 ${stores.length} 家，账号 ${users.length} 个（密码均为 123456）`);
  console.log('主要账号：owner1 / cs1 / cslead1 / storelead1 / driver1 / rite1 / fire1 / art1 / fin1 / manager1');
  await ds.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });

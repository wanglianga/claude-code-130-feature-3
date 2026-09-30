import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Appointment, TimelineEvent } from '../entities/appointment';
import { User } from '../entities/core';
import { FeeItem, Confirmation } from '../entities/ops';
import { Followup, Locker } from '../entities/aftercare';
import { Payment } from '../entities/billing';
import {
  ContactAttempt, DispositionAction, DispositionOrder, LockerDispositionCase,
  StorageAuthorization, StoragePreference,
} from '../entities/storage';

type U = { sub: number; name: string; role: string; store_id?: number };

const CHANNELS = ['phone', 'sms', 'wechat', 'email', 'letter', 'onsite'];

/** 本轮到期处置涉及的费用科目 */
const STORAGE_FEE_KINDS = ['storage', 'storage_renew', 'storage_longterm'];

@Injectable()
export class StorageService {
  constructor(
    private ds: DataSource,
    @InjectRepository(Appointment) private appts: Repository<Appointment>,
    @InjectRepository(TimelineEvent) private timeline: Repository<TimelineEvent>,
    @InjectRepository(FeeItem) private fees: Repository<FeeItem>,
    @InjectRepository(Confirmation) private confirms: Repository<Confirmation>,
    @InjectRepository(Locker) private lockers: Repository<Locker>,
    @InjectRepository(Followup) private followups: Repository<Followup>,
    @InjectRepository(Payment) private payments: Repository<Payment>,
    @InjectRepository(StoragePreference) private prefs: Repository<StoragePreference>,
    @InjectRepository(StorageAuthorization) private auths: Repository<StorageAuthorization>,
    @InjectRepository(ContactAttempt) private attempts: Repository<ContactAttempt>,
    @InjectRepository(LockerDispositionCase) private cases: Repository<LockerDispositionCase>,
    @InjectRepository(DispositionOrder) private orders: Repository<DispositionOrder>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  // ============ 工具 ============

  private async accessibleAppointment(appointmentId: number, user: U): Promise<Appointment> {
    const a = await this.appts.findOne({ where: { id: appointmentId } });
    if (!a) throw new NotFoundException('预约单不存在');
    if (user.role === 'owner' && a.owner_id !== user.sub) throw new ForbiddenException('无权查看他人寄存信息');
    const staffRoles = ['customer_service', 'cs_supervisor', 'storage_manager', 'driver',
      'ceremonialist', 'cremator', 'artisan', 'finance'];
    if (staffRoles.includes(user.role) && a.store_id !== user.store_id) {
      throw new ForbiddenException('跨门店数据不可访问');
    }
    return a;
  }

  private async event(appointmentId: number, nodeKey: string, title: string,
    opts: { flag?: 'normal' | 'exception' | 'resolved'; actor?: U; note?: string; media?: string[] } = {}) {
    return this.timeline.save(this.timeline.create({
      appointment_id: appointmentId, node_key: nodeKey, title,
      flag: opts.flag || 'normal', actor_id: opts.actor?.sub, actor_role: opts.actor?.role,
      note: opts.note || null, media_urls: opts.media || null, occurred_at: new Date(),
    }));
  }

  private seq(prefix: string) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${prefix}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${Math.floor(Math.random() * 9000 + 1000)}`;
  }

  private monthlyRate(locker: Locker) {
    // 月单价保留全精度，仅在计算整期总价时舍入一次，避免 680/12×12=680.04 的累计误差
    return Number(locker.annual_fee) / 12;
  }

  /** 该工单全部未结服务费用（含待家属确认变更与已确认未支付余额） */
  private async outstanding(appointmentId: number, currentFeeId?: number) {
    const [fees, pays] = await Promise.all([
      this.fees.find({ where: { appointment_id: appointmentId } }),
      this.payments.find({ where: { appointment_id: appointmentId } }),
    ]);
    let payable = 0;
    const pending: FeeItem[] = [];
    for (const f of fees) {
      if (f.confirm_status === 'rejected') continue;
      if (currentFeeId && f.id === currentFeeId) continue;
      payable += Number(f.amount);
      if (f.confirm_status === 'pending') pending.push(f);
    }
    const paid = pays.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
      - pays.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
    return { balance: Math.round((payable - paid) * 100) / 100, pending };
  }

  // ============ 偏好与联系人 ============

  async setPreference(appointmentId: number, dto: any, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    if (user.role === 'owner' && a.owner_id !== user.sub) throw new ForbiddenException('仅本人可设置偏好');
    const exist = await this.prefs.findOne({ where: { appointment_id: appointmentId } });
    const base = exist || this.prefs.create({ appointment_id: appointmentId, contact_valid: 'unknown' });
    Object.assign(base, {
      contact_name: dto.contact_name || user.name,
      contact_phone: dto.contact_phone || '',
      alt_contact_name: dto.alt_contact_name || null,
      alt_contact_phone: dto.alt_contact_phone || null,
      preferred_channel: dto.preferred_channel || 'phone',
      preferred_action: dto.preferred_action || 'renew',
      notify_days: dto.notify_days != null ? Number(dto.notify_days) : 30,
      notes: dto.notes || null,
    });
    // 客服/主管编辑联系人视为一次有效性登记
    if (user.role !== 'owner') {
      base.contact_valid = dto.contact_valid || base.contact_valid || 'valid';
      base.checked_by = user.sub; base.checked_at = new Date();
    }
    const saved = await this.prefs.save(base);
    await this.event(appointmentId, 'storage_preference', `续费偏好已登记：${this.actionLabel(saved.preferred_action)}`,
      { actor: user, note: `主联系人 ${saved.contact_name} ${saved.contact_phone}；首选渠道 ${this.channelLabel(saved.preferred_channel)}` });
    return saved;
  }

  /** 客服核查联系人有效性（空号/拒收/停机标记 invalid） */
  async checkContact(appointmentId: number, dto: { valid: boolean; note?: string }, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    let pref = await this.prefs.findOne({ where: { appointment_id: appointmentId } });
    if (!pref) pref = this.prefs.create({
      appointment_id: appointmentId, contact_name: a.owner_id ? '' : '', contact_phone: '',
    });
    pref.contact_valid = dto.valid ? 'valid' : 'invalid';
    pref.checked_by = user.sub; pref.checked_at = new Date();
    const saved = await this.prefs.save(pref);
    await this.event(appointmentId, 'contact_check',
      dto.valid ? '联系人有效性核查：有效' : '联系人有效性核查：失效（空号/停机/拒收）',
      { actor: user, flag: dto.valid ? 'normal' : 'exception', note: dto.note });
    return saved;
  }

  // ============ 授权文件 ============

  async uploadAuthorization(appointmentId: number, dto: any, user: U) {
    await this.accessibleAppointment(appointmentId, user);
    const doc = await this.auths.save(this.auths.create({
      appointment_id: appointmentId, doc_type: dto.doc_type || 'other',
      title: dto.title || '授权/证明文件', doc_no: dto.doc_no || null,
      file_url: dto.file_url, uploaded_by: user.role === 'owner' ? user.sub : user.sub,
      status: 'uploaded',
    }));
    await this.event(appointmentId, 'authorization_uploaded', `授权/证明文件已上传：${doc.title}`,
      { actor: user, media: [dto.file_url] });
    return doc;
  }

  /** 寄存主管复核授权文件 */
  async verifyAuthorization(docId: number, dto: { approve: boolean; note?: string }, user: U) {
    const doc = await this.auths.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException('授权文件不存在');
    await this.accessibleAppointment(doc.appointment_id, user);
    doc.status = dto.approve ? 'verified' : 'rejected';
    doc.verified_by = user.sub; doc.verified_at = new Date(); doc.verify_note = dto.note || null;
    await this.auths.save(doc);
    await this.event(doc.appointment_id, 'authorization_verified',
      dto.approve ? `授权文件复核通过：${doc.title}` : `授权文件未通过复核：${doc.title}`,
      { actor: user, flag: dto.approve ? 'resolved' : 'exception', note: dto.note });
    return doc;
  }

  // ============ 到期扫描：按主人偏好发送提醒 ============

  /** 到期扫描：按偏好生成 续费/取回/转长期 提醒；记录柜位剩余期限 */
  async scanReminders(user?: U) {
    const lockers = await this.lockers.find({
      where: { status: In(['occupied', 'expiring', 'expired']) },
    });
    let renewedReminder = 0, expired = 0;
    for (const l of lockers) {
      if (!l.expire_at || !l.appointment_id) continue;
      const days = Math.ceil((+l.expire_at - Date.now()) / 86400000);
      const pref = await this.prefs.findOne({ where: { appointment_id: l.appointment_id } });
      const ahead = pref?.notify_days || 30;

      if (days <= 0) {
        if (l.status === 'occupied' || l.status === 'expiring') {
          await this.lockers.update(l.id, { status: 'expired' });
          await this.ensureFollowup(l.appointment_id, 'locker_expired',
            `柜位 ${l.code} 已到期未续费，按规定联系家属确认续费/取回/转长期`);
          expired++;
        }
        continue;
      }

      if (days <= ahead) {
        if (l.status === 'occupied') {
          await this.lockers.update(l.id, { status: 'expiring' });
        }
        const action = pref?.preferred_action || 'renew';
        const trigger = action === 'retrieve' ? 'locker_retrieve_reminder'
          : action === 'longterm' ? 'locker_longterm_reminder' : 'locker_renew_reminder';
        // 已存在同类型未关闭提醒则不重复发送
        const exists = await this.followups.findOne({
          where: { appointment_id: l.appointment_id, trigger, status: 'scheduled' } });
        if (!exists) {
          const contact = pref
            ? `（联系人 ${pref.contact_name} ${pref.contact_phone}，${this.channelLabel(pref.preferred_channel)}）`
            : '';
          const content = this.reminderText(action, l, days) + contact;
          await this.followups.save(this.followups.create({
            appointment_id: l.appointment_id, trigger, planned_at: new Date(), content,
          }));
          await this.event(l.appointment_id, 'storage_reminder',
            `到期提醒已按偏好发送：${this.actionLabel(action)}（柜位剩余 ${days} 天）`,
            { note: content });
          renewedReminder++;
        }
      }
    }
    return { scanned: lockers.length, reminders: renewedReminder, expired };
  }

  private reminderText(action: string, l: Locker, days: number) {
    if (action === 'retrieve') return `柜位 ${l.code} 将于 ${days} 天后到期，您偏好「到期取回」，请预约到店领取骨灰`;
    if (action === 'longterm') return `柜位 ${l.code} 将于 ${days} 天后到期，您偏好「转长期寄存」，客服将与您比较长期柜位方案`;
    return `柜位 ${l.code} 将于 ${days} 天后到期，请及时续费（年费 ${l.annual_fee} 元/年）`;
  }

  private async ensureFollowup(appointmentId: number, trigger: string, content: string) {
    const found = await this.followups.findOne({ where: { appointment_id: appointmentId, trigger, status: 'scheduled' } });
    if (found) return found;
    return this.followups.save(this.followups.create({ appointment_id: appointmentId, trigger, planned_at: new Date(), content }));
  }

  // ============ 续费：三项校验 ============

  /**
   * 主人续费。系统校验：
   * 1) 柜位是否仍可续用（free/protected/他人预占 不可续；受保护柜位须先撤回处置）
   * 2) 年费价格是否变更（以当前柜位年费与上次寄存费用比对，向家属明示差额）
   * 3) 是否存在未结服务费用（未确认变更或欠费则拦截）
   */
  async renewCheck(appointmentId: number, dto: { months: number }, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    const locker = await this.lockers.findOne({ where: { appointment_id: appointmentId } });
    if (!locker) throw new BadRequestException('该工单没有在存柜位，无法续费');
    const months = Number(dto.months) > 0 ? Number(dto.months) : 12;

    // ① 柜位是否仍可续用
    const renewable = ['occupied', 'expiring', 'expired'].includes(locker.status);
    if (!renewable) {
      if (locker.status === 'protected') throw new BadRequestException('柜位已进入受保护待处置状态，需先撤回处置流程后方可续费');
      if (locker.status === 'reserved') throw new BadRequestException('柜位已被迁移指令预占，暂不可续用');
      throw new BadRequestException(`柜位当前状态「${locker.status}」不可续用`);
    }
    // 该柜位是否已被未完成处置指令占用
    const activeOrder = await this.orders.findOne({
      where: { appointment_id: appointmentId, status: 'pending' } });
    if (activeOrder) throw new BadRequestException('存在未完成的处置指令，请先撤回后再续费');

    // ② 年费价格是否变更
    const currentAnnual = Number(locker.annual_fee);
    const lastStorageFee = await this.fees.findOne({
      where: { appointment_id: appointmentId, kind: In(STORAGE_FEE_KINDS) },
      order: { id: 'DESC' },
    });
    let previousAnnual: number | null = null;
    if (lastStorageFee && lastStorageFee.period_months) {
      previousAnnual = Math.round(Number(lastStorageFee.amount) / lastStorageFee.period_months * 12 * 100) / 100;
    }
    const fee = Math.round(this.monthlyRate(locker) * months * 100) / 100;
    let priceChanged = false;
    let priceNote = `当前年费 ${currentAnnual.toFixed(2)} 元/年`;
    if (previousAnnual != null && Math.abs(previousAnnual - currentAnnual) > 0.01) {
      priceChanged = true;
      priceNote = `年费价格已变更：上次 ${previousAnnual.toFixed(2)} 元/年 → 当前 ${currentAnnual.toFixed(2)} 元/年`;
    }

    // ③ 未结服务费用
    const { balance, pending } = await this.outstanding(appointmentId);

    return {
      locker: { id: locker.id, code: locker.code, status: locker.status, expire_at: locker.expire_at },
      renewable: true, months, renewal_fee: fee, current_annual_fee: currentAnnual,
      previous_annual_fee: previousAnnual, price_changed: priceChanged, price_note: priceNote,
      outstanding_balance: balance, pending_fee_changes: pending.map(f => ({ id: f.id, title: f.title, amount: f.amount })),
      payable_now: Math.round((fee + Math.max(0, balance)) * 100) / 100,
      can_renew: balance <= 0.01 && pending.length === 0,
      block_reasons: [
        ...(balance > 0.01 ? [`存在未结服务费用 ${balance.toFixed(2)} 元`] : []),
        ...(pending.length ? [`存在 ${pending.length} 项家属未确认的费用变更`] : []),
      ],
    };
  }

  /** 执行续费（通过校验后）。openCase 用于家属处置期恢复联系时直接续闭环。 */
  async renewConfirm(appointmentId: number, dto: { months: number; acknowledge_price_change?: boolean }, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    const check = await this.renewCheck(appointmentId, { months: dto.months }, user);
    if (!check.can_renew) throw new BadRequestException(`续费被拦截：${check.block_reasons.join('；')}`);
    if (check.price_changed && !dto.acknowledge_price_change) {
      throw new BadRequestException(`年费价格已变更（${check.price_note}），需家属确认知晓后再续费`);
    }
    const locker = await this.lockers.findOne({ where: { id: check.locker.id } });
    const base = locker.expire_at && +locker.expire_at > Date.now() ? locker.expire_at : new Date();
    const newExpire = new Date(+base + check.months * 30 * 86400000);

    return this.ds.transaction(async tx => {
      await tx.getRepository(Locker).update(locker.id, { status: 'occupied', expire_at: newExpire });
      await tx.getRepository(FeeItem).insert(tx.getRepository(FeeItem).create({
        appointment_id: appointmentId, kind: 'storage_renew',
        title: `柜位 ${locker.code} 续费 ${check.months} 个月`,
        amount: String(check.renewal_fee.toFixed(2)),
        reason: check.price_changed
          ? `续费（${check.price_note}，家属已知晓价格变更）` : '寄存到期续费',
        operator_id: user.sub, entry_type: 'change', confirm_status: 'confirmed',
        period_months: check.months,
      }));
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: appointmentId, node_key: 'storage_renewed', flag: 'resolved',
        title: `柜位 ${locker.code} 续费 ${check.months} 个月，新到期 ${newExpire.toLocaleString('zh-CN')}`,
        actor_id: user.sub, actor_role: user.role, note: check.price_note, occurred_at: new Date(),
      }));
      // 关闭到期提醒
      await tx.getRepository(Followup).update(
        { appointment_id: appointmentId, status: 'scheduled' as any,
          trigger: In(['locker_expiring', 'locker_expired', 'locker_renew_reminder',
            'locker_retrieve_reminder', 'locker_longterm_reminder']) },
        { status: 'skipped' });
      // 处置期家属恢复联系续费 → 闭环处置案件（不允许还有未执行指令）
      const open = await tx.getRepository(LockerDispositionCase).findOne({
        where: { appointment_id: appointmentId, status: In(['contacting', 'awaiting_supervisor', 'awaiting_storage_review']) } });
      if (open) {
        await this.closeCaseResolved(tx, open, user, '家属恢复联系并完成续费');
      }
    });
  }

  // ============ 主人选择：取回 / 转长期 ============

  /** 家属选择到期取回（无需迁移，关闭提醒） */
  async chooseRetrieve(appointmentId: number, dto: { retrieve_at?: string; note?: string }, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    await this.followups.update(
      { appointment_id: appointmentId, status: 'scheduled' as any,
        trigger: In(['locker_expiring', 'locker_renew_reminder', 'locker_retrieve_reminder', 'locker_longterm_reminder']) },
      { status: 'skipped' });
    await this.event(appointmentId, 'storage_retrieve_choice', '家属选择到期取回骨灰', {
      actor: user, note: dto.retrieve_at ? `预计到店 ${new Date(dto.retrieve_at).toLocaleString('zh-CN')}` : (dto.note || '') });
  }

  /**
   * 转长期寄存：客服比较可用柜位、迁移时间、家属确认。
   * 仅返回候选，不锁定；提交方案时再次校验目标柜位仍空闲，避免承诺已被占用的位置。
   */
  async longtermCandidates(appointmentId: number, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    const cur = await this.lockers.findOne({ where: { appointment_id: appointmentId } });
    if (!cur) throw new BadRequestException('该工单没有在存柜位');
    const free = await this.lockers.find({
      where: { store_id: a.store_id, status: 'free' }, order: { tier: 'ASC', code: 'ASC' },
    });
    return {
      current: { id: cur.id, code: cur.code, tier: cur.tier, annual_fee: cur.annual_fee, expire_at: cur.expire_at },
      candidates: free.map(l => ({
        id: l.id, code: l.code, tier: l.tier, annual_fee: l.annual_fee,
        longterm_120m_fee: Math.round(Number(l.annual_fee) * 10 * 0.9 * 100) / 100, // 10 年九折
      })),
    };
  }

  /** 客服提出转长期方案 → 生成家属确认；目标柜位在确认前不预占 */
  async longtermPropose(appointmentId: number, dto: {
    target_locker_id: number; planned_move_at: string; note?: string;
  }, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    const cur = await this.lockers.findOne({ where: { appointment_id: appointmentId } });
    if (!cur) throw new BadRequestException('该工单没有在存柜位');
    const target = await this.lockers.findOne({ where: { id: Number(dto.target_locker_id), store_id: a.store_id } });
    if (!target) throw new NotFoundException('目标柜位不存在');
    if (target.id === cur.id) throw new BadRequestException('目标柜位与原柜位相同，无需迁移');
    if (target.status !== 'free') throw new BadRequestException(`目标柜位 ${target.code} 已被占用或处置预占，不能承诺该位置`);

    const moveAt = new Date(dto.planned_move_at);
    const fee120 = Math.round(Number(target.annual_fee) * 10 * 0.9 * 100) / 100;
    const content =
      `转长期寄存方案：原柜位 ${cur.code}（${cur.annual_fee} 元/年）→ 长期柜位 ${target.code}` +
      `（${target.annual_fee} 元/年，10 年长期价九折 ${fee120} 元）；拟迁移时间 ${moveAt.toLocaleString('zh-CN')}。${dto.note || ''} [LT]${target.id}|${moveAt.toISOString()}[/LT]`;
    const c = await this.confirms.save(this.confirms.create({
      appointment_id: appointmentId, subject: 'longterm_move',
      content, status: 'pending', requested_by: user.sub, reply_note: dto.note || null,
    }));
    await this.event(appointmentId, 'longterm_proposed',
      `客服提出转长期方案：${cur.code} → ${target.code}，待家属确认`,
      { actor: user, note: `迁移时间 ${moveAt.toLocaleString('zh-CN')}；目标柜位暂不预占，执行前再次校验` });
    return c;
  }

  /** 家属确认转长期方案 → 建立处置案件并生成迁移指令（预占目标柜位） */
  async longtermConfirm(confirmationId: number, dto: { approve: boolean; note?: string }, user: U) {
    const c = await this.confirms.findOne({ where: { id: confirmationId } });
    if (!c || c.subject !== 'longterm_move') throw new NotFoundException('转长期确认事项不存在');
    if (c.status !== 'pending') throw new BadRequestException('该方案已处理');
    const a = await this.accessibleAppointment(c.appointment_id, user);
    if (user.role === 'owner' && a.owner_id !== user.sub) throw new ForbiddenException('仅家属本人可确认');

    if (!dto.approve) {
      await this.confirms.update(c.id, { status: 'rejected', confirmed_at: new Date(), reply_note: dto.note });
      await this.event(c.appointment_id, 'longterm_proposed', '家属暂不接受转长期方案，继续协商',
        { actor: user, flag: 'exception', note: dto.note });
      return;
    }
    const marker = c.content.match(/\[LT\](\d+)\|([^[]+)\[\/LT\]/);
    if (!marker) throw new BadRequestException('方案内容缺少柜位标记');
    const targetId = Number(marker[1]);
    const moveAt = new Date(marker[2]);

    return this.ds.transaction(async tx => {
      // 关键：家属确认后、预占前再次校验目标柜位仍空闲，避免承诺已被占用位置
      const target = await tx.getRepository(Locker).findOne({ where: { id: targetId } });
      if (!target || target.store_id !== a.store_id) throw new BadRequestException('目标柜位不存在');
      if (target.status !== 'free') throw new BadRequestException(`目标柜位 ${target.code} 此刻已被占用，无法迁移，请重新比较柜位`);

      const cur = await tx.getRepository(Locker).findOne({ where: { appointment_id: c.appointment_id } });
      await tx.getRepository(Confirmation).update(c.id, { status: 'confirmed', confirmed_at: new Date(), reply_note: dto.note || '家属确认' });

      const csCase = await tx.getRepository(LockerDispositionCase).save(tx.getRepository(LockerDispositionCase).create({
        code: this.seq('DC-'), appointment_id: c.appointment_id, locker_id: cur.id, store_id: a.store_id,
        reason: 'owner_longterm_request', status: 'ordered', owner_choice: 'longterm',
        rounds_required: 0, cs_id: user.sub,
        target_locker_id: target.id, planned_move_at: moveAt, family_confirmed: true,
        supervisor_id: user.sub, supervisor_decision: 'approve', supervised_at: new Date(),
        supervisor_note: '家属主动申请转长期并已确认方案',
        reviewer_id: null,
      }));

      const order = await this.createOrderTx(tx, csCase, cur, {
        action: 'migrate', toLocker: target, plannedAt: moveAt, periodMonths: 120,
        note: '转长期寄存迁移（家属已确认）', createdBy: user.sub,
      });
      // 预占目标柜位
      await tx.getRepository(Locker).update(target.id, { status: 'reserved', reserved_for_order_id: order.id });

      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: c.appointment_id, node_key: 'longterm_confirmed', flag: 'normal',
        title: `家属确认转长期：${cur.code} → ${target.code}，迁移指令已生成并预占目标柜位`,
        actor_id: user.sub, actor_role: user.role, note: `迁移时间 ${moveAt.toLocaleString('zh-CN')}`, occurred_at: new Date(),
      }));
      return { case: csCase, order };
    });
  }

  // ============ 逾期处置：多轮联系 + 受保护 ============

  /** 客服登记一轮联系；满足轮次且仍无回应 → 柜位进入受保护待处置，转客服主管审批 */
  async addContactAttempt(caseId: number, dto: {
    channel: string; result: string; note?: string; evidence_urls?: string[]; contacted_at?: string;
  }, user: U) {
    const csCase = await this.cases.findOne({ where: { id: caseId } });
    if (!csCase) throw new NotFoundException('处置案件不存在');
    const a = await this.accessibleAppointment(csCase.appointment_id, user);
    if (!['contacting'].includes(csCase.status)) {
      throw new BadRequestException(`案件状态「${csCase.status}」不允许再登记联系`);
    }
    if (!CHANNELS.includes(dto.channel)) throw new BadRequestException('联系渠道不合法');

    const round = await this.attempts.count({ where: { case_id: caseId } }) + 1;
    const attempt = await this.attempts.save(this.attempts.create({
      case_id: caseId, appointment_id: csCase.appointment_id, round,
      channel: dto.channel, result: dto.result,
      contacted_at: dto.contacted_at ? new Date(dto.contacted_at) : new Date(),
      cs_id: user.sub, note: dto.note || null, evidence_urls: dto.evidence_urls || [],
    }));
    await this.event(csCase.appointment_id, 'contact_attempt',
      `第 ${round} 轮联系（${this.channelLabel(dto.channel)}）：${this.resultLabel(dto.result)}`,
      { actor: user, flag: ['reached', 'promised'].includes(dto.result) ? 'normal' : 'exception',
        note: dto.note, media: dto.evidence_urls || [] });

    // 联系上且家属承诺处理 → 暂缓处置（保持 contacting，等待家属动作）
    if (['reached', 'promised'].includes(dto.result)) {
      await this.cases.update(caseId, { last_attempt_at: new Date(), cs_id: user.sub });
      return { attempt, escalated: false };
    }

    const reached = await this.attempts.count({
      where: { case_id: caseId, result: In(['reached', 'promised']) } });
    const total = await this.attempts.count({ where: { case_id: caseId } });
    // 多轮（默认 3 轮）仍无有效回应 → 柜位受保护，提交客服主管审批
    if (reached === 0 && total >= csCase.rounds_required) {
      const protLocker = await this.lockers.findOne({ where: { id: csCase.locker_id } });
      await this.ds.transaction(async tx => {
        await tx.getRepository(Locker).update(csCase.locker_id, { status: 'protected' });
        await tx.getRepository(LockerDispositionCase).update(caseId, {
          status: 'awaiting_supervisor', last_attempt_at: new Date(), cs_id: user.sub });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: csCase.appointment_id, node_key: 'locker_protected', flag: 'exception',
          title: `多轮联系无回应，柜位 ${protLocker?.code || ''} 进入受保护待处置状态（禁止释放/再分配），提请客服主管审批`,
          actor_id: user.sub, actor_role: user.role,
          note: `已完成 ${total} 轮联系，渠道与证明材料已留存`, occurred_at: new Date(),
        }));
      });
      return { attempt, escalated: true };
    }
    await this.cases.update(caseId, { last_attempt_at: new Date(), cs_id: user.sub });
    return { attempt, escalated: false };
  }

  // ============ 双审批 ============

  /** 客服主管审批下一步处理 */
  async supervisorApprove(caseId: number, dto: { approve: boolean; note?: string }, user: U) {
    const csCase = await this.cases.findOne({ where: { id: caseId } });
    if (!csCase) throw new NotFoundException('处置案件不存在');
    await this.accessibleAppointment(csCase.appointment_id, user);
    if (csCase.status !== 'awaiting_supervisor') throw new BadRequestException('当前状态无需客服主管审批');
    if (!dto.approve) {
      await this.ds.transaction(async tx => {
        await tx.getRepository(LockerDispositionCase).update(caseId, {
          status: 'contacting', supervisor_id: user.sub, supervisor_decision: 'reject',
          supervisor_note: dto.note, supervised_at: new Date() });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: csCase.appointment_id, node_key: 'supervisor_review', flag: 'normal',
          title: '客服主管退回，要求补充联系', actor_id: user.sub, actor_role: user.role,
          note: dto.note || '继续多轮联系', occurred_at: new Date() }));
      });
      return;
    }
    await this.ds.transaction(async tx => {
      await tx.getRepository(LockerDispositionCase).update(caseId, {
        status: 'awaiting_storage_review', supervisor_id: user.sub,
        supervisor_decision: 'approve', supervisor_note: dto.note || null, supervised_at: new Date() });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: csCase.appointment_id, node_key: 'supervisor_review', flag: 'normal',
        title: '客服主管批准进入下一步，转送寄存主管复核授权与证据',
        actor_id: user.sub, actor_role: user.role, note: dto.note, occurred_at: new Date() }));
    });
  }

  /** 寄存主管复核授权与证据后，生成处置指令（迁移 / 继续保管 / 取回 / 其他） */
  async storageReviewAndOrder(caseId: number, dto: {
    approve: boolean; note?: string;
    action?: DispositionAction; target_locker_id?: number; period_months?: number;
    planned_at?: string; action_note?: string;
  }, user: U) {
    const csCase = await this.cases.findOne({ where: { id: caseId } });
    if (!csCase) throw new NotFoundException('处置案件不存在');
    await this.accessibleAppointment(csCase.appointment_id, user);
    if (csCase.status !== 'awaiting_storage_review') throw new BadRequestException('当前状态无需寄存主管复核');

    // 复核证据：必须有规定轮次联系记录
    const attempts = await this.attempts.find({ where: { case_id: caseId }, order: { round: 'ASC' } });
    if (attempts.length < csCase.rounds_required) {
      throw new BadRequestException(`联系轮次不足（要求 ${csCase.rounds_required} 轮，实际 ${attempts.length} 轮）`);
    }
    if (!attempts.some(x => x.evidence_urls && x.evidence_urls.length)) {
      throw new BadRequestException('缺少联系证明材料（录音/截图/信函底单/上门照片），不可生成处置指令');
    }

    if (!dto.approve) {
      await this.ds.transaction(async tx => {
        await tx.getRepository(LockerDispositionCase).update(caseId, {
          status: 'contacting', reviewer_id: user.sub, review_decision: 'reject',
          review_note: dto.note, reviewed_at: new Date() });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: csCase.appointment_id, node_key: 'storage_review', flag: 'exception',
          title: '寄存主管复核未通过，退回补充联系/授权', actor_id: user.sub, actor_role: user.role,
          note: dto.note, occurred_at: new Date() }));
      });
      return;
    }

    const action: DispositionAction = dto.action || 'continue_storage';
    if (!['migrate', 'continue_storage', 'retrieve', 'other'].includes(action)) {
      throw new BadRequestException('处置类型不合法');
    }
    const period = dto.period_months != null ? Number(dto.period_months)
      : action === 'continue_storage' ? 12 : action === 'migrate' ? 120 : null;

    return this.ds.transaction(async tx => {
      const cur = await tx.getRepository(Locker).findOne({ where: { id: csCase.locker_id } });
      let target: Locker | null = null;
      if (action === 'migrate') {
        if (!dto.target_locker_id) throw new BadRequestException('迁移处置必须指定目标柜位');
        target = await tx.getRepository(Locker).findOne({ where: { id: Number(dto.target_locker_id) } });
        if (!target || target.store_id !== csCase.store_id) throw new BadRequestException('目标柜位不存在');
        if (target.status !== 'free') throw new BadRequestException(`目标柜位 ${target.code} 已被占用，不可迁移`);
      }
      await tx.getRepository(LockerDispositionCase).update(caseId, {
        status: 'ordered', reviewer_id: user.sub, review_decision: 'approve',
        review_note: dto.note || '授权与证据复核通过', reviewed_at: new Date(),
        target_locker_id: target ? target.id : null,
        planned_move_at: dto.planned_at ? new Date(dto.planned_at) : null,
      });
      const order = await this.createOrderTx(tx, csCase, cur, {
        action, toLocker: target, plannedAt: dto.planned_at ? new Date(dto.planned_at) : new Date(),
        periodMonths: period, note: dto.action_note || dto.note, createdBy: user.sub,
      });
      if (target) {
        await tx.getRepository(Locker).update(target.id, { status: 'reserved', reserved_for_order_id: order.id });
      }
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: csCase.appointment_id, node_key: 'disposition_ordered', flag: 'normal',
        title: `寄存主管复核通过，处置指令已生成：${this.actionLabel(action)}（${order.order_no}）`,
        actor_id: user.sub, actor_role: user.role,
        note: `授权/联系证据已复核；原柜位 ${cur.code} 永久保留追溯`, occurred_at: new Date() }));
      return order;
    });
  }

  private async createOrderTx(tx: any, csCase: LockerDispositionCase, cur: Locker, opts: {
    action: DispositionAction; toLocker: Locker | null; plannedAt: Date;
    periodMonths: number | null; note?: string; createdBy: number;
  }) {
    const order = await tx.getRepository(DispositionOrder).save(tx.getRepository(DispositionOrder).create({
      order_no: this.seq('DO-'), case_id: csCase.id, appointment_id: csCase.appointment_id,
      action: opts.action, status: 'pending',
      from_locker_id: cur.id, from_locker_code: cur.code,
      to_locker_id: opts.toLocker ? opts.toLocker.id : null,
      to_locker_code: opts.toLocker ? opts.toLocker.code : null,
      period_months: opts.periodMonths, planned_at: opts.plannedAt,
      action_note: opts.note || null, created_by: opts.createdBy,
    }));
    // 继续保管/迁移产生续费账单（周期费用），撤回时冲红
    if (opts.periodMonths && (opts.action === 'continue_storage' || opts.action === 'migrate')) {
      const rateLocker = opts.toLocker || cur;
      const amount = opts.action === 'migrate'
        ? Math.round(Number(rateLocker.annual_fee) * (opts.periodMonths / 12) * 0.9 * 100) / 100
        : Math.round(Number(rateLocker.annual_fee) / 12 * opts.periodMonths * 100) / 100;
      const fee = await tx.getRepository(FeeItem).save(tx.getRepository(FeeItem).create({
        appointment_id: csCase.appointment_id,
        kind: opts.action === 'migrate' ? 'storage_longterm' : 'storage_renew',
        title: opts.action === 'migrate'
          ? `转长期寄存 ${opts.toLocker?.code || ''} ${opts.periodMonths} 个月`
          : `处置-继续保管 ${opts.periodMonths} 个月`,
        amount: String(amount.toFixed(2)), reason: '柜位到期处置指令费用',
        operator_id: opts.createdBy, entry_type: 'change', confirm_status: 'pending',
        period_months: opts.periodMonths,
      }));
      order.fee_item_id = fee.id;
      await tx.getRepository(DispositionOrder).update(order.id, { fee_item_id: fee.id });
    }
    return order;
  }

  // ============ 执行处置（留痕：原柜位/交接人/时间）============

  async executeOrder(orderId: number, dto: {
    handover_by: string; note?: string; evidence_urls?: string[];
  }, user: U) {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('处置指令不存在');
    const csCase = await this.cases.findOne({ where: { id: order.case_id } });
    await this.accessibleAppointment(order.appointment_id, user);
    if (order.status !== 'pending') throw new BadRequestException('该指令不是待执行状态');

    return this.ds.transaction(async tx => {
      const from = await tx.getRepository(Locker).findOne({ where: { id: order.from_locker_id } });
      const now = new Date();

      if (order.action === 'migrate') {
        const to = await tx.getRepository(Locker).findOne({ where: { id: order.to_locker_id } });
        if (!to || (to.status !== 'reserved' && to.status !== 'free') ||
            (to.reserved_for_order_id && to.reserved_for_order_id !== order.id)) {
          throw new BadRequestException(`目标柜位 ${to?.code} 当前不可迁入`);
        }
        // 原柜位释放为空闲；目标柜位转为占用并承接工单
        await tx.getRepository(Locker).update(from.id, {
          status: 'free', appointment_id: null, expire_at: null, occupied_since: null,
          reserved_for_order_id: null,
        });
        const newExpire = new Date(now.getTime() + (order.period_months || 120) * 30 * 86400000);
        await tx.getRepository(Locker).update(to.id, {
          status: 'occupied', appointment_id: order.appointment_id,
          occupied_since: now, expire_at: newExpire, reserved_for_order_id: null,
        });
      } else if (order.action === 'retrieve') {
        // 家属取回：原柜位释放
        await tx.getRepository(Locker).update(from.id, {
          status: 'free', appointment_id: null, expire_at: null, occupied_since: null,
          reserved_for_order_id: null,
        });
      } else if (order.action === 'continue_storage') {
        // 继续保管：仍在原柜位，延长到期
        const newExpire = new Date(Math.max(now.getTime(), from.expire_at ? +from.expire_at : now.getTime())
          + (order.period_months || 12) * 30 * 86400000);
        await tx.getRepository(Locker).update(from.id, { status: 'occupied', expire_at: newExpire });
      }
      // other：柜位维持受保护，等待具体合规处置，不改变占用

      // 处置费用（如有）转为已确认
      if (order.fee_item_id) {
        await tx.getRepository(FeeItem).update(order.fee_item_id, { confirm_status: 'confirmed' });
      }

      await tx.getRepository(DispositionOrder).update(order.id, {
        status: 'executed', handover_by: dto.handover_by, executed_by: user.sub,
        executed_at: now, execute_note: dto.note || null, evidence_urls: dto.evidence_urls || [],
      });
      await tx.getRepository(LockerDispositionCase).update(csCase.id, { status: 'executed' });

      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: order.appointment_id, node_key: 'disposition_executed', flag: 'resolved',
        title: `处置执行：${this.actionLabel(order.action)}（原柜位 ${order.from_locker_code}` +
          `${order.to_locker_code ? ` → ${order.to_locker_code}` : ''}）`,
        actor_id: user.sub, actor_role: user.role,
        note: `交接人员：${dto.handover_by}；执行时间：${now.toLocaleString('zh-CN')}${dto.note ? `；${dto.note}` : ''}`,
        media_urls: dto.evidence_urls || [], occurred_at: now,
      }));
      // 家属后续回访任务
      await tx.getRepository(Followup).insert(tx.getRepository(Followup).create({
        appointment_id: order.appointment_id, trigger: 'disposition_followup', planned_at: now,
        content: `处置（${this.actionLabel(order.action)}）已执行，请回访家属确认安置情况与满意度`,
      }));
    });
  }

  /** 登记家属后续回访结果（任何处置都须保留回访结果） */
  async orderFollowUp(orderId: number, dto: { result: string }, user: U) {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('处置指令不存在');
    await this.accessibleAppointment(order.appointment_id, user);
    if (order.status !== 'executed') throw new BadRequestException('处置尚未执行，不能登记回访');
    await this.orders.update(orderId, {
      follow_up_result: dto.result, follow_up_by: user.sub, follow_up_at: new Date(),
    });
    await this.event(order.appointment_id, 'disposition_followup',
      `处置后家属回访结果已记录（${order.order_no}）`, { actor: user, note: dto.result });
  }

  // ============ 执行前撤回：恢复账单与柜位 ============

  /** 主人在处置执行前恢复联系：撤回未完成指令，恢复账单与柜位状态 */
  async withdrawCase(caseId: number, dto: { note?: string }, user: U) {
    const csCase = await this.cases.findOne({ where: { id: caseId } });
    if (!csCase) throw new NotFoundException('处置案件不存在');
    await this.accessibleAppointment(csCase.appointment_id, user);
    const staffOk = ['customer_service', 'cs_supervisor', 'storage_manager', 'manager'].includes(user.role);
    if (user.role === 'owner') {
      const a = await this.appts.findOne({ where: { id: csCase.appointment_id } });
      if (a.owner_id !== user.sub) throw new ForbiddenException('仅本人或员工可操作');
    } else if (!staffOk) throw new ForbiddenException('当前角色无权撤回处置');

    const pendingOrders = await this.orders.find({ where: { case_id: caseId, status: 'pending' as any } });
    if (!pendingOrders.length && ['executed', 'withdrawn', 'closed_resolved'].includes(csCase.status)) {
      throw new BadRequestException('案件无可撤回的未完成指令');
    }

    return this.ds.transaction(async tx => {
      for (const o of pendingOrders) {
        // 释放迁移预占的目标柜位
        if (o.to_locker_id) {
          const to = await tx.getRepository(Locker).findOne({ where: { id: o.to_locker_id } });
          if (to && to.status === 'reserved' && to.reserved_for_order_id === o.id) {
            await tx.getRepository(Locker).update(to.id, { status: 'free', reserved_for_order_id: null });
          }
        }
        // 恢复账单：处置阶段费用未确认直接作废；已确认则开等额冲红行
        if (o.fee_item_id) {
          const fee = await tx.getRepository(FeeItem).findOne({ where: { id: o.fee_item_id } });
          if (fee) {
            if (fee.confirm_status === 'pending') {
              await tx.getRepository(FeeItem).update(fee.id, { confirm_status: 'rejected' });
            } else if (fee.confirm_status === 'confirmed') {
              await tx.getRepository(FeeItem).insert(tx.getRepository(FeeItem).create({
                appointment_id: csCase.appointment_id, kind: fee.kind,
                title: `【撤回冲红】${fee.title}`, amount: String((-Number(fee.amount)).toFixed(2)),
                reason: `处置指令 ${o.order_no} 执行前撤回，恢复账单`, operator_id: user.sub,
                entry_type: 'change', confirm_status: 'confirmed', period_months: fee.period_months,
              }));
            }
          }
        }
        await tx.getRepository(DispositionOrder).update(o.id, { status: 'withdrawn' });
      }
      // 恢复原柜位：受保护/占用回到「占用中」，到期日按原剩余期限（保留 expire_at 快照）
      const from = await tx.getRepository(Locker).findOne({ where: { id: csCase.locker_id } });
      if (from) {
        const restoreStatus = from.appointment_id ? (from.expire_at && +from.expire_at < Date.now() ? 'expired' : 'occupied') : 'free';
        await tx.getRepository(Locker).update(from.id, {
          status: restoreStatus, appointment_id: csCase.appointment_id,
          reserved_for_order_id: null,
        });
      }
      await tx.getRepository(LockerDispositionCase).update(caseId, {
        status: 'withdrawn', withdrawn_by: user.sub, withdrawn_at: new Date(),
        withdraw_note: dto.note || '家属在处置执行前恢复联系',
      });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: csCase.appointment_id, node_key: 'disposition_withdrawn', flag: 'resolved',
        title: '处置执行前家属恢复联系，未完成指令已撤回，账单与柜位状态已恢复',
        actor_id: user.sub, actor_role: user.role,
        note: `撤回 ${pendingOrders.length} 条指令；原柜位 ${from?.code} 保留${dto.note ? `；${dto.note}` : ''}`,
        occurred_at: new Date() }));
    });
  }

  /** 处置期家属自行续费/取回，案件闭环（不产生撤回） */
  private async closeCaseResolved(tx: any, csCase: LockerDispositionCase, user: U, note: string) {
    const pendingOrders = await tx.getRepository(DispositionOrder).find({
      where: { case_id: csCase.id, status: 'pending' as any } });
    for (const o of pendingOrders) {
      if (o.to_locker_id) {
        await tx.getRepository(Locker).update(o.to_locker_id, { status: 'free', reserved_for_order_id: null });
      }
      await tx.getRepository(DispositionOrder).update(o.id, { status: 'withdrawn' });
    }
    if (csCase.locker_id) {
      await tx.getRepository(Locker).update(csCase.locker_id, { status: 'occupied', reserved_for_order_id: null });
    }
    await tx.getRepository(LockerDispositionCase).update(csCase.id, { status: 'closed_resolved' });
    await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
      appointment_id: csCase.appointment_id, node_key: 'case_closed_resolved', flag: 'resolved',
      title: `处置案件闭环：${note}`, actor_id: user.sub, actor_role: user.role, occurred_at: new Date() }));
  }

  // ============ 查询 ============

  async storageDetail(appointmentId: number, user: U) {
    await this.accessibleAppointment(appointmentId, user);
    const [preference, authorizations, locker, openCase, cases, followups] = await Promise.all([
      this.prefs.findOne({ where: { appointment_id: appointmentId } }),
      this.auths.find({ where: { appointment_id: appointmentId }, order: { id: 'DESC' } }),
      this.lockers.findOne({ where: { appointment_id: appointmentId } }),
      this.cases.findOne({
        where: { appointment_id: appointmentId,
          status: In(['contacting', 'awaiting_supervisor', 'awaiting_storage_review', 'ordered']) } }),
      this.cases.find({ where: { appointment_id: appointmentId }, order: { id: 'DESC' } }),
      this.followups.find({ where: { appointment_id: appointmentId }, order: { id: 'DESC' } }),
    ]);
    let openCaseDetail: any = openCase || null;
    if (openCase) {
      const [attempts, orders] = await Promise.all([
        this.attempts.find({ where: { case_id: openCase.id }, order: { round: 'ASC' } }),
        this.orders.find({ where: { case_id: openCase.id }, order: { id: 'ASC' } }),
      ]);
      openCaseDetail = { ...openCase, attempts, orders };
    }
    return { preference, authorizations, locker, open_case: openCaseDetail, cases, followups };
  }

  async listCases(user: U, status?: string) {
    const qb = this.cases.createQueryBuilder('c').orderBy('c.id', 'DESC');
    if (user.role !== 'manager' &&
        ['customer_service', 'cs_supervisor', 'storage_manager', 'finance'].includes(user.role)) {
      qb.where('c.store_id = :sid', { sid: user.store_id });
    } else if (user.role === 'owner') {
      const mine = await this.appts.find({ where: { owner_id: user.sub }, select: { id: true } });
      const ids = mine.map(a => a.id);
      qb.where('c.appointment_id IN (:...ids)', { ids: ids.length ? ids : [0] });
    }
    if (status) qb.andWhere('c.status = :st', { st: status });
    const list = await qb.limit(200).getMany();
    // 附带宠物名/柜位号/联系轮次
    const apptIds = [...new Set(list.map(c => c.appointment_id))];
    const appts = apptIds.length
      ? await this.appts.findByIds(apptIds)
      : [];
    const lockerIds = [...new Set(list.map(c => c.locker_id))];
    const lockers = lockerIds.length ? await this.lockers.findByIds(lockerIds) : [];
    const amap: Record<number, any> = {}; appts.forEach(a => { amap[a.id] = a; });
    const lmap: Record<number, any> = {}; lockers.forEach(l => { lmap[l.id] = l; });
    const rounds: Record<number, number> = {};
    if (list.length) {
      const att = await this.attempts.find({ where: { case_id: In(list.map(c => c.id)) } });
      att.forEach(x => { rounds[x.case_id] = (rounds[x.case_id] || 0) + 1; });
    }
    return list.map(c => ({
      ...c, pet_name: amap[c.appointment_id]?.pet_name,
      appt_code: amap[c.appointment_id]?.code,
      locker_code: lmap[c.locker_id]?.code,
      attempts_done: rounds[c.id] || 0,
    }));
  }

  async caseDetail(caseId: number, user: U) {
    const csCase = await this.cases.findOne({ where: { id: caseId } });
    if (!csCase) throw new NotFoundException('处置案件不存在');
    await this.accessibleAppointment(csCase.appointment_id, user);
    const [attempts, orders, appt, preference, authorizations] = await Promise.all([
      this.attempts.find({ where: { case_id: caseId }, order: { round: 'ASC' } }),
      this.orders.find({ where: { case_id: caseId }, order: { id: 'ASC' } }),
      this.appts.findOne({ where: { id: csCase.appointment_id } }),
      this.prefs.findOne({ where: { appointment_id: csCase.appointment_id } }),
      this.auths.find({ where: { appointment_id: csCase.appointment_id }, order: { id: 'DESC' } }),
    ]);
    const owner = await this.users.findOne({ where: { id: appt.owner_id } });
    const locker = await this.lockers.findOne({ where: { id: csCase.locker_id } });
    const target = csCase.target_locker_id
      ? await this.lockers.findOne({ where: { id: csCase.target_locker_id } }) : null;
    return {
      case: csCase, attempts, orders, appointment: {
        id: appt.id, code: appt.code, pet_name: appt.pet_name, store_id: appt.store_id,
        owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone } : null,
      },
      locker, target_locker: target, preference, authorizations,
    };
  }

  /** 客服对一个已逾期柜位手工开案（进入多轮联系流程） */
  async openCase(appointmentId: number, dto: { rounds_required?: number; reason?: string }, user: U) {
    const a = await this.accessibleAppointment(appointmentId, user);
    const locker = await this.lockers.findOne({ where: { appointment_id: appointmentId } });
    if (!locker) throw new BadRequestException('该工单没有在存柜位');
    const exist = await this.cases.findOne({
      where: { appointment_id: appointmentId,
        status: In(['contacting', 'awaiting_supervisor', 'awaiting_storage_review', 'ordered']) } });
    if (exist) throw new BadRequestException('该柜位已存在进行中的处置案件');
    const remainDays = locker.expire_at ? Math.ceil((+locker.expire_at - Date.now()) / 86400000) : 0;
    const csCase = await this.cases.save(this.cases.create({
      code: this.seq('DC-'), appointment_id: appointmentId, locker_id: locker.id, store_id: a.store_id,
      reason: dto.reason || 'overdue_no_response', status: 'contacting',
      rounds_required: dto.rounds_required != null ? Number(dto.rounds_required) : 3,
      remain_days_snapshot: remainDays, cs_id: user.sub,
    }));
    await this.event(appointmentId, 'case_opened',
      `柜位到期处置案件已立案（${csCase.code}），启动多轮联系，柜位剩余期限 ${remainDays} 天`,
      { actor: user, flag: 'exception' });
    return csCase;
  }

  // ============ 文案 ============
  private actionLabel(a: string) {
    return ({ renew: '续费', retrieve: '到期取回', longterm: '转长期寄存',
      migrate: '迁移长期柜位', continue_storage: '继续保管', other: '其他合规处置' } as any)[a] || a;
  }
  private channelLabel(c: string) {
    return ({ phone: '电话', sms: '短信', wechat: '微信', email: '邮件', letter: '书面信函', onsite: '上门' } as any)[c] || c;
  }
  private resultLabel(r: string) {
    return ({ reached: '已联系上', promised: '家属承诺处理', no_answer: '无人接听',
      bounced: '空号/停机/退信', refused: '明确拒绝', message_left: '已留言待回' } as any)[r] || r;
  }
}

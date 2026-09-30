import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Appointment, TimelineEvent } from '../entities/appointment';
import { Confirmation, FeeItem } from '../entities/ops';
import { Followup, Locker } from '../entities/aftercare';
import { Payment } from '../entities/billing';
import {
  ContactAttempt, FamilyCallback, StorageContact, StorageDirective, StorageDisposalCase,
} from '../entities/storage';
import { WorkflowService } from '../workflow/workflow.service';

type U = { sub: number; name: string; role: string; store_id?: number };

const STAFF = ['customer_service', 'cs_lead', 'storage_lead', 'manager'];

/** 多轮联系的最低规定：至少 3 轮、覆盖至少 2 种渠道 */
const MIN_ROUNDS = 3;
const MIN_CHANNELS = 2;
/** 过期宽限天数（仅用于扫描提示，不自动保护） */
const GRACE_DAYS = 15;

const REACHED_RESULTS = ['reached', 'promised_renew', 'promised_retrieve', 'promised_long_term'];

/**
 * 骨灰寄存到期续费、授权与柜位处置工作流：
 * 到期提醒（按偏好）→ 续费校验（可续用/年费变更/未结费用）→ 转长期寄存（柜位比较+家属确认）
 * → 逾期多轮联系 → 受保护待处置（禁止释放/再分配）→ 客服主管审批 → 寄存主管复核
 * → 处置指令（迁移/继续保管/其他，留原柜位/交接人/时间/回访）→ 执行前主人恢复联系可撤回并恢复账单柜位。
 */
@Injectable()
export class StorageService {
  constructor(
    private ds: DataSource,
    private wf: WorkflowService,
    @InjectRepository(Locker) private lockerRepo: Repository<Locker>,
    @InjectRepository(StorageContact) private contactRepo: Repository<StorageContact>,
    @InjectRepository(ContactAttempt) private attemptRepo: Repository<ContactAttempt>,
    @InjectRepository(StorageDisposalCase) private caseRepo: Repository<StorageDisposalCase>,
    @InjectRepository(StorageDirective) private dirRepo: Repository<StorageDirective>,
    @InjectRepository(FamilyCallback) private callbackRepo: Repository<FamilyCallback>,
    @InjectRepository(Appointment) private apptRepo: Repository<Appointment>,
    @InjectRepository(Followup) private followRepo: Repository<Followup>,
  ) {}

  // ============ 基础工具 ============

  private async timeline(
    appointmentId: number, nodeKey: string, title: string,
    opts: { flag?: 'normal' | 'exception' | 'resolved'; actor?: U; note?: string;
            media?: string[]; promisedAt?: Date } = {},
  ) {
    return this.ds.getRepository(TimelineEvent).save(this.ds.getRepository(TimelineEvent).create({
      appointment_id: appointmentId, node_key: nodeKey, title,
      flag: opts.flag || 'normal', actor_id: opts.actor?.sub, actor_role: opts.actor?.role,
      note: opts.note || null, media_urls: opts.media || null,
      promised_at: opts.promisedAt || null, occurred_at: new Date(),
    }));
  }

  /** 应付余额 = 全部有效费用（基础项+已确认变更）- 已收 + 已退；被冲销的费用行不计入 */
  private async balanceOf(m: DataSource | any, apptId: number): Promise<number> {
    const fees = await m.getRepository(FeeItem).find({ where: { appointment_id: apptId } });
    const charges = fees
      .filter(f => !f.voided && (f.entry_type === 'base' || f.confirm_status === 'confirmed'))
      .reduce((s, f) => s + Number(f.amount), 0);
    const pays = await m.getRepository(Payment).find({ where: { appointment_id: apptId } });
    const paid = pays.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);
    const refunded = pays.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
    return Math.round((charges - paid + refunded) * 100) / 100;
  }

  private async getContact(m: DataSource | any, apptId: number): Promise<StorageContact | null> {
    return m.getRepository(StorageContact).findOne({ where: { appointment_id: apptId } });
  }

  /**
   * 解析工单当前所在柜位。
   * 迁移预占期间同一工单会临时关联两个柜位（源柜 + protected 预占目标），
   * 此时「当前柜位」是非保护态的源柜；处置后仅新柜占用则返回新柜。
   */
  private async currentLockerOf(m: DataSource | any, apptId: number): Promise<Locker | null> {
    const rows: Locker[] = await m.getRepository(Locker).find({ where: { appointment_id: apptId } });
    if (!rows.length) return null;
    return rows.find(l => l.status !== 'protected') || rows[0];
  }

  private async ensureContact(apptId: number): Promise<StorageContact> {
    let c = await this.contactRepo.findOne({ where: { appointment_id: apptId } });
    if (!c) c = await this.contactRepo.save(this.contactRepo.create({ appointment_id: apptId }));
    return c;
  }

  private async activeCase(m: DataSource | any, apptId: number): Promise<StorageDisposalCase | null> {
    return m.getRepository(StorageDisposalCase).findOne({
      where: { appointment_id: apptId, status: In(['cs_lead_pending', 'storage_lead_pending', 'approved']) },
      order: { id: 'DESC' },
    });
  }

  // ============ 寄存视图（工单详情聚合） ============

  async storageView(apptId: number, user: U) {
    const a = await this.wf.getAccessible(apptId, user);
    const m = this.ds;
    const [contact, attempts, locker, cases, directives, callbacks, fees, pays] = await Promise.all([
      this.getContact(m, apptId),
      m.getRepository(ContactAttempt).find({ where: { appointment_id: apptId }, order: { id: 'ASC' } }),
      this.currentLockerOf(m, apptId),
      m.getRepository(StorageDisposalCase).find({ where: { appointment_id: apptId }, order: { id: 'DESC' } }),
      m.getRepository(StorageDirective).find({ where: { appointment_id: apptId }, order: { id: 'DESC' } }),
      m.getRepository(FamilyCallback).find({ where: { appointment_id: apptId }, order: { id: 'DESC' } }),
      m.getRepository(FeeItem).find({ where: { appointment_id: apptId } }),
      m.getRepository(Payment).find({ where: { appointment_id: apptId } }),
    ]);
    const balance = Math.round((
      fees.filter((f: FeeItem) => !f.voided
        && (f.entry_type === 'base' || f.confirm_status === 'confirmed'))
        .reduce((s: number, f: FeeItem) => s + Number(f.amount), 0)
      - pays.filter((p: Payment) => p.status === 'paid').reduce((s: number, p: Payment) => s + Number(p.amount), 0)
      + pays.filter((p: Payment) => p.status === 'refunded').reduce((s: number, p: Payment) => s + Number(p.amount), 0)
    ) * 100) / 100;

    // 续费校验：柜位可续用 / 年费是否变更 / 是否存在未结服务费用
    const renewCheck: any = { balance, blockers: [] as string[] };
    if (!locker) {
      renewCheck.renewable = false;
      renewCheck.blockers.push('尚未入柜寄存');
    } else {
      renewCheck.locker_id = locker.id;
      renewCheck.current_fee = Number(locker.annual_fee);
      renewCheck.assigned_fee = locker.annual_fee_at_assign != null ? Number(locker.annual_fee_at_assign) : null;
      renewCheck.price_changed = renewCheck.assigned_fee != null
        && renewCheck.assigned_fee !== renewCheck.current_fee;
      if (locker.status === 'free') renewCheck.blockers.push('柜位当前空闲，无需续费');
      if (locker.status === 'protected') {
        renewCheck.blockers.push('柜位处于受保护待处置/迁移预占状态，不能直接续费；如主人已恢复联系，请先撤回待执行处置指令');
      }
      if (balance > 0.01) renewCheck.blockers.push(`存在未结服务费用 ${balance} 元，需先结清`);
      if (renewCheck.price_changed) {
        renewCheck.blockers.push(
          `年费价格已变更：入柜时 ${renewCheck.assigned_fee} 元/年，现行 ${renewCheck.current_fee} 元/年，续费前须向家属明示并确认`);
      }
      renewCheck.renewable = renewCheck.blockers.length === 0;
    }

    // 转长期寄存：可比较的可用柜位（同门店空闲柜，避免承诺已占用的位置）
    const longTermOptions = locker
      ? (await m.getRepository(Locker).find({
        where: { store_id: a.store_id, status: 'free' }, order: { tier: 'DESC', code: 'ASC' },
      })).map(l => ({ id: l.id, code: l.code, tier: l.tier, annual_fee: Number(l.annual_fee) }))
      : [];

    // 处置申请资格：过期 + 多轮联系合规
    const channels = new Set(attempts.map((x: ContactAttempt) => x.channel));
    const lastAttempt = attempts[attempts.length - 1];
    const reached = lastAttempt && REACHED_RESULTS.includes(lastAttempt.result);
    const disposalEligibility = {
      expired: locker?.status === 'expired',
      rounds: attempts.length,
      min_rounds: MIN_ROUNDS,
      channels: channels.size,
      min_channels: MIN_CHANNELS,
      last_result: lastAttempt?.result || null,
      last_reached: reached,
      has_active_case: !!(cases.find(c =>
        ['cs_lead_pending', 'storage_lead_pending', 'approved'].includes(c.status))),
      reasons: [] as string[],
    };
    if (!disposalEligibility.expired) disposalEligibility.reasons.push('柜位未处于「已到期」状态');
    if (attempts.length < MIN_ROUNDS) disposalEligibility.reasons.push(`多轮联系未满 ${MIN_ROUNDS} 轮（当前 ${attempts.length} 轮）`);
    if (channels.size < MIN_CHANNELS) disposalEligibility.reasons.push(`联系渠道未覆盖至少 ${MIN_CHANNELS} 种（当前 ${channels.size} 种）`);
    if (reached) disposalEligibility.reasons.push('最后一轮已联系上家属或家属已有承诺，不应进入处置');
    if (disposalEligibility.has_active_case) disposalEligibility.reasons.push('已存在进行中的处置申请');

    return {
      contact, attempts, locker, cases, directives, callbacks,
      renew_check: renewCheck, long_term_options: longTermOptions,
      disposal_eligibility: disposalEligibility,
      rules: { min_rounds: MIN_ROUNDS, min_channels: MIN_CHANNELS, grace_days: GRACE_DAYS },
    };
  }

  // ============ 联系人偏好 / 有效性 / 授权文件 ============

  /** 按主人偏好设置提醒方式：续费 / 取回 / 转长期寄存；可登记备用联系人 */
  async setPreferences(apptId: number, dto: any, user: U) {
    const a = await this.wf.getAccessible(apptId, user);
    const c = await this.ensureContact(apptId);
    if (dto.reminder_pref) c.reminder_pref = dto.reminder_pref;
    if (dto.channel_pref) c.channel_pref = dto.channel_pref;
    if (dto.alt_contact_name !== undefined) c.alt_contact_name = dto.alt_contact_name || null;
    if (dto.alt_contact_phone !== undefined) c.alt_contact_phone = dto.alt_contact_phone || null;
    if (dto.alt_contact_relation !== undefined) c.alt_contact_relation = dto.alt_contact_relation || null;
    c.updated_by = user.sub;
    await this.contactRepo.save(c);
    const prefLabel = { renew: '到期续费', retrieve: '到期取回', long_term: '转长期寄存' }[c.reminder_pref];
    const chLabel = { sms: '短信', phone: '电话', wechat: '微信', email: '邮件' }[c.channel_pref];
    await this.timeline(apptId, 'storage_pref', `家属提醒偏好：${prefLabel}（首选渠道：${chLabel}）`, {
      actor: user, note: c.alt_contact_name ? `备用联系人：${c.alt_contact_name} ${c.alt_contact_phone || ''}（${c.alt_contact_relation || ''}）` : '',
    });
    return c;
  }

  /** 联系人有效性核实结果 */
  async setValidity(apptId: number, dto: { validity: string; note?: string }, user: U) {
    await this.wf.getAccessible(apptId, user);
    const c = await this.ensureContact(apptId);
    c.validity = dto.validity as any;
    c.validity_note = dto.note || null;
    c.updated_by = user.sub;
    if (dto.validity === 'valid') c.last_reached_at = new Date();
    await this.contactRepo.save(c);
    const label = { valid: '有效', invalid: '空号/停机', changed: '号码已变更', unknown: '待核实' }[dto.validity] || dto.validity;
    await this.timeline(apptId, 'contact_validity', `联系人有效性核实：${label}`, {
      actor: user, flag: dto.validity === 'valid' ? 'resolved' : 'exception', note: dto.note,
    });
    return c;
  }

  /** 授权文件：upload 上传/登记 → verify 寄存主管或客服核实 → expired 标记失效 */
  async authorization(apptId: number, dto: any, user: U) {
    await this.wf.getAccessible(apptId, user);
    const c = await this.ensureContact(apptId);
    const action = dto.action || 'upload';
    if (action === 'upload') {
      c.auth_status = 'uploaded';
      c.auth_doc_no = dto.auth_doc_no || c.auth_doc_no;
      c.auth_media_urls = dto.auth_media_urls || c.auth_media_urls || [];
      c.auth_expire_at = dto.auth_expire_at ? new Date(dto.auth_expire_at) : c.auth_expire_at;
      c.auth_note = dto.note || c.auth_note;
      await this.timeline(apptId, 'auth_doc', '授权文件已登记，待员工核实', {
        actor: user, media: c.auth_media_urls || [], note: c.auth_doc_no ? `文件编号：${c.auth_doc_no}` : '',
      });
    } else if (action === 'verify') {
      if (!STAFF.includes(user.role)) throw new ForbiddenException('仅员工可核实授权文件');
      if (c.auth_status === 'none') throw new BadRequestException('尚未登记授权文件，无法核实');
      c.auth_status = 'verified';
      c.auth_verified_at = new Date();
      c.auth_note = dto.note || c.auth_note;
      await this.timeline(apptId, 'auth_doc', '授权文件经员工核实有效', {
        actor: user, flag: 'resolved', note: c.auth_doc_no ? `文件编号：${c.auth_doc_no}` : '',
      });
    } else if (action === 'expire') {
      if (!STAFF.includes(user.role)) throw new ForbiddenException('仅员工可标记授权失效');
      c.auth_status = 'expired';
      await this.timeline(apptId, 'auth_doc', '授权文件已失效/过期，需重新取得授权', {
        actor: user, flag: 'exception', note: dto.note,
      });
    } else {
      throw new BadRequestException('未知授权操作');
    }
    c.updated_by = user.sub;
    await this.contactRepo.save(c);
    return c;
  }

  // ============ 多轮联系 ============

  /** 登记一轮联系：渠道、结果、证明材料全部留痕；轮次自增 */
  async addAttempt(apptId: number, dto: any, user: U) {
    await this.wf.getAccessible(apptId, user);
    const last = await this.attemptRepo.findOne({ where: { appointment_id: apptId }, order: { id: 'DESC' } });
    const attempt = await this.attemptRepo.save(this.attemptRepo.create({
      appointment_id: apptId,
      round: (last?.round || 0) + 1,
      channel: dto.channel,
      result: dto.result,
      attempted_at: dto.attempted_at ? new Date(dto.attempted_at) : new Date(),
      note: dto.note || null,
      proof_urls: dto.proof_urls || [],
      cs_id: user.sub,
    }));
    // 空号/停机自动联动联系人有效性
    if (dto.result === 'invalid_number') {
      const c = await this.ensureContact(apptId);
      c.validity = 'invalid';
      c.validity_note = c.validity_note || '多轮联系中发现号码空号/停机';
      c.updated_by = user.sub;
      await this.contactRepo.save(c);
    }
    const chLabel: any = { sms: '短信', phone: '电话', wechat: '微信', email: '邮件', visit: '上门', letter: '书面信函' };
    const resLabel: any = {
      reached: '已联系上', no_answer: '无人应答', invalid_number: '空号/停机', refused: '明确拒绝',
      voicemail: '留言/语音信箱', promised_renew: '承诺续费', promised_retrieve: '承诺取回',
      promised_long_term: '承诺转长期',
    };
    await this.timeline(apptId, 'contact_attempt',
      `第 ${attempt.round} 轮联系（${chLabel[dto.channel]}）：${resLabel[dto.result]}`, {
        actor: user,
        flag: REACHED_RESULTS.includes(dto.result) ? 'resolved' : 'exception',
        note: dto.note, media: (dto.proof_urls || []).length ? dto.proof_urls : undefined,
      });
    return attempt;
  }

  // ============ 家属取回骨灰（释放柜位；保护态须先撤回处置） ============

  async retrieveUrn(apptId: number, dto: { note?: string }, user: U) {
    await this.wf.getAccessible(apptId, user);
    const locker = await this.currentLockerOf(this.ds, apptId);
    if (!locker) throw new BadRequestException('该工单没有在存柜位，骨灰可能已取回或已迁移');
    if (locker.status === 'protected') {
      throw new BadRequestException('柜位处于受保护/迁移预占状态，须先撤回待执行的处置/迁移指令，家属才能取回');
    }
    const pendingDir = await this.dirRepo.findOne({
      where: { appointment_id: apptId, status: 'pending' as any } });
    if (pendingDir) {
      throw new BadRequestException('存在待家属确认或待执行的迁移指令，请先撤回后再办理取回');
    }
    return this.ds.transaction(async m => {
      await m.getRepository(Locker).update(locker.id, {
        status: 'free', appointment_id: null, occupied_since: null, expire_at: null,
        annual_fee_at_assign: null, protected_reason: null,
      });
      await m.getRepository(Followup).update(
        { appointment_id: apptId, status: 'scheduled' as any,
          trigger: In(['locker_expiring', 'locker_expired', 'locker_protected']) },
        { status: 'skipped' });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: apptId, node_key: 'storage_retrieved', flag: 'resolved',
        title: `家属已取回骨灰，原柜位 ${locker.code} 释放`,
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
        note: dto.note || '家属到店取回，交接完成',
      }));
    });
  }

  // ============ 续费（校验可续用 / 年费变更 / 未结费用） ============

  async renewLocker(lockerId: number, dto: { months: number; price_confirmed?: boolean }, user: U) {
    const locker = await this.lockerRepo.findOne({ where: { id: lockerId } });
    if (!locker) throw new NotFoundException('柜位不存在');
    if (!locker.appointment_id) throw new BadRequestException('柜位当前未占用');
    const a = await this.wf.getAccessible(locker.appointment_id, user);
    if (locker.status === 'free') throw new BadRequestException('柜位当前空闲，无需续费');
    if (locker.status === 'protected') {
      throw new BadRequestException('柜位处于受保护待处置/迁移预占状态，不能直接续费；若主人已恢复联系，请先撤回待执行的处置/迁移指令');
    }
    const months = Math.min(60, Math.max(1, Number(dto.months) || 12));
    await this.ds.transaction(async m => {
      const balance = await this.balanceOf(m, locker.appointment_id!);
      if (balance > 0.01) {
        throw new BadRequestException(`存在未结服务费用 ${balance} 元，请财务结清后再办理续费`);
      }
      const currentFee = Number(locker.annual_fee);
      const assignedFee = locker.annual_fee_at_assign != null ? Number(locker.annual_fee_at_assign) : currentFee;
      if (assignedFee !== currentFee && !dto.price_confirmed) {
        throw new BadRequestException(
          `年费价格已变更：入柜/上次续费时为 ${assignedFee} 元/年，现行价格 ${currentFee} 元/年`
          + `（年差额 ${currentFee - assignedFee} 元）。请向家属明示并勾选「已知悉年费变更」后再续费`);
      }
      const base = locker.expire_at && +locker.expire_at > Date.now() ? locker.expire_at : new Date();
      const newExpire = new Date(+base + months * 30 * 86400000);
      const fee = Math.round((currentFee / 12) * months * 100) / 100;
      await m.getRepository(Locker).update(lockerId, {
        status: 'occupied', expire_at: newExpire, annual_fee_at_assign: String(currentFee.toFixed(2)),
        protected_reason: null,
      });
      await m.getRepository(FeeItem).insert(m.getRepository(FeeItem).create({
        appointment_id: locker.appointment_id, kind: 'storage',
        title: `柜位 ${locker.code} 续费 ${months} 个月（至 ${newExpire.toLocaleDateString('zh-CN')}）`,
        amount: String(fee), reason: assignedFee !== currentFee
          ? `续费：年费已由 ${assignedFee} 元调整为 ${currentFee} 元，家属已知悉确认` : '寄存续费',
        operator_id: user.sub, entry_type: 'change', confirm_status: 'confirmed',
      }));
      await m.getRepository(Appointment).update(locker.appointment_id,
        { final_amount: (Number(a.final_amount || a.quote_amount || 0) + fee).toFixed(2) });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: locker.appointment_id, node_key: 'storage_renewed', flag: 'resolved',
        title: `柜位 ${locker.code} 续费 ${months} 个月，新到期 ${newExpire.toLocaleString('zh-CN')}`,
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
        note: `系统校验通过：柜位可续用；年费 ${currentFee} 元${assignedFee !== currentFee ? `（已确认由 ${assignedFee} 变更）` : ''}；无未结服务费用`,
      }));
      await m.getRepository(Followup).update(
        { appointment_id: locker.appointment_id, status: 'scheduled' as any,
          trigger: In(['locker_expiring', 'locker_expired', 'locker_protected']) },
        { status: 'skipped' });
    });
    return this.lockerRepo.findOne({ where: { id: lockerId } });
  }

  /** 寄存主管/管理者调整柜位现行年费（价目调整；下一轮续费时系统校验并提示价格变更） */
  async setLockerPrice(lockerId: number, dto: { annual_fee: number }, user: U) {
    const locker = await this.lockerRepo.findOne({ where: { id: lockerId } });
    if (!locker) throw new NotFoundException('柜位不存在');
    if (locker.store_id !== user.store_id && user.role !== 'manager') {
      throw new ForbiddenException('跨门店数据不可访问');
    }
    const old = Number(locker.annual_fee);
    await this.lockerRepo.update(lockerId, { annual_fee: String(Number(dto.annual_fee).toFixed(2)) });
    if (locker.appointment_id) {
      await this.timeline(locker.appointment_id, 'storage_price_changed',
        `柜位 ${locker.code} 年费调整：${old} 元 → ${dto.annual_fee} 元（下次续费时系统将提示家属确认）`,
        { actor: user, flag: 'exception' });
    }
    return this.lockerRepo.findOne({ where: { id: lockerId } });
  }

  /** 定时扫描：按家属偏好生成续费/取回/转长期提醒；过期生成跟进；超宽限提示启动联系处置 */
  async scanLockers(user?: U) {
    const lockers = await this.lockerRepo.find({
      where: { status: In(['occupied', 'expiring', 'expired']) } });
    let scanned = 0, expiring = 0, expired = 0, graceDue = 0;
    for (const l of lockers) {
      if (!l.expire_at || !l.appointment_id) continue;
      if (user && user.role !== 'manager' && !['cs_lead', 'storage_lead'].includes(user.role)
        && l.store_id !== user.store_id) continue;
      scanned++;
      const days = (+l.expire_at - Date.now()) / 86400000;
      const contact = await this.contactRepo.findOne({ where: { appointment_id: l.appointment_id } });
      const prefText = contact ? {
        renew: '续费', retrieve: '到期取回骨灰', long_term: '转长期寄存',
      }[contact.reminder_pref] : '续费';
      const channelText = contact ? `（按偏好渠道：${{
        sms: '短信', phone: '电话', wechat: '微信', email: '邮件',
      }[contact.channel_pref]}）` : '';
      if (days <= 0) {
        if (l.status !== 'expired') {
          await this.lockerRepo.update(l.id, { status: 'expired' });
          const exists = await this.followRepo.findOne({
            where: { appointment_id: l.appointment_id, trigger: 'locker_expired', status: 'scheduled' } });
          if (!exists) await this.followRepo.save(this.followRepo.create({
            appointment_id: l.appointment_id, trigger: 'locker_expired', planned_at: new Date(),
            content: `柜位 ${l.code} 已到期未续费${channelText}，按家属偏好联系确认${prefText}；多轮联系无果将进入受保护待处置`,
          }));
          expired++;
        }
        if (days <= -GRACE_DAYS) graceDue++;
      } else if (days <= 30) {
        if (l.status !== 'expiring') {
          await this.lockerRepo.update(l.id, { status: 'expiring' });
          const exists = await this.followRepo.findOne({
            where: { appointment_id: l.appointment_id, trigger: 'locker_expiring', status: 'scheduled' } });
          if (!exists) await this.followRepo.save(this.followRepo.create({
            appointment_id: l.appointment_id, trigger: 'locker_expiring', planned_at: new Date(),
            content: `柜位 ${l.code} 将于 ${l.expire_at.toLocaleDateString('zh-CN')} 到期，提醒家属${prefText}${channelText}`
              + (contact?.alt_contact_name ? `；备用联系人 ${contact.alt_contact_name} ${contact.alt_contact_phone || ''}` : ''),
          }));
          expiring++;
        }
      }
    }
    return { scanned, expiring, expired, grace_due: graceDue,
      note: `超过 ${GRACE_DAYS} 天宽限期仍过期的柜位 ${graceDue} 个，应尽快完成多轮联系` };
  }

  // ============ 转长期寄存（家属选择；客服比较柜位/迁移时间并取得家属确认） ============

  /** 提交转长期寄存方案：比较可用柜位后锁定目标（protected 预占），生成待确认迁移指令 */
  async requestLongTerm(apptId: number, dto: { target_locker_id: number; planned_migrate_at: string }, user: U) {
    const a = await this.wf.getAccessible(apptId, user);
    if (!dto.target_locker_id) throw new BadRequestException('请选择目标长期柜位');
    return this.ds.transaction(async m => {
      const source = await this.currentLockerOf(m, apptId);
      if (!source) throw new BadRequestException('该工单没有在存柜位');
      if (source.status === 'protected') {
        throw new BadRequestException('当前柜位处于受保护/迁移预占状态，已有在途处置流程');
      }
      const active = await this.activeCase(m, apptId);
      if (active) throw new BadRequestException('已存在进行中的处置申请');
      // 先校验目标柜位仍空闲——避免承诺已被占用的位置（含本单已预占的目标）
      const target = await m.getRepository(Locker).findOne({ where: { id: Number(dto.target_locker_id) } });
      if (!target || target.store_id !== a.store_id) throw new NotFoundException('目标柜位不存在或跨门店');
      if (target.id === source.id) throw new BadRequestException('目标柜位与当前柜位相同');
      if (target.status !== 'free') {
        throw new BadRequestException(`目标柜位 ${target.code} 当前「${{
          occupied: '占用中', expiring: '临期占用', expired: '到期占用', protected: '受保护预占',
        }[target.status] || target.status}」，不能承诺该位置，请比较可用柜位后另选`);
      }
      const pendingDir = await m.getRepository(StorageDirective).findOne({
        where: { appointment_id: apptId, status: 'pending' as any },
      });
      if (pendingDir) {
        throw new BadRequestException('已存在待家属确认或待执行的迁移/处置指令，请先处理或撤回后再拟定新方案');
      }
      const plannedAt = new Date(dto.planned_migrate_at || Date.now() + 3 * 86400000);
      // 预占目标柜位
      const occupied = await m.getRepository(Locker).createQueryBuilder()
        .update(Locker).set({
          status: 'protected', appointment_id: apptId, protected_reason: `转长期寄存预占：工单 #${apptId}`,
        })
        .where('id = :id AND status = :free', { id: target.id, free: 'free' }).execute();
      if (!occupied.affected) throw new BadRequestException(`目标柜位 ${target.code} 刚被占用，请刷新后另选`);

      // 出账（1 年年费），撤回时冲销
      const fee = Number(target.annual_fee);
      const feeRes = await m.getRepository(FeeItem).insert(m.getRepository(FeeItem).create({
        appointment_id: apptId, kind: 'storage_migrate',
        title: `转长期寄存：${source.code} → ${target.code}（1 年年费）`,
        amount: String(fee.toFixed(2)),
        reason: `客服比较可用柜位后拟定，计划迁移时间 ${plannedAt.toLocaleString('zh-CN')}；家属确认后执行`,
        operator_id: user.sub, entry_type: 'change', confirm_status: 'confirmed',
      }));
      const feeId = feeRes.identifiers[0].id;
      await m.getRepository(Appointment).update(apptId,
        { final_amount: (Number(a.final_amount || a.quote_amount || 0) + fee).toFixed(2) });

      const dirRes = await m.getRepository(StorageDirective).insert(m.getRepository(StorageDirective).create({
        case_id: 0, appointment_id: apptId, action: 'migrate', source: 'family_confirmed',
        fee_item_id: feeId,
        from_locker_id: source.id, from_locker_code: source.code,
        target_locker_id: target.id, target_locker_code: target.code,
        planned_execute_at: plannedAt, status: 'pending',
      }));
      const dirId = dirRes.identifiers[0].id;
      await m.getRepository(Confirmation).insert(m.getRepository(Confirmation).create({
        appointment_id: apptId, subject: 'long_term_migration',
        content: `客服已为您比较可用长期柜位，拟定迁移至 ${target.code}（尊享等级，年费 ${fee} 元），`
          + `计划迁移时间 ${plannedAt.toLocaleString('zh-CN')}。请确认是否按此方案迁移。 [DIR]${dirId}[/DIR]`,
        status: 'pending', requested_by: user.sub,
      }));
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: apptId, node_key: 'long_term_request', flag: 'exception',
        title: `转长期寄存方案待家属确认：${source.code} → ${target.code}`,
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
        note: `目标柜位已临时保护（不释放/不再分配）；计划迁移 ${plannedAt.toLocaleString('zh-CN')}；年费 ${fee} 元已出账，撤回将冲销`,
        promised_at: plannedAt,
      }));
      return m.getRepository(StorageDirective).findOne({ where: { id: dirId } });
    });
  }

  /** 家属对转长期方案确认 / 拒绝（客服也可代为确认，须备注说明） */
  async familyRespond(directiveId: number, dto: { approve: boolean; note?: string }, user: U) {
    const d = await this.dirRepo.findOne({ where: { id: directiveId } });
    if (!d) throw new NotFoundException('处置/迁移指令不存在');
    await this.wf.getAccessible(d.appointment_id, user);
    if (d.source !== 'family_confirmed') throw new BadRequestException('该指令为审批处置指令，不适用家属确认');
    if (d.status !== 'pending') throw new BadRequestException('指令已处理，不能重复确认');
    const conf = await this.ds.getRepository(Confirmation).findOne({
      where: { appointment_id: d.appointment_id, subject: 'long_term_migration', status: 'pending' },
      order: { id: 'DESC' },
    });
    if (!conf) throw new BadRequestException('未找到待家属确认的迁移确认事项');
    if (dto.approve) {
      await this.ds.transaction(async m => {
        await m.getRepository(Confirmation).update(conf.id,
          { status: 'confirmed', confirmed_at: new Date(), reply_note: dto.note || '家属确认' });
        await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
          appointment_id: d.appointment_id, node_key: 'long_term_confirmed', flag: 'resolved',
          title: `家属确认转长期寄存方案（${d.from_locker_code} → ${d.target_locker_code}），可按计划迁移`,
          actor_id: user.sub, actor_role: user.role, occurred_at: new Date(), note: dto.note,
        }));
      });
    } else {
      await this.ds.transaction(async tx =>
        this.withdrawInternal(tx, d, user,
          dto.note ? `家属拒绝迁移方案：${dto.note}` : '家属拒绝转长期寄存方案'));
    }
    return this.dirRepo.findOne({ where: { id: directiveId } });
  }

  // ============ 逾期处置：多轮联系 → 受保护 → 双审批 → 指令 ============

  /** 客服发起处置申请；柜位随即进入受保护待处置状态（不能释放或再次分配） */
  async createDisposalCase(apptId: number, dto: any, user: U) {
    const a = await this.wf.getAccessible(apptId, user);
    const locker = await this.currentLockerOf(this.ds, apptId);
    if (!locker) throw new BadRequestException('该工单没有在存柜位');
    if (locker.status !== 'expired') {
      throw new BadRequestException('仅「已到期」柜位可发起逾期处置；当前状态：'
        + ({ occupied: '占用中', expiring: '临期', protected: '受保护待处置' } as any)[locker.status] || locker.status);
    }
    const attempts = await this.attemptRepo.find({ where: { appointment_id: apptId }, order: { id: 'ASC' } });
    const channels = new Set(attempts.map(x => x.channel));
    const problems: string[] = [];
    if (attempts.length < MIN_ROUNDS) problems.push(`按规定须完成至少 ${MIN_ROUNDS} 轮联系（当前 ${attempts.length} 轮）`);
    if (channels.size < MIN_CHANNELS) problems.push(`联系须覆盖至少 ${MIN_CHANNELS} 种渠道（当前 ${channels.size} 种）`);
    const last = attempts[attempts.length - 1];
    if (last && REACHED_RESULTS.includes(last.result)) {
      problems.push('最后一轮已联系上家属或家属已作出承诺，不应进入处置');
    }
    if (problems.length) throw new BadRequestException(`暂不能发起处置：${problems.join('；')}`);
    const exist = await this.activeCase(this.ds, apptId);
    if (exist) throw new BadRequestException('已存在进行中的处置申请');
    const pendingDir = await this.dirRepo.findOne({
      where: { appointment_id: apptId, status: 'pending' as any },
    });
    if (pendingDir) {
      throw new BadRequestException('已存在待家属确认或待执行的迁移指令，请先完成或撤回');
    }

    let target: Locker | null = null;
    if (dto.proposed_action === 'migrate') {
      if (!dto.target_locker_id) throw new BadRequestException('迁移处置必须选择目标柜位');
      target = await this.lockerRepo.findOne({ where: { id: Number(dto.target_locker_id) } });
      if (!target || target.store_id !== a.store_id) throw new NotFoundException('目标柜位不存在或跨门店');
      if (target.status !== 'free') {
        throw new BadRequestException(`拟定迁移目标 ${target.code} 已被占用或预占，请比较可用柜位后另选（复核放行前目标将被保护）`);
      }
    }
    const actionLabel = { migrate: '迁移至长期存放区', continue_keep: '继续保管', other: '其他合规处置' }[dto.proposed_action];
    return this.ds.transaction(async m => {
      const caseRow = await m.getRepository(StorageDisposalCase).save(m.getRepository(StorageDisposalCase).create({
        appointment_id: apptId, locker_id: locker.id,
        proposed_action: dto.proposed_action,
        target_locker_id: target?.id || null,
        planned_migrate_at: dto.planned_migrate_at ? new Date(dto.planned_migrate_at) : null,
        reason: dto.reason, requested_by: user.sub,
        status: 'cs_lead_pending',
      }));
      // 进入受保护待处置：原柜位不得释放、不得再次分配
      await m.getRepository(Locker).update(locker.id,
        { status: 'protected', protected_reason: `逾期处置申请 #${caseRow.id}（${actionLabel}）待审批` });
      const followExists = await m.getRepository(Followup).findOne({
        where: { appointment_id: apptId, trigger: 'locker_protected', status: 'scheduled' } });
      if (!followExists) await m.getRepository(Followup).insert(m.getRepository(Followup).create({
        appointment_id: apptId, trigger: 'locker_protected', planned_at: new Date(),
        content: `柜位 ${locker.code} 已进入受保护待处置状态（申请 #${caseRow.id}），等待客服主管审批与寄存主管复核`,
      }));
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: apptId, node_key: 'storage_protected', flag: 'exception',
        title: `多轮联系无果，柜位 ${locker.code} 进入受保护待处置，申请「${actionLabel}」`,
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
        note: `多轮联系 ${attempts.length} 轮 / ${channels.size} 种渠道；申请编号 #${caseRow.id}；柜位不会被释放或再分配，直至双级审批完成或主人恢复联系`,
      }));
      return caseRow;
    });
  }

  /** 客服主管审批下一步处理 */
  async csLeadReview(caseId: number, dto: { approve: boolean; note?: string }, user: U) {
    const c = await this.caseRepo.findOne({ where: { id: caseId } });
    if (!c) throw new NotFoundException('处置申请不存在');
    await this.wf.getAccessible(c.appointment_id, user);
    if (c.status !== 'cs_lead_pending') throw new BadRequestException('该申请不在待客服主管审批状态');
    await this.ds.transaction(async m => {
      if (dto.approve) {
        await m.getRepository(StorageDisposalCase).update(caseId, {
          cs_lead_status: 'approved', cs_lead_id: user.sub, cs_lead_at: new Date(),
          cs_lead_note: dto.note, status: 'storage_lead_pending',
        });
        await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
          appointment_id: c.appointment_id, node_key: 'disposal_cs_lead', flag: 'normal',
          title: '客服主管批准下一步处理，转寄存主管复核授权与证据',
          actor_id: user.sub, actor_role: user.role, occurred_at: new Date(), note: dto.note,
        }));
      } else {
        await m.getRepository(StorageDisposalCase).update(caseId, {
          cs_lead_status: 'rejected', cs_lead_id: user.sub, cs_lead_at: new Date(),
          cs_lead_note: dto.note, status: 'rejected',
        });
        // 驳回：解除保护，柜位回到过期状态继续跟进
        await m.getRepository(Locker).update(c.locker_id,
          { status: 'expired', protected_reason: null });
        await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
          appointment_id: c.appointment_id, node_key: 'disposal_cs_lead', flag: 'resolved',
          title: '客服主管驳回处置申请，柜位解除保护回到过期跟进',
          actor_id: user.sub, actor_role: user.role, occurred_at: new Date(), note: dto.note,
        }));
      }
    });
    return this.caseRepo.findOne({ where: { id: caseId } });
  }

  /** 寄存主管复核授权与证据；通过后生成处置指令（迁移同步预占目标柜位） */
  async storageLeadReview(caseId: number, dto: { approve: boolean; note?: string }, user: U) {
    const c = await this.caseRepo.findOne({ where: { id: caseId } });
    if (!c) throw new NotFoundException('处置申请不存在');
    await this.wf.getAccessible(c.appointment_id, user);
    if (c.status !== 'storage_lead_pending') throw new BadRequestException('该申请不在待寄存主管复核状态');

    if (dto.approve) {
      // 复核证据与授权
      const [attempts, contact, sourceLocker] = await Promise.all([
        this.attemptRepo.find({ where: { appointment_id: c.appointment_id }, order: { id: 'ASC' } }),
        this.contactRepo.findOne({ where: { appointment_id: c.appointment_id } }),
        this.lockerRepo.findOne({ where: { id: c.locker_id } }),
      ]);
      const channels = new Set(attempts.map(x => x.channel));
      if (attempts.length < MIN_ROUNDS || channels.size < MIN_CHANNELS) {
        throw new BadRequestException(`复核不通过：多轮联系证据不足（${attempts.length} 轮 / ${channels.size} 种渠道，需 ≥${MIN_ROUNDS} 轮且 ≥${MIN_CHANNELS} 种渠道）`);
      }
      let target: Locker | null = null;
      if (c.proposed_action === 'migrate') {
        if (!contact || contact.auth_status !== 'verified') {
          throw new BadRequestException('复核不通过：迁移处置须先核实家属授权文件（当前：'
            + (!contact ? '未登记联系人档案' : ({ none: '未提供授权', uploaded: '授权待核实', expired: '授权已失效' } as any)[contact.auth_status]) + '）');
        }
        target = await this.lockerRepo.findOne({ where: { id: c.target_locker_id! } });
        if (!target) throw new BadRequestException('复核不通过：目标柜位不存在');
        if (target.status !== 'free') {
          throw new BadRequestException(`复核不通过：目标柜位 ${target.code} 已被占用，不能据此生成迁移指令`);
        }
      }
      return this.ds.transaction(async m => {
        if (c.proposed_action === 'migrate' && target) {
          const occupied = await m.getRepository(Locker).createQueryBuilder()
            .update(Locker).set({
              status: 'protected', appointment_id: c.appointment_id,
              protected_reason: `处置迁移预占：申请 #${c.id}`,
            })
            .where('id = :id AND status = :free', { id: target!.id, free: 'free' }).execute();
          if (!occupied.affected) throw new BadRequestException(`目标柜位 ${target!.code} 刚被占用，请驳回后重新比选`);
        }
        await m.getRepository(StorageDisposalCase).update(caseId, {
          storage_lead_status: 'approved', storage_lead_id: user.sub,
          storage_lead_at: new Date(), storage_lead_note: dto.note, status: 'approved',
        });
        // 生成处置指令并出账（迁移收目标柜位 1 年年费；继续保管/其他为 0 元留痕）
        const feeSpec = c.proposed_action === 'migrate'
          ? { amount: Number(target!.annual_fee), kind: 'storage_migrate',
              title: `逾期处置迁移：${sourceLocker?.code} → ${target!.code}（1 年年费）` }
          : c.proposed_action === 'continue_keep'
            ? { amount: 0, kind: 'storage_keep', title: '逾期处置：继续保管 6 个月' }
            : { amount: 0, kind: 'storage_other', title: `逾期处置：其他合规处理（${c.reason.slice(0, 40)}）` };
        const a = await m.getRepository(Appointment).findOne({ where: { id: c.appointment_id } });
        const feeRes = await m.getRepository(FeeItem).insert(m.getRepository(FeeItem).create({
          appointment_id: c.appointment_id, kind: feeSpec.kind, title: feeSpec.title,
          amount: feeSpec.amount.toFixed(2),
          reason: `处置申请 #${c.id} 已经客服主管审批、寄存主管复核授权与证据；指令执行前可撤回并冲销`,
          operator_id: user.sub, entry_type: 'change', confirm_status: 'confirmed',
        }));
        if (feeSpec.amount > 0 && a) {
          await m.getRepository(Appointment).update(a.id,
            { final_amount: (Number(a.final_amount || a.quote_amount || 0) + feeSpec.amount).toFixed(2) });
        }
        const dirRes = await m.getRepository(StorageDirective).insert(m.getRepository(StorageDirective).create({
          case_id: c.id, appointment_id: c.appointment_id, action: c.proposed_action,
          source: 'lead_approved', fee_item_id: feeRes.identifiers[0].id,
          from_locker_id: c.locker_id, from_locker_code: sourceLocker?.code || `#${c.locker_id}`,
          target_locker_id: target?.id || null, target_locker_code: target?.code || null,
          planned_execute_at: c.planned_migrate_at, status: 'pending',
        }));
        await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
          appointment_id: c.appointment_id, node_key: 'disposal_storage_lead', flag: 'resolved',
          title: `寄存主管复核通过（授权${c.proposed_action === 'migrate' ? '已核实、' : ''}多轮联系证据齐备），处置指令 #${dirRes.identifiers[0].id} 已生成待执行`,
          actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
          note: dto.note || (c.proposed_action === 'migrate'
            ? `目标柜位 ${target!.code} 已保护预占；执行前主人恢复联系可撤回` : undefined),
        }));
        return { case: await m.getRepository(StorageDisposalCase).findOne({ where: { id: caseId } }),
          directive_id: dirRes.identifiers[0].id };
      });
    }

    await this.ds.transaction(async m => {
      await m.getRepository(StorageDisposalCase).update(caseId, {
        storage_lead_status: 'rejected', storage_lead_id: user.sub,
        storage_lead_at: new Date(), storage_lead_note: dto.note, status: 'rejected',
      });
      await m.getRepository(Locker).update(c.locker_id, { status: 'expired', protected_reason: null });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: c.appointment_id, node_key: 'disposal_storage_lead', flag: 'resolved',
        title: '寄存主管复核驳回处置申请，柜位解除保护回到过期跟进',
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(), note: dto.note,
      }));
    });
    return this.caseRepo.findOne({ where: { id: caseId } });
  }

  // ============ 指令执行 / 撤回 / 家属回访 ============

  /** 执行处置指令：保留原柜位快照、交接人员、时间与材料；完成后安排家属后续回访 */
  async executeDirective(directiveId: number, dto: any, user: U) {
    const d = await this.dirRepo.findOne({ where: { id: directiveId } });
    if (!d) throw new NotFoundException('指令不存在');
    await this.wf.getAccessible(d.appointment_id, user);
    if (d.status !== 'pending') throw new BadRequestException('指令不是待执行状态（可能已执行或已撤回）');
    if (d.source === 'family_confirmed') {
      const ok = await this.ds.getRepository(Confirmation).findOne({
        where: { appointment_id: d.appointment_id, subject: 'long_term_migration', status: 'confirmed' },
        order: { id: 'DESC' },
      });
      if (!ok) throw new BadRequestException('家属尚未确认转长期寄存方案，不能执行迁移');
    }
    const a = await this.apptRepo.findOne({ where: { id: d.appointment_id } });
    return this.ds.transaction(async m => {
      const from = await m.getRepository(Locker).findOne({ where: { id: d.from_locker_id } });
      if (d.action === 'migrate') {
        const target = await m.getRepository(Locker).findOne({ where: { id: d.target_locker_id! } });
        if (!target) throw new BadRequestException('目标柜位不存在');
        if (target.status !== 'protected' || target.appointment_id !== d.appointment_id) {
          throw new BadRequestException(`目标柜位 ${target.code} 保护预占已失效（被其他流程占用），禁止执行迁移`);
        }
        if (!from) throw new BadRequestException('原柜位记录缺失');
        // 原柜位释放（快照永久保留在指令 from_* 字段）
        await m.getRepository(Locker).update(from.id, {
          status: 'free', appointment_id: null, occupied_since: null, expire_at: null,
          annual_fee_at_assign: null, protected_reason: null,
        });
        const expireAt = new Date(Date.now() + 12 * 30 * 86400000);
        await m.getRepository(Locker).update(target.id, {
          status: 'occupied', appointment_id: d.appointment_id, occupied_since: new Date(),
          expire_at: expireAt, annual_fee_at_assign: target.annual_fee, protected_reason: null,
        });
      } else if (d.action === 'continue_keep') {
        if (!from) throw new BadRequestException('原柜位记录缺失');
        await m.getRepository(Locker).update(from.id, {
          status: 'occupied', protected_reason: null,
          expire_at: new Date(Date.now() + 6 * 30 * 86400000),
        });
      } else {
        if (!from) throw new BadRequestException('原柜位记录缺失');
        await m.getRepository(Locker).update(from.id, {
          status: 'occupied', protected_reason: null,
          expire_at: new Date(Date.now() + 3 * 30 * 86400000),
        });
      }
      await m.getRepository(StorageDirective).update(d.id, {
        status: 'done', executed_at: new Date(), handler_id: user.sub,
        handler_name: dto.handler_name || user.name,
        handover_media_urls: dto.media || [], execute_note: dto.note || null,
      });
      if (d.case_id > 0) {
        await m.getRepository(StorageDisposalCase).update(d.case_id, { status: 'done' });
      }
      await m.getRepository(Followup).update(
        { appointment_id: d.appointment_id, status: 'scheduled' as any,
          trigger: In(['locker_expiring', 'locker_expired', 'locker_protected']) },
        { status: 'skipped' });
      const actionLabel = { migrate: '迁移至长期存放区', continue_keep: '继续保管', other: '其他合规处置' }[d.action];
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: d.appointment_id, node_key: 'storage_disposed', flag: 'resolved',
        title: `处置指令 #${d.id} 已执行：${actionLabel}`
          + (d.action === 'migrate' ? `（原柜位 ${d.from_locker_code} → ${d.target_locker_code}）` : `（原柜位 ${d.from_locker_code}）`),
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
        note: `交接人员：${dto.handler_name || user.name}；原柜位快照 ${d.from_locker_code} 已留存；${dto.note || ''}`,
        media_urls: dto.media || [],
      }));
      // 家属后续回访（7 日后）
      await m.getRepository(Followup).insert(m.getRepository(Followup).create({
        appointment_id: d.appointment_id, trigger: 'post_disposal',
        planned_at: new Date(Date.now() + 7 * 86400000),
        content: `处置完成后第 7 日家属回访（指令 #${d.id}，${actionLabel}），确认家属知情、情绪与后续诉求`,
      }));
    });
    return this.dirRepo.findOne({ where: { id: directiveId } });
  }

  /** 处置执行前主人恢复联系：撤回未完成指令，冲销账单，释放预占目标，恢复原柜位与申请状态 */
  async withdrawDirective(directiveId: number, dto: { reason?: string }, user: U) {
    const d = await this.dirRepo.findOne({ where: { id: directiveId } });
    if (!d) throw new NotFoundException('指令不存在');
    await this.wf.getAccessible(d.appointment_id, user);
    if (d.status !== 'pending') {
      throw new BadRequestException('指令已执行，不能撤回；如需善后请登记家属回访或联系主管');
    }
    await this.withdrawInternal(this.ds, d, user, dto.reason || '主人在处置执行前恢复联系');
    return this.dirRepo.findOne({ where: { id: directiveId } });
  }

  private async withdrawInternal(m: DataSource | any, d: StorageDirective, user: U, reason: string) {
    // 冲销该指令产生的账单行，恢复账单
    if (d.fee_item_id) {
      const fee = await m.getRepository(FeeItem).findOne({ where: { id: d.fee_item_id } });
      if (fee && !fee.voided) {
        await m.getRepository(FeeItem).update(fee.id,
          { voided: true, voided_at: new Date(), voided_reason: reason });
        const a = await m.getRepository(Appointment).findOne({ where: { id: d.appointment_id } });
        if (a && Number(fee.amount) !== 0) {
          await m.getRepository(Appointment).update(a.id,
            { final_amount: Math.max(0, Number(a.final_amount || a.quote_amount || 0) - Number(fee.amount)).toFixed(2) });
        }
      }
    }
    // 释放迁移预占目标
    if (d.target_locker_id) {
      const target = await m.getRepository(Locker).findOne({ where: { id: d.target_locker_id } });
      if (target && target.status === 'protected' && target.appointment_id === d.appointment_id) {
        await m.getRepository(Locker).update(target.id, {
          status: 'free', appointment_id: null, protected_reason: null,
        });
      }
    }
    // 审批处置：申请撤回，原柜位由受保护恢复为过期
    if (d.source === 'lead_approved' && d.case_id > 0) {
      await m.getRepository(StorageDisposalCase).update(d.case_id, { status: 'withdrawn' });
      const from = await m.getRepository(Locker).findOne({ where: { id: d.from_locker_id } });
      if (from && from.status === 'protected' && from.appointment_id === d.appointment_id) {
        await m.getRepository(Locker).update(from.id, { status: 'expired', protected_reason: null });
      }
    }
    await m.getRepository(StorageDirective).update(d.id, {
      status: 'withdrawn', withdrawn_at: new Date(), withdrawn_by: user.sub, withdraw_reason: reason,
    });
    // 关闭家属待确认事项
    await m.getRepository(Confirmation).update(
      { appointment_id: d.appointment_id, subject: 'long_term_migration' as any, status: 'pending' as any },
      { status: 'rejected', confirmed_at: new Date(), reply_note: reason });
    await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
      appointment_id: d.appointment_id, node_key: 'storage_withdrawn', flag: 'resolved',
      title: `处置/迁移指令 #${d.id} 已撤回，账单已恢复、柜位状态已还原`,
      actor_id: user.sub, actor_role: user.role, occurred_at: new Date(), note: reason,
    }));
    // 撤回后重新建立到期跟进
    const followExists = await m.getRepository(Followup).findOne({
      where: { appointment_id: d.appointment_id, trigger: 'locker_expired', status: 'scheduled' } });
    if (!followExists) {
      await m.getRepository(Followup).insert(m.getRepository(Followup).create({
        appointment_id: d.appointment_id, trigger: 'locker_expired', planned_at: new Date(),
        content: '处置指令已撤回，请与恢复联系的家属重新确认续费/取回/转长期方案',
      }));
    }
  }

  /** 家属后续回访结果登记（任何处置执行后） */
  async addCallback(directiveId: number, dto: any, user: U) {
    const d = await this.dirRepo.findOne({ where: { id: directiveId } });
    if (!d) throw new NotFoundException('指令不存在');
    await this.wf.getAccessible(d.appointment_id, user);
    const cb = await this.callbackRepo.save(this.callbackRepo.create({
      appointment_id: d.appointment_id, directive_id: d.id,
      callback_at: dto.callback_at ? new Date(dto.callback_at) : new Date(),
      result: dto.result, note: dto.note, media_urls: dto.media || [], cs_id: user.sub,
    }));
    const label = { satisfied: '满意', understanding: '理解接受', concerned: '仍有顾虑', unreachable: '仍无法联系' }[dto.result];
    await this.timeline(d.appointment_id, 'family_callback',
      `处置后家属回访：${label}（指令 #${d.id}）`, {
        actor: user, flag: dto.result === 'unreachable' ? 'exception' : 'resolved', note: dto.note,
      });
    return cb;
  }

  // ============ 列表与总览 ============

  private async storeApptIds(user: U): Promise<number[] | null> {
    if (['manager', 'cs_lead', 'storage_lead'].includes(user.role)) return null;
    const appts = await this.apptRepo.find({
      where: { store_id: user.store_id }, select: { id: true } });
    return appts.map(a => a.id);
  }

  async listCases(user: U, status?: string) {
    const ids = await this.storeApptIds(user);
    const qb = this.caseRepo.createQueryBuilder('c').orderBy('c.id', 'DESC').limit(200);
    if (ids) qb.where('c.appointment_id IN (:...ids)', { ids: ids.length ? ids : [0] });
    if (status) qb.andWhere('c.status = :st', { st: status });
    const cases = await qb.getMany();
    return this.decorate(cases.map(c => ({ ...c })));
  }

  async listDirectives(user: U, status?: string) {
    const ids = await this.storeApptIds(user);
    const qb = this.dirRepo.createQueryBuilder('d').orderBy('d.id', 'DESC').limit(200);
    if (ids) qb.where('d.appointment_id IN (:...ids)', { ids: ids.length ? ids : [0] });
    if (status) qb.andWhere('d.status = :st', { st: status });
    const dirs = await qb.getMany();
    return this.decorate(dirs.map(d => ({ ...d })));
  }

  private async decorate(rows: any[]) {
    if (!rows.length) return rows;
    const apptIds = [...new Set(rows.map(r => r.appointment_id))];
    const appts = await this.apptRepo.findByIds(apptIds);
    const amap = new Map(appts.map(a => [a.id, a]));
    const lockerIds = [...new Set(rows.flatMap(r =>
      [r.locker_id, r.from_locker_id, r.target_locker_id].filter(Boolean)))];
    const lockers = lockerIds.length ? await this.lockerRepo.findByIds(lockerIds) : [];
    const lmap = new Map(lockers.map(l => [l.id, l]));
    for (const r of rows) {
      const a = amap.get(r.appointment_id);
      r.pet_name = a?.pet_name;
      r.appt_code = a?.code;
      r.store_id = a?.store_id;
      if (r.locker_id) r.locker_code = lmap.get(r.locker_id)?.code;
      r.from_locker = r.from_locker_id ? lmap.get(r.from_locker_id)?.code : undefined;
      r.target_locker = r.target_locker_id ? lmap.get(r.target_locker_id)?.code : undefined;
    }
    return rows;
  }

  async overviewStats() {
    const [protectedLockers, pendingCases, pendingDirectives, doneDirectives, postFollowups, expired] = await Promise.all([
      this.lockerRepo.count({ where: { status: 'protected' } }),
      this.caseRepo.count({ where: { status: In(['cs_lead_pending', 'storage_lead_pending']) } }),
      this.dirRepo.count({ where: { status: 'pending' } }),
      this.dirRepo.count({ where: { status: 'done' } }),
      this.followRepo.count({ where: { trigger: 'post_disposal', status: 'scheduled' } }),
      this.lockerRepo.count({ where: { status: 'expired' } }),
    ]);
    return {
      protected_lockers: protectedLockers,
      pending_disposal_cases: pendingCases,
      pending_directives: pendingDirectives,
      done_directives: doneDirectives,
      post_disposal_followups: postFollowups,
      expired_lockers: expired,
    };
  }
}

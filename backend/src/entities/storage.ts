import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * 寄存联系人档案：到期前平台按主人偏好发送续费 / 取回 / 转长期寄存提醒，
 * 并记录联系人有效性与授权文件。一个寄存工单一份档案。
 */
@Entity('storage_contacts')
export class StorageContact {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column() appointment_id: number;

  // —— 提醒偏好 ——
  /** renew 续费 / retrieve 到期取回 / long_term 转长期寄存 */
  @Column({ length: 12, default: 'renew' })
  reminder_pref: 'renew' | 'retrieve' | 'long_term';
  /** sms 短信 / phone 电话 / wechat 微信 / email 邮件 */
  @Column({ length: 12, default: 'sms' })
  channel_pref: 'sms' | 'phone' | 'wechat' | 'email';
  @Column({ length: 50, nullable: true }) alt_contact_name: string;      // 备用联系人
  @Column({ length: 30, nullable: true }) alt_contact_phone: string;
  @Column({ length: 50, nullable: true }) alt_contact_relation: string;

  // —— 联系人有效性 ——
  /** unknown 未核实 / valid 有效 / invalid 失失效（空号停机）/ changed 号码已变更 */
  @Column({ length: 12, default: 'unknown' })
  validity: 'unknown' | 'valid' | 'invalid' | 'changed';
  @Column({ type: 'datetime', nullable: true }) last_reached_at: Date;
  @Column({ type: 'text', nullable: true }) validity_note: string;

  // —— 授权文件（代办/迁移/处置授权）——
  /** none 未提供 / uploaded 已上传待核实 / verified 已核实有效 / expired 已过期 */
  @Column({ length: 12, default: 'none' })
  auth_status: 'none' | 'uploaded' | 'verified' | 'expired';
  @Column({ length: 120, nullable: true }) auth_doc_no: string;
  @Column({ type: 'json', nullable: true }) auth_media_urls: string[];
  @Column({ type: 'datetime', nullable: true }) auth_verified_at: Date;
  @Column({ type: 'datetime', nullable: true }) auth_expire_at: Date;
  @Column({ type: 'text', nullable: true }) auth_note: string;

  @Column({ nullable: true }) updated_by: number;
  @CreateDateColumn() created_at: Date;
}

/** 多轮联系记录：每一轮的渠道、结果与证明材料全部留痕 */
@Entity('contact_attempts')
export class ContactAttempt {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** 第几轮联系（从 1 开始） */
  @Column() round: number;
  /** sms 短信 / phone 电话 / wechat 微信 / email 邮件 / visit 上门 / letter 书面信函 */
  @Column({ length: 12 }) channel: 'sms' | 'phone' | 'wechat' | 'email' | 'visit' | 'letter';
  /** reached 已联系上 / no_answer 无人应答 / invalid_number 空号停机 / refused 明确拒绝 /
   *  promised_renew 承诺续费 / promised_retrieve 承诺取回 / promised_long_term 承诺转长期 /
   *  voicemail 语音信箱/留言 */
  @Column({ length: 20, default: 'no_answer' })
  result: 'reached' | 'no_answer' | 'invalid_number' | 'refused' | 'voicemail'
    | 'promised_renew' | 'promised_retrieve' | 'promised_long_term';
  @Column({ type: 'datetime' }) attempted_at: Date;
  @Column({ type: 'text', nullable: true }) note: string;
  /** 证明材料：通话记录截图、短信送达回执、挂号信回执、上门照片等 */
  @Column({ type: 'json', nullable: true }) proof_urls: string[];
  @Column({ nullable: true }) cs_id: number;
  @CreateDateColumn() created_at: Date;
}

/**
 * 柜位处置申请：逾期多轮联系无果后由客服发起，柜位进入受保护待处置状态。
 * 客服主管审批下一步处理 → 寄存主管复核授权与证据 → 通过后才可生成处置指令。
 */
@Entity('storage_disposal_cases')
export class StorageDisposalCase {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column() locker_id: number;
  /** migrate 迁移（长期存放区）/ continue_keep 继续保管 / other 其他合规处置 */
  @Column({ length: 16 }) proposed_action: 'migrate' | 'continue_keep' | 'other';
  @Column({ nullable: true }) target_locker_id: number;
  @Column({ type: 'datetime', nullable: true }) planned_migrate_at: Date;
  @Column({ type: 'text' }) reason: string;

  @Column({ nullable: true }) requested_by: number;

  // —— 客服主管审批 ——
  @Column({ length: 12, default: 'pending' })
  cs_lead_status: 'pending' | 'approved' | 'rejected';
  @Column({ nullable: true }) cs_lead_id: number;
  @Column({ type: 'datetime', nullable: true }) cs_lead_at: Date;
  @Column({ type: 'text', nullable: true }) cs_lead_note: string;

  // —— 寄存主管复核（授权与证据）——
  @Column({ length: 12, default: 'pending' })
  storage_lead_status: 'pending' | 'approved' | 'rejected';
  @Column({ nullable: true }) storage_lead_id: number;
  @Column({ type: 'datetime', nullable: true }) storage_lead_at: Date;
  @Column({ type: 'text', nullable: true }) storage_lead_note: string;

  /** cs_lead_pending 待客服主管审批 / storage_lead_pending 待寄存主管复核 /
   *  approved 双批准（指令待执行）/ rejected 已驳回 / done 处置完成 / withdrawn 已撤回 */
  @Column({ length: 20, default: 'cs_lead_pending' })
  status: 'cs_lead_pending' | 'storage_lead_pending' | 'approved'
    | 'rejected' | 'done' | 'withdrawn';

  @CreateDateColumn() created_at: Date;
}

/**
 * 处置指令：迁移 / 继续保管 / 其他合规处置。
 * 任何处置都保留原柜位快照；执行记录交接人员、时间、交接材料；执行前主人恢复联系可撤回。
 */
@Entity('storage_directives')
export class StorageDirective {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() case_id: number;
  @Column() appointment_id: number;
  @Column({ length: 16 }) action: 'migrate' | 'continue_keep' | 'other';
  /** 该指令产生的账单行；撤回未完成指令时冲销此行以恢复账单 */
  @Column({ nullable: true }) fee_item_id: number;
  /** family_confirmed 家属已确认迁移 / lead_approved 双审批处置 / family_revived 主人恢复联系撤回 */
  @Column({ length: 20, default: 'lead_approved' })
  source: 'family_confirmed' | 'lead_approved';

  // —— 原柜位永久快照 ——
  @Column() from_locker_id: number;
  @Column({ length: 20 }) from_locker_code: string;

  // —— 迁移目标（migrate 时）——
  @Column({ nullable: true }) target_locker_id: number;
  @Column({ length: 20, nullable: true }) target_locker_code: string;
  @Column({ type: 'datetime', nullable: true }) planned_execute_at: Date;

  /** pending 待执行 / done 已执行 / withdrawn 已撤回 */
  @Column({ length: 12, default: 'pending' })
  status: 'pending' | 'done' | 'withdrawn';

  // —— 执行交接 ——
  @Column({ type: 'datetime', nullable: true }) executed_at: Date;
  @Column({ nullable: true }) handler_id: number;        // 交接人员
  @Column({ length: 50, nullable: true }) handler_name: string;
  @Column({ type: 'json', nullable: true }) handover_media_urls: string[];
  @Column({ type: 'text', nullable: true }) execute_note: string;

  // —— 撤回（处置执行前主人恢复联系）——
  @Column({ type: 'datetime', nullable: true }) withdrawn_at: Date;
  @Column({ nullable: true }) withdrawn_by: number;
  @Column({ type: 'text', nullable: true }) withdraw_reason: string;

  @CreateDateColumn() created_at: Date;
}

/** 处置后的家属后续回访结果 */
@Entity('family_callbacks')
export class FamilyCallback {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ nullable: true }) directive_id: number;
  @Column({ type: 'datetime' }) callback_at: Date;
  /** satisfied 满意 / understanding 理解接受 / concerned 仍有顾虑 / unreachable 仍无法联系 */
  @Column({ length: 16, default: 'understanding' })
  result: 'satisfied' | 'understanding' | 'concerned' | 'unreachable';
  @Column({ type: 'text', nullable: true }) note: string;
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @Column({ nullable: true }) cs_id: number;
  @CreateDateColumn() created_at: Date;
}

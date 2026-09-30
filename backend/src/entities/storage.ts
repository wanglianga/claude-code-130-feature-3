import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * 骨灰寄存「到期续费 · 授权 · 柜位处置」领域模型。
 *
 * 业务脉络：
 * 主人续费偏好（StoragePreference）→ 到期按偏好发送续费/取回/转长期提醒
 *  → 主人续费（三项校验：柜位可续用 / 年费是否变更 / 未结服务费用）
 *  → 主人转长期（客服比较可用柜位、迁移时间、家属确认，禁止承诺占用柜位）
 *  → 逾期未回应：多轮联系（ContactAttempt，记录渠道/结果/证明）
 *  → 柜位进入受保护待处置（Locker.status='protected'，不得释放/再分配）
 *  → 客服主管审批 → 寄存主管复核授权与证据 → 生成处置指令（DispositionOrder）
 *  → 执行留痕（原柜位/交接人员/时间）→ 家属后续回访
 *  → 执行前主人恢复联系：撤回未完成指令，恢复账单与柜位状态。
 */

/** 主人续费偏好与联系人有效性 */
@Entity('storage_preferences')
export class StoragePreference {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column() appointment_id: number;
  @Column({ length: 50 }) contact_name: string;            // 主联系人
  @Column({ length: 30 }) contact_phone: string;
  @Column({ length: 50, nullable: true }) alt_contact_name: string;   // 备用联系人
  @Column({ length: 30, nullable: true }) alt_contact_phone: string;
  /** phone 电话 / sms 短信 / wechat 微信 / email 邮件 / letter 信函 */
  @Column({ length: 12, default: 'phone' }) preferred_channel: string;
  /** renew 续费 / retrieve 到期取回 / longterm 转长期寄存 */
  @Column({ length: 12, default: 'renew' }) preferred_action: 'renew' | 'retrieve' | 'longterm';
  @Column({ default: 30 }) notify_days: number;           // 提前提醒天数
  @Column({ type: 'text', nullable: true }) notes: string;
  /** unknown 未核查 / valid 有效 / invalid 失效（空号/拒收/停机） */
  @Column({ length: 10, default: 'unknown' }) contact_valid: 'unknown' | 'valid' | 'invalid';
  @Column({ nullable: true }) checked_by: number;
  @Column({ type: 'datetime', nullable: true }) checked_at: Date;
  @CreateDateColumn() created_at: Date;
}

/** 授权 / 关系证明文件（委托书、家属确认书、身份材料等） */
@Entity('storage_authorizations')
export class StorageAuthorization {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** owner_id 主人身份证明 / power_of_attorney 授权委托书 / family_confirm 家属确认书 /
   *  relation 亲属关系证明 / other 其他 */
  @Column({ length: 24 }) doc_type: string;
  @Column({ length: 120 }) title: string;
  @Column({ length: 60, nullable: true }) doc_no: string;
  @Column({ length: 255 }) file_url: string;
  @Column({ nullable: true }) uploaded_by: number;
  /** uploaded 已上传待核 / verified 复核通过 / rejected 不采信 */
  @Column({ length: 10, default: 'uploaded' }) status: 'uploaded' | 'verified' | 'rejected';
  @Column({ nullable: true }) verified_by: number;
  @Column({ type: 'datetime', nullable: true }) verified_at: Date;
  @Column({ type: 'text', nullable: true }) verify_note: string;
  @CreateDateColumn() created_at: Date;
}

/** 多轮联系记录：渠道、结果、证明材料 */
@Entity('contact_attempts')
export class ContactAttempt {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() case_id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ default: 1 }) round: number;                 // 第几轮联系
  /** phone 电话 / sms 短信 / wechat 微信 / email 邮件 / letter 书面信函 / onsite 上门 */
  @Column({ length: 12 }) channel: string;
  /** reached 已联系上 / promised 家属承诺处理 / no_answer 无人接听 /
   *  bounced 空号停机退信 / refused 明确拒绝 / message_left 已留言待回 */
  @Column({ length: 12 }) result: string;
  @Column({ type: 'datetime' }) contacted_at: Date;
  @Column({ nullable: true }) cs_id: number;
  @Column({ type: 'text', nullable: true }) note: string;
  /** 通话录音、短信截图、信函底单、上门照片等证明材料 */
  @Column({ type: 'json', nullable: true }) evidence_urls: string[];
  @CreateDateColumn() created_at: Date;
}

export type DispositionCaseStatus =
  | 'contacting'              // 多轮联系中（柜位受保护）
  | 'awaiting_supervisor'     // 待客服主管审批下一步
  | 'awaiting_storage_review' // 待寄存主管复核授权与证据
  | 'ordered'                 // 已生成处置指令，待执行
  | 'executed'                // 处置已执行
  | 'withdrawn'               // 执行前主人恢复联系，已撤回
  | 'closed_resolved';        // 家属自行续费/取回，案件闭环

/** 柜位处置案件：一个寄存柜位在一个处置周期内的聚合根 */
@Entity('locker_disposition_cases')
export class LockerDispositionCase {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ length: 24 }) code: string;                 // DC-yyyymmdd-xxx
  @Index()
  @Column() appointment_id: number;
  @Column() locker_id: number;                          // 原柜位
  @Column() store_id: number;
  /** overdue_no_response 逾期多轮联系无回应 / owner_longterm_request 主人申请转长期 */
  @Column({ length: 24 }) reason: string;
  @Column({ type: 'varchar', length: 24, default: 'contacting' }) status: DispositionCaseStatus;
  /** renew 续费 / retrieve 取回 / longterm 转长期 / none 未表态 */
  @Column({ length: 12, default: 'none' }) owner_choice: 'renew' | 'retrieve' | 'longterm' | 'none';

  // —— 多轮联系要求 ——
  @Column({ default: 3 }) rounds_required: number;
  @Column({ type: 'datetime', nullable: true }) last_attempt_at: Date;
  @Column({ nullable: true }) cs_id: number;
  /** 开案时柜位剩余/逾期天数快照 */
  @Column({ default: 0 }) remain_days_snapshot: number;

  // —— 转长期：柜位比较与家属确认 ——
  @Column({ nullable: true }) target_locker_id: number;
  @Column({ type: 'datetime', nullable: true }) planned_move_at: Date;
  @Column({ default: false }) family_confirmed: boolean;

  // —— 客服主管审批 ——
  @Column({ nullable: true }) supervisor_id: number;
  @Column({ length: 10, nullable: true }) supervisor_decision: 'approve' | 'reject';
  @Column({ type: 'text', nullable: true }) supervisor_note: string;
  @Column({ type: 'datetime', nullable: true }) supervised_at: Date;

  // —— 寄存主管复核 ——
  @Column({ nullable: true }) reviewer_id: number;
  @Column({ length: 10, nullable: true }) review_decision: 'approve' | 'reject';
  @Column({ type: 'text', nullable: true }) review_note: string;
  @Column({ type: 'datetime', nullable: true }) reviewed_at: Date;

  // —— 撤回（主人处置执行前恢复联系）——
  @Column({ nullable: true }) withdrawn_by: number;
  @Column({ type: 'datetime', nullable: true }) withdrawn_at: Date;
  @Column({ type: 'text', nullable: true }) withdraw_note: string;

  @CreateDateColumn() created_at: Date;
}

export type DispositionAction = 'migrate' | 'continue_storage' | 'retrieve' | 'other';
export type DispositionOrderStatus = 'pending' | 'executed' | 'withdrawn';

/** 处置指令：迁移 / 继续保管 / 取回 / 其他合规处置 */
@Entity('disposition_orders')
export class DispositionOrder {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ length: 24 }) order_no: string;             // DO-yyyymmdd-xxx
  @Index()
  @Column() case_id: number;
  @Column() appointment_id: number;
  @Column({ type: 'varchar', length: 16 }) action: DispositionAction;
  @Column({ type: 'varchar', length: 12, default: 'pending' }) status: DispositionOrderStatus;

  /** 原柜位（任何处置都永久保留，不得清空） */
  @Column() from_locker_id: number;
  @Column({ length: 20 }) from_locker_code: string;
  /** 迁移目标柜位 */
  @Column({ nullable: true }) to_locker_id: number;
  @Column({ length: 20, nullable: true }) to_locker_code: string;

  /** 续费/保管周期（月）：迁移长期 120、继续保管 12 等，驱动账单与到期日 */
  @Column({ type: 'int', nullable: true }) period_months: number;
  @Column({ type: 'datetime', nullable: true }) planned_at: Date;
  @Column({ length: 120, nullable: true }) action_note: string;

  // —— 执行留痕：交接人员、时间、证明 ——
  @Column({ length: 60, nullable: true }) handover_by: string;
  @Column({ nullable: true }) executed_by: number;
  @Column({ type: 'datetime', nullable: true }) executed_at: Date;
  @Column({ type: 'text', nullable: true }) execute_note: string;
  @Column({ type: 'json', nullable: true }) evidence_urls: string[];

  /** 家属后续回访结果 */
  @Column({ type: 'text', nullable: true }) follow_up_result: string;
  @Column({ nullable: true }) follow_up_by: number;
  @Column({ type: 'datetime', nullable: true }) follow_up_at: Date;

  /** 处置阶段产生的续费账单（撤回时冲红恢复用） */
  @Column({ nullable: true }) fee_item_id: number;

  @Column({ nullable: true }) created_by: number;
  @CreateDateColumn() created_at: Date;
}

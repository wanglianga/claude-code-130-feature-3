import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type PetType = 'cat' | 'dog' | 'rabbit' | 'exotic';

/**
 * 服务预约单：围绕一只宠物的全流程聚合根。
 * 状态机：
 * submitted 待客服确认
 * cs_confirmed 客服已确认方案
 * scheduled 已调度（接送/暂存/火化炉/告别室）
 * picked_up 已接运
 * in_storage 冷藏暂存中
 * farewell 告别仪式中
 * cremating 火化中
 * fulfilled 火化完成（待纪念品/寄存/寄送收尾）
 * completed 全部完成
 * cancelled 已取消
 */
export type AppointmentStatus =
  | 'submitted' | 'cs_confirmed' | 'scheduled' | 'picked_up'
  | 'in_storage' | 'farewell' | 'cremating' | 'fulfilled'
  | 'completed' | 'cancelled';

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ length: 20 }) code: string;

  @Column() store_id: number;
  @Column() owner_id: number;
  @Column({ nullable: true }) hospital_id: number;   // 宠物医院转介

  // —— 宠物信息 ——
  @Column({ length: 50 }) pet_name: string;
  @Column({ type: 'varchar', length: 10 }) pet_type: PetType;
  @Column({ length: 80 }) pet_breed: string;
  @Column({ type: 'decimal', precision: 7, scale: 2, default: 0 }) weight_kg: string;
  @Column({ type: 'datetime' }) death_time: Date;
  @Column({ type: 'decimal', precision: 7, scale: 2, nullable: true }) actual_weight_kg: string;

  // —— 服务选项 ——
  @Column({ default: false }) need_pickup: boolean;
  @Column({ length: 255, nullable: true }) pickup_address: string;
  @Column({ default: false }) want_ceremony: boolean;       // 纪念仪式
  @Column({ default: false }) private_cremation: boolean;  // 单独火化
  @Column({ default: false }) want_urn: boolean;           // 骨灰盒
  @Column({ default: false }) pawprint_hair: boolean;      // 爪印毛发纪念
  @Column({ default: false }) photo_video: boolean;        // 照片视频
  @Column({ default: 0 }) storage_months: number;          // 寄存期限（月）

  // —— 报价 ——
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 }) quote_amount: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 }) final_amount: string;

  // —— 调度与人 ——
  @Column({ type: 'varchar', length: 20, default: 'submitted' }) status: AppointmentStatus;
  @Column({ nullable: true }) driver_id: number;
  @Column({ nullable: true }) ceremonialist_id: number;
  @Column({ nullable: true }) cremator_id: number;

  // —— 承诺时间（各环节）——
  @Column({ type: 'datetime', nullable: true }) pickup_promised_at: Date;
  @Column({ type: 'datetime', nullable: true }) pickup_actual_at: Date;
  @Column({ type: 'datetime', nullable: true }) ceremony_scheduled_at: Date;
  @Column({ type: 'datetime', nullable: true }) ceremony_started_at: Date;
  @Column({ type: 'datetime', nullable: true }) furnace_scheduled_at: Date;
  @Column({ type: 'datetime', nullable: true }) cremated_at: Date;

  // —— 收尾 ——
  @Column({ default: false }) video_witness: boolean;       // 家属要求视频见证
  @Column({ length: 255, nullable: true }) witness_note: string;
  @Column({ type: 'datetime', nullable: true }) completed_at: Date;
  @Column({ length: 255, nullable: true }) cancel_reason: string;

  @CreateDateColumn() created_at: Date;
}

/** 交接/见证材料：敏感争议可追溯到具体交接节点 */
@Entity('timeline_events')
export class TimelineEvent {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** 节点：submitted / cs_confirmed / driver_assigned / picked_up / cold_in / cold_out /
   *  ceremony_reschedule / farewell_start / farewell_end / cremation_start / cremation_end /
   *  certificate / memento 系列 / urn_shipped / delivery_damaged / storage_in /
   *  storage_renewed / storage_expired / followup / exception 等 */
  @Column({ length: 40 }) node_key: string;
  @Column({ length: 200 }) title: string;
  @Column({ type: 'varchar', length: 20, default: 'normal' })
  flag: 'normal' | 'exception' | 'resolved';
  @Column({ nullable: true }) actor_id: number;
  @Column({ length: 30, nullable: true }) actor_role: string;
  @Column({ type: 'datetime', nullable: true }) promised_at: Date;
  @Column({ type: 'datetime', nullable: true }) occurred_at: Date;
  @Column({ type: 'text', nullable: true }) note: string;
  /** 交接照片/视频 URL 等见证材料（JSON 数组） */
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @CreateDateColumn() created_at: Date;
}

import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** 费用明细：报价之后每一次费用变化都留痕（体重不符补差价等） */
@Entity('fee_items')
export class FeeItem {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** base_quote 基础报价 / weight_adjust 体重补差 / extra_pickup 超距接送 /
   *  ceremony 仪式 / private 单独火化 / urn 骨灰盒 / memento 纪念品 /
   *  storage 寄存年费 / shipping 寄送 / discount 优惠 / refund 退款 */
  @Column({ length: 30 }) kind: string;
  @Column({ length: 120 }) title: string;
  @Column({ type: 'decimal', precision: 10, scale: 2 }) amount: string;
  @Column({ length: 255, nullable: true }) reason: string;
  @Column({ nullable: true }) operator_id: number;
  /** change 变更项需家属确认；base 初始报价 */
  @Column({ type: 'varchar', length: 10, default: 'base' }) entry_type: 'base' | 'change';
  @Column({ type: 'varchar', length: 12, default: 'pending' })
  confirm_status: 'pending' | 'confirmed' | 'rejected';
  @CreateDateColumn() created_at: Date;
}

/** 家属确认：方案确认 / 费用变更确认 / 视频见证确认等 */
@Entity('confirmations')
export class Confirmation {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** plan 服务方案 / fee_change 费用变化 / ceremony_time 仪式时间 / video_witness 视频见证 */
  @Column({ length: 30 }) subject: string;
  @Column({ type: 'text', nullable: true }) content: string;
  @Column({ length: 20, default: 'pending' }) status: 'pending' | 'confirmed' | 'rejected';
  @Column({ type: 'datetime', nullable: true }) confirmed_at: Date;
  @Column({ length: 255, nullable: true }) reply_note: string;
  @Column({ nullable: true }) requested_by: number;
  @CreateDateColumn() created_at: Date;
}

/** 火化炉排期 */
@Entity('furnace_slots')
export class FurnaceSlot {
  @PrimaryGeneratedColumn() id: number;
  @Column() store_id: number;
  @Column({ length: 40 }) furnace_name: string;
  @Column({ type: 'datetime' }) start_at: Date;
  @Column({ type: 'datetime' }) end_at: Date;
  @Column({ nullable: true }) appointment_id: number;
  @Column({ length: 12, default: 'free' }) status: 'free' | 'locked' | 'done';
}

/** 告别室排期 */
@Entity('farewell_room_slots')
export class FarewellRoomSlot {
  @PrimaryGeneratedColumn() id: number;
  @Column() store_id: number;
  @Column({ length: 40 }) room_name: string;
  @Column({ type: 'datetime' }) start_at: Date;
  @Column({ type: 'datetime' }) end_at: Date;
  @Column({ nullable: true }) appointment_id: number;
  @Column({ length: 12, default: 'free' }) status: 'free' | 'locked' | 'done';
}

/** 冷藏暂存位 */
@Entity('cold_storage')
export class ColdStorage {
  @PrimaryGeneratedColumn() id: number;
  @Column() store_id: number;
  @Column({ length: 40 }) cell_name: string;
  @Column({ nullable: true }) appointment_id: number;
  @Column({ type: 'datetime', nullable: true }) in_at: Date;
  @Column({ type: 'datetime', nullable: true }) out_at: Date;
  @Column({ length: 12, default: 'free' }) status: 'free' | 'occupied';
}

/** 火化证明 */
@Entity('cremation_certificates')
export class CremationCertificate {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ length: 30 }) cert_no: string;
  @Column() appointment_id: number;
  @Column({ type: 'datetime' }) cremated_at: Date;
  @Column() cremator_id: number;
  @Column({ default: false }) private_cremation: boolean;
  /** 火化现场/炉前炉后照片 */
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @CreateDateColumn() created_at: Date;
}

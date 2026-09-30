import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** 纪念品制作单（爪印、毛发纪念等）—— 状态影响客服回访节奏 */
@Entity('mementos')
export class Memento {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** pawprint 爪印 / hair 毛发纪念 / photo_album 相册周边 / other */
  @Column({ length: 20 }) kind: string;
  @Column({ length: 120 }) name: string;
  /** pending 待制作 / making 制作中 / failed 制作失败 / done 完成 / remake 重做中 */
  @Column({ length: 12, default: 'pending' })
  status: 'pending' | 'making' | 'failed' | 'remake' | 'done';
  @Column({ type: 'datetime', nullable: true }) due_at: Date;       // 承诺交付时间
  @Column({ type: 'datetime', nullable: true }) finished_at: Date;
  @Column({ nullable: true }) artisan_id: number;
  @Column({ type: 'text', nullable: true }) fail_reason: string;
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @CreateDateColumn() created_at: Date;
}

/** 骨灰盒寄送单：破损可登记异常并补发 */
@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ length: 40 }) tracking_no: string;
  @Column({ length: 40 }) carrier: string;
  @Column({ type: 'datetime' }) ship_at: Date;
  @Column({ type: 'datetime', nullable: true }) delivered_at: Date;
  /** in_transit 在途 / delivered 已签收 / damaged 破损 / resent 已补发 / claimed 家属认领 */
  @Column({ length: 12, default: 'in_transit' })
  status: 'in_transit' | 'delivered' | 'damaged' | 'resent' | 'claimed';
  @Column({ type: 'text', nullable: true }) damage_note: string;
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @Column({ length: 40, nullable: true }) resend_tracking_no: string;
  @CreateDateColumn() created_at: Date;
}

/** 寄存柜位 */
@Entity('lockers')
export class Locker {
  @PrimaryGeneratedColumn() id: number;
  @Column() store_id: number;
  @Column({ length: 20 }) code: string;           // 如 A-01-03
  @Column({ length: 20, default: 'standard' }) tier: 'standard' | 'premium';
  /** free 空闲 / occupied 占用中 / expiring 即将到期（30天内）/ expired 已到期 /
   *  protected 受保护待处置（逾期多轮联系无回应，禁止释放与再分配）/
   *  reserved 已被处置迁移指令预占（不可再承诺给他人）*/
  @Column({ length: 12, default: 'free' })
  status: 'free' | 'occupied' | 'expiring' | 'expired' | 'protected' | 'reserved';
  @Column({ nullable: true }) appointment_id: number;
  @Column({ type: 'datetime', nullable: true }) occupied_since: Date;
  @Column({ type: 'datetime', nullable: true }) expire_at: Date;   // 年费到期
  @Column({ type: 'decimal', precision: 8, scale: 2, default: 600 }) annual_fee: string;
  /** 被哪条处置迁移指令预占（reserved 状态时），防止柜位被重复承诺/分配 */
  @Column({ nullable: true }) reserved_for_order_id: number;
}

/** 情感回访记录（含情绪安抚）—— 回访节奏由柜位/纪念品状态驱动 */
@Entity('followups')
export class Followup {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ type: 'datetime' }) planned_at: Date;   // 计划回访时间
  @Column({ type: 'datetime', nullable: true }) done_at: Date;
  /** scheduled 待回访 / done 已完成 / skipped 跳过 */
  @Column({ length: 12, default: 'scheduled' }) status: 'scheduled' | 'done' | 'skipped';
  /** routine 常规 / memento_failed 纪念品失败关怀 / locker_expiring 柜位到期提醒 /
   *  locker_expired 到期未续费 / post_service 服务后情绪安抚 /
   *  locker_renew_reminder 续费提醒 / locker_retrieve_reminder 取回提醒 /
   *  locker_longterm_reminder 转长期提醒 / disposition_followup 处置后家属回访 */
  @Column({ length: 30 }) trigger: string;
  @Column({ type: 'text', nullable: true }) emotion_note: string; // 家属情绪记录
  @Column({ type: 'text', nullable: true }) content: string;
  @Column({ nullable: true }) cs_id: number;
  @CreateDateColumn() created_at: Date;
}

/** 纪念相册（照片/视频归档，与时间线材料互补） */
@Entity('album_media')
export class AlbumMedia {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ length: 120 }) title: string;
  /** photo / video */
  @Column({ length: 10 }) kind: string;
  @Column({ length: 255 }) url: string;
  @Column({ length: 200, nullable: true }) caption: string;
  @Column({ nullable: true }) uploader_id: number;
  @CreateDateColumn() created_at: Date;
}

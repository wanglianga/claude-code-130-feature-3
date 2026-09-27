import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** 收款记录 */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ type: 'decimal', precision: 10, scale: 2 }) amount: string;
  @Column({ length: 20, default: 'wechat' }) method: 'wechat' | 'alipay' | 'card' | 'cash';
  @Column({ length: 20, default: 'paid' }) status: 'paid' | 'refunded';
  @Column({ nullable: true }) finance_id: number;
  @Column({ length: 255, nullable: true }) note: string;
  @CreateDateColumn() created_at: Date;
}

/** 围绕同一只宠物的多角色沟通消息 */
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column() sender_id: number;
  @Column({ length: 30 }) sender_role: string;
  @Column({ length: 50 }) sender_name: string;
  @Column({ type: 'text' }) content: string;
  @CreateDateColumn() created_at: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HedgeRuleEntity } from './hedge-rule.entity';
import { PositionEntity } from './position.entity';

@Entity('hedge_execution_logs')
export class HedgeLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  hedgeRuleId: string;

  @Column({ type: 'uuid' })
  positionId: string;

  @Column()
  actionTaken: string; // e.g. 'OPENED_SHORT_QQQ_HEDGE'

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  hedgeRatioApplied: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  triggerValue: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  executedPrice: number;

  @ManyToOne(() => HedgeRuleEntity, (rule) => rule.hedgeLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hedgeRuleId' })
  hedgeRule: HedgeRuleEntity;

  @ManyToOne(() => PositionEntity, (position) => position.hedgeLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'positionId' })
  position: PositionEntity;

  @CreateDateColumn()
  createdAt: Date;
}

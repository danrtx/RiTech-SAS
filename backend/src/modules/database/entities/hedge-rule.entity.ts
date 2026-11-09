import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { AssetEntity } from './asset.entity';
import { HedgeLogEntity } from './hedge-log.entity';

@Entity('hedge_rules')
export class HedgeRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column()
  ruleName: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'ATR Volatility threshold trigger' })
  atrThreshold: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, comment: 'Max drawdown percentage trigger' })
  maxDrawdownPct: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 1.0, comment: '1.0 = 100% hedge ratio' })
  targetHedgeRatio: number;

  @Column({ default: true })
  isActive: boolean;

  @ManyToOne(() => UserEntity, (user) => user.hedgeRules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => AssetEntity, (asset) => asset.hedgeRules, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assetId' })
  asset: AssetEntity;

  @OneToMany(() => HedgeLogEntity, (log) => log.hedgeRule)
  hedgeLogs: HedgeLogEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

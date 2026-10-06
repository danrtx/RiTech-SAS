import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { PositionEntity } from './position.entity';
import { HedgeRuleEntity } from './hedge-rule.entity';

export enum AssetType {
  INDEX = 'INDEX',
  ETF = 'ETF',
  EQUITY = 'EQUITY',
}

@Entity('assets')
export class AssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  symbol: string; // e.g. NDX, QQQ, AAPL, NVDA

  @Column()
  name: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.EQUITY })
  assetType: AssetType;

  @Column({ default: true })
  isTradable: boolean;

  @OneToMany(() => PositionEntity, (position) => position.asset)
  positions: PositionEntity[];

  @OneToMany(() => HedgeRuleEntity, (rule) => rule.asset)
  hedgeRules: HedgeRuleEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

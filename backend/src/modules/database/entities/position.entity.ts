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
import { OrderEntity } from './order.entity';
import { HedgeLogEntity } from './hedge-log.entity';

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  HEDGED = 'HEDGED',
}

@Entity('positions')
export class PositionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'enum', enum: PositionSide })
  side: PositionSide;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  quantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  entryPrice: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  currentPrice: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  unrealizedPnl: number;

  @Column({ type: 'enum', enum: PositionStatus, default: PositionStatus.OPEN })
  status: PositionStatus;

  @ManyToOne(() => UserEntity, (user) => user.positions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => AssetEntity, (asset) => asset.positions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assetId' })
  asset: AssetEntity;

  @OneToMany(() => OrderEntity, (order) => order.position)
  orders: OrderEntity[];

  @OneToMany(() => HedgeLogEntity, (log) => log.position)
  hedgeLogs: HedgeLogEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { PositionEntity } from './position.entity';
import { OrderEntity } from './order.entity';
import { HedgeRuleEntity } from './hedge-rule.entity';

export enum UserRole {
  ADMIN = 'ADMIN',
  TRADER = 'TRADER',
  ANALYST = 'ANALYST',
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column()
  fullName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.TRADER })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => PositionEntity, (position) => position.user)
  positions: PositionEntity[];

  @OneToMany(() => OrderEntity, (order) => order.user)
  orders: OrderEntity[];

  @OneToMany(() => HedgeRuleEntity, (rule) => rule.user)
  hedgeRules: HedgeRuleEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

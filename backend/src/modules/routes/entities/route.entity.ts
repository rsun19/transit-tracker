import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Agency } from '@/modules/agencies/entities/agency.entity';

@Entity('routes')
@Unique(['agencyId', 'routeId'])
@Index(['agencyId', 'routeType'])
export class Route {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId!: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency!: Agency;

  @Column({ name: 'route_id', type: 'varchar', length: 100 })
  routeId!: string;

  @Column({ name: 'short_name', type: 'varchar', length: 50, nullable: true })
  shortName!: string | null;

  @Column({ name: 'long_name', type: 'text', nullable: true })
  longName!: string | null;

  @Column({ name: 'route_type', type: 'smallint' })
  routeType!: number;

  @Column({ name: 'color', type: 'varchar', length: 6, nullable: true })
  color!: string | null;

  @Column({ name: 'text_color', type: 'varchar', length: 6, nullable: true })
  textColor!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

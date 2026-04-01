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

@Entity('trips')
@Unique(['agencyId', 'tripId'])
@Index(['agencyId', 'routeId'])
@Index(['agencyId', 'serviceId'])
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId!: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency!: Agency;

  @Column({ name: 'trip_id', type: 'varchar', length: 100 })
  tripId!: string;

  @Column({ name: 'route_id', type: 'varchar', length: 100 })
  routeId!: string;

  @Column({ name: 'service_id', type: 'varchar', length: 100 })
  serviceId!: string;

  @Column({ name: 'trip_headsign', type: 'text', nullable: true })
  tripHeadsign!: string | null;

  @Column({ name: 'direction_id', type: 'smallint', nullable: true })
  directionId!: number | null;

  @Column({ name: 'shape_id', type: 'varchar', length: 100, nullable: true })
  shapeId!: string | null;

  @Column({ name: 'wheelchair_accessible', type: 'smallint', nullable: true })
  wheelchairAccessible!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

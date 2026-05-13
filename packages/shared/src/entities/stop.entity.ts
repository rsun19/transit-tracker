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
import { Agency } from './agency.entity';

@Entity('stops')
@Unique(['agencyId', 'stopId'])
@Index(['agencyId', 'stopCode'])
export class Stop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId!: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency!: Agency;

  @Column({ name: 'stop_id', type: 'varchar', length: 100 })
  stopId!: string;

  @Column({ name: 'stop_name', type: 'text' })
  stopName!: string;

  @Column({ name: 'stop_code', type: 'varchar', length: 50, nullable: true })
  stopCode!: string | null;

  @Column({
    name: 'location',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  @Index({ spatial: true })
  location!: string;

  @Column({ name: 'parent_station_id', type: 'varchar', length: 100, nullable: true })
  parentStationId!: string | null;

  @Column({ name: 'wheelchair_boarding', type: 'smallint', nullable: true })
  wheelchairBoarding!: number | null;

  @Index()
  @Column({ name: 'colocated_group_id', type: 'varchar', length: 100, nullable: true })
  colocatedGroupId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

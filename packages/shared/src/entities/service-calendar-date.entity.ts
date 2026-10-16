import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Agency } from './agency.entity';

/** One row of calendar_dates.txt: a service added (1) or removed (2) on a date. */
@Entity('service_calendar_dates')
@Unique(['agencyId', 'serviceId', 'date'])
@Index('idx_service_calendar_dates_agency_date', ['agencyId', 'date'])
export class ServiceCalendarDate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId!: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency!: Agency;

  @Column({ name: 'service_id', type: 'varchar', length: 100 })
  serviceId!: string;

  @Column({ name: 'date', type: 'date' })
  date!: string;

  @Column({ name: 'exception_type', type: 'smallint' })
  exceptionType!: number;
}

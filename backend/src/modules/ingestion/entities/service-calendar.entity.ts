import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Agency } from '../../agencies/entities/agency.entity.js';

@Entity('service_calendars')
@Unique(['agencyId', 'serviceId'])
export class ServiceCalendar {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency: Agency;

  @Column({ name: 'service_id', type: 'varchar', length: 100 })
  serviceId: string;

  @Column({ name: 'monday', type: 'boolean', default: false })
  monday: boolean;

  @Column({ name: 'tuesday', type: 'boolean', default: false })
  tuesday: boolean;

  @Column({ name: 'wednesday', type: 'boolean', default: false })
  wednesday: boolean;

  @Column({ name: 'thursday', type: 'boolean', default: false })
  thursday: boolean;

  @Column({ name: 'friday', type: 'boolean', default: false })
  friday: boolean;

  @Column({ name: 'saturday', type: 'boolean', default: false })
  saturday: boolean;

  @Column({ name: 'sunday', type: 'boolean', default: false })
  sunday: boolean;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;
}

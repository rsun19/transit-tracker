import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Agency } from '@/modules/agencies/entities/agency.entity';

@Entity('stop_times')
@Index(['agencyId', 'tripId', 'stopSequence'])
@Index(['agencyId', 'stopId', 'departureTime'])
export class StopTime {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId!: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency!: Agency;

  @Column({ name: 'trip_id', type: 'varchar', length: 100 })
  tripId!: string;

  @Column({ name: 'stop_id', type: 'varchar', length: 100 })
  stopId!: string;

  @Column({ name: 'stop_sequence', type: 'integer' })
  stopSequence!: number;

  // Stored as INTERVAL (seconds past midnight) to support GTFS post-midnight times (e.g. 25:00:00)
  @Column({ name: 'arrival_time', type: 'interval', nullable: true })
  arrivalTime!: string | null;

  // Stored as INTERVAL (seconds past midnight) to support GTFS post-midnight times (e.g. 25:00:00)
  @Column({ name: 'departure_time', type: 'interval', nullable: true })
  departureTime!: string | null;

  @Column({ name: 'stop_headsign', type: 'text', nullable: true })
  stopHeadsign!: string | null;

  @Column({ name: 'pickup_type', type: 'smallint', nullable: true })
  pickupType!: number | null;

  @Column({ name: 'drop_off_type', type: 'smallint', nullable: true })
  dropOffType!: number | null;
}

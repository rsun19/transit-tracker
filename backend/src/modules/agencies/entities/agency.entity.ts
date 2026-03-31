import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('agencies')
@Unique(['agencyKey'])
export class Agency {
  @PrimaryGeneratedColumn('uuid')
  agencyId!: string;

  @Column({ name: 'agency_key', type: 'varchar', length: 50, unique: true })
  agencyKey!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'timezone', type: 'varchar', length: 64 })
  timezone!: string;

  @Column({ name: 'gtfs_static_url', type: 'text' })
  gtfsStaticUrl!: string;

  @Column({ name: 'gtfs_realtime_url', type: 'text', nullable: true })
  gtfsRealtimeUrl!: string | null;

  @Column({ name: 'api_key_env_var', type: 'varchar', length: 128, nullable: true })
  apiKeyEnvVar!: string | null;

  @Column({ name: 'last_ingested_at', type: 'timestamptz', nullable: true })
  lastIngestedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

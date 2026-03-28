import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Agency } from '../../agencies/entities/agency.entity.js';

@Entity('shapes')
@Index(['agencyId', 'shapeId', 'ptSequence'])
export class Shape {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agency_id', type: 'uuid' })
  agencyId!: string;

  @ManyToOne(() => Agency, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'agency_id' })
  agency!: Agency;

  @Column({ name: 'shape_id', type: 'varchar', length: 100 })
  shapeId!: string;

  @Column({ name: 'pt_sequence', type: 'integer' })
  ptSequence!: number;

  @Column({
    name: 'location',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location!: string;
}

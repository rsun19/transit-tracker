import { bootstrapService } from '@transit-tracker/shared/nest';
import { VehiclesModule } from './vehicles.module';

void bootstrapService(VehiclesModule, { name: 'Vehicles', defaultPort: 3005 });

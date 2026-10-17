import { bootstrapService } from '@transit-tracker/shared/nest';
import { StopsModule } from './stops.module';

void bootstrapService(StopsModule, { name: 'Stops', defaultPort: 3003 });

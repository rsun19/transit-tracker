import { bootstrapService } from '@transit-tracker/shared/nest';
import { AgenciesModule } from './agencies.module';

void bootstrapService(AgenciesModule, { name: 'Agencies', defaultPort: 3001 });

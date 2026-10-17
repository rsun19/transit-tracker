import { bootstrapService } from '@transit-tracker/shared/nest';
import { RoutesModule } from './routes.module';

void bootstrapService(RoutesModule, { name: 'Routes', defaultPort: 3002 });

import { bootstrapService } from '@transit-tracker/shared/nest';
import { AlertsModule } from './alerts.module';

void bootstrapService(AlertsModule, { name: 'Alerts', defaultPort: 3004 });

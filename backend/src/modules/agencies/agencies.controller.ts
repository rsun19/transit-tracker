import { Controller, Get } from '@nestjs/common';
import { AgenciesService } from './agencies.service';

@Controller('api/v1/agencies')
export class AgenciesController {
  constructor(private readonly agenciesService: AgenciesService) {}

  @Get()
  getAgencies() {
    return {
      data: this.agenciesService.getAllAgencies().map((a) => ({
        key: a.key,
        displayName: a.displayName,
        timezone: a.timezone,
        hasRealtimePositions: a.hasRealtimePositions,
        hasRealtimeTripUpdates: a.hasRealtimeTripUpdates,
        lastIngestedAt: null, // updated by ingestion service
      })),
    };
  }
}

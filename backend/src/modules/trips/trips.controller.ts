import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { TripsService } from './trips.service';

@Controller('api/v1/trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get(':tripId')
  async findOne(@Param('tripId') tripId: string, @Query('agencyKey') agencyKey?: string) {
    if (!agencyKey) throw new BadRequestException('agencyKey is required');
    return this.tripsService.findOne(tripId, agencyKey);
  }
}

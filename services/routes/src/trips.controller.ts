import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { TripsService, parseServiceDate } from './trips.service';

@Controller('api/v1/trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get(':tripId')
  async findOne(
    @Param('tripId') tripId: string,
    @Query('agencyKey') agencyKey?: string,
    @Query('serviceDate') serviceDate?: string,
  ) {
    if (!agencyKey) throw new BadRequestException('agencyKey is required');
    let date: string | undefined;
    if (serviceDate !== undefined) {
      date = parseServiceDate(serviceDate) ?? undefined;
      if (!date) throw new BadRequestException('serviceDate must be YYYYMMDD');
    }
    return this.tripsService.findOne(tripId, agencyKey, date);
  }
}

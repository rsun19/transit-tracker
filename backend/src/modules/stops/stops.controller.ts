import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { StopsService } from './stops.service';
import { NEARBY_MAX_RADIUS_M } from '@/common/constants';

@Controller('api/v1/stops')
export class StopsController {
  constructor(private readonly stopsService: StopsService) {}

  @Get('nearby')
  async getNearby(
    @Res() res: Response,
    @Query('lat') latStr?: string,
    @Query('lon') lonStr?: string,
    @Query('radius') radiusStr?: string,
    @Query('agencyKey') agencyKey?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!latStr || !lonStr) throw new BadRequestException('lat and lon are required');

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || lat < -90 || lat > 90)
      throw new BadRequestException('lat must be between -90 and 90');
    if (isNaN(lon) || lon < -180 || lon > 180)
      throw new BadRequestException('lon must be between -180 and 180');

    const radius = radiusStr ? parseInt(radiusStr, 10) : undefined;
    if (radius !== undefined && radius > NEARBY_MAX_RADIUS_M) {
      throw new BadRequestException(`radius must not exceed ${NEARBY_MAX_RADIUS_M}m`);
    }

    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    res.set('Cache-Control', 'no-store');
    const data = await this.stopsService.getNearbyStops({
      lat,
      lon,
      radiusM: radius,
      agencyKey,
      limit,
    });
    return res.json(data);
  }

  @Get()
  async search(
    @Res() res: Response,
    @Query('q') q?: string,
    @Query('agencyKey') agencyKey?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    if (!q || q.length < 2) {
      throw new BadRequestException('q must be at least 2 characters');
    }
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;
    res.set('Cache-Control', 'no-store');
    const data = await this.stopsService.search(q, agencyKey, limit, offset);
    return res.json(data);
  }

  @Get(':stopId/arrivals')
  async getArrivals(
    @Res() res: Response,
    @Param('stopId') stopId: string,
    @Query('agencyKey') agencyKey?: string,
    @Query('limit') limitStr?: string,
    @Query('after') after?: string,
  ) {
    if (!agencyKey) throw new BadRequestException('agencyKey is required');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    res.set('Cache-Control', 'no-store');
    const data = await this.stopsService.getArrivals(stopId, agencyKey, limit, after);
    return res.json(data);
  }

  @Get(':stopId/routes')
  async getRoutesForStop(
    @Res() res: Response,
    @Param('stopId') stopId: string,
    @Query('agencyKey') agencyKey?: string,
  ) {
    if (!agencyKey) throw new BadRequestException('agencyKey is required');
    res.set('Cache-Control', 'no-store');
    const data = await this.stopsService.getRoutesForStop(stopId, agencyKey);
    return res.json(data);
  }
}

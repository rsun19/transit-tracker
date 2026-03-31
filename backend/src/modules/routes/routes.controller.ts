import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { RoutesService } from './routes.service';

@Controller('api/v1/routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get()
  async findAll(
    @Query('agencyKey') agencyKey?: string,
    @Query('routeType') routeTypeStr?: string,
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const routeType = routeTypeStr !== undefined ? parseInt(routeTypeStr, 10) : undefined;
    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
    const offset = offsetStr !== undefined ? parseInt(offsetStr, 10) : undefined;
    return this.routesService.findAll({ agencyKey, routeType, q, limit, offset });
  }

  @Get(':routeId')
  async findOne(@Param('routeId') routeId: string, @Query('agencyKey') agencyKey?: string) {
    if (!agencyKey) {
      throw new NotFoundException('agencyKey query param is required');
    }
    return this.routesService.findOne(routeId, agencyKey);
  }
}

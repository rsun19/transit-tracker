/// <reference types="jest" />
import type { DataSource } from 'typeorm';
import { StaticLookupService } from './static-lookup.service';

const tripRows = (...ids: string[]) =>
  ids.map((tripId) => ({ tripId, routeId: 'Red', directionId: 0 }));

describe('StaticLookupService', () => {
  let query: jest.Mock;
  let service: StaticLookupService;

  beforeEach(() => {
    query = jest.fn();
    service = new StaticLookupService({ query } as unknown as DataSource);
  });

  const answer = (trips: ReturnType<typeof tripRows>) =>
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('FROM trips') ? trips : []),
    );

  it('loads trips with their route and direction', async () => {
    answer(tripRows('T1'));
    const lookup = await service.get('mbta');
    expect(lookup?.trips.get('T1')).toEqual({ routeId: 'Red', directionId: 0 });
  });

  it('drops the cached lookup when a refresh fails, so the next get() reloads it', async () => {
    answer(tripRows('OLD'));
    await service.get('mbta');

    query.mockRejectedValue(new Error('connection reset'));
    await expect(service.refresh('mbta')).rejects.toThrow('connection reset');

    answer(tripRows('NEW'));
    const lookup = await service.get('mbta');
    expect(lookup?.trips.has('NEW')).toBe(true);
    expect(lookup?.trips.has('OLD')).toBe(false);
  });
});

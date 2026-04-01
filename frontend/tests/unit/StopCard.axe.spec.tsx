import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { StopCard } from '../../src/components/stops/StopCard';
import type { Stop } from '../../src/lib/api-client';

expect.extend(toHaveNoViolations);

const stop: Stop = {
  id: 'uuid-1',
  stopId: 'place-pktrm',
  stopName: 'Park Street',
  stopCode: '70196',
  lat: 42.3561,
  lon: -71.0622,
  wheelchairBoarding: 1,
};

const stopNoCode: Stop = {
  ...stop,
  stopCode: null,
};

const stopWithDistance: Stop = {
  ...stop,
  distanceMetres: 250,
};

const stopFarAway: Stop = {
  ...stop,
  distanceMetres: 1500,
};

const stopWithRoutes: Stop = {
  ...stop,
  routes: [
    { routeId: 'Red', shortName: 'Red', longName: 'Red Line', routeType: 1 },
    { routeId: 'Mattapan', shortName: null, longName: 'Mattapan Trolley', routeType: 0 },
    { routeId: 'unknown-id', shortName: null, longName: null, routeType: 3 },
  ],
};

describe('StopCard accessibility', () => {
  it('has no axe violations without distance', async () => {
    const { container } = render(<StopCard stop={stop} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with distance < 1000m', async () => {
    const { container } = render(<StopCard stop={stopWithDistance} onClick={() => undefined} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with distance >= 1000m (km display)', async () => {
    const { container } = render(<StopCard stop={stopFarAway} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations without stopCode', async () => {
    const { container } = render(<StopCard stop={stopNoCode} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with routes (shortName, longName fallback, routeId fallback)', async () => {
    const { container } = render(<StopCard stop={stopWithRoutes} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

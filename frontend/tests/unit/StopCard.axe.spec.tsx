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

const stopWithDistance: Stop = {
  ...stop,
  distanceMetres: 250,
};

describe('StopCard accessibility', () => {
  it('has no axe violations without distance', async () => {
    const { container } = render(<StopCard stop={stop} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with distance', async () => {
    const { container } = render(<StopCard stop={stopWithDistance} onClick={() => undefined} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

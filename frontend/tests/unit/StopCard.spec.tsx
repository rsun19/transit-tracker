import React from 'react';
import { render, screen } from '@testing-library/react';
import { StopCard } from '../../src/components/stops/StopCard';
import type { Stop } from '../../src/lib/api-client';

const base: Stop = {
  id: 'uuid-1',
  stopId: 'place-pktrm',
  stopName: 'Park Street',
  stopCode: '70196',
  lat: 42.3561,
  lon: -71.0622,
  wheelchairBoarding: 1,
};

describe('StopCard route chips', () => {
  it('shows shortName when present', () => {
    render(
      <StopCard
        stop={{
          ...base,
          routes: [{ routeId: 'Red', shortName: 'RL', longName: 'Red Line', routeType: 1 }],
        }}
      />,
    );
    expect(screen.getByText('RL')).toBeInTheDocument();
  });

  it('falls back to longName when shortName is empty string', () => {
    render(
      <StopCard
        stop={{
          ...base,
          routes: [{ routeId: 'Red', shortName: '', longName: 'Red Line', routeType: 1 }],
        }}
      />,
    );
    expect(screen.getByText('Red Line')).toBeInTheDocument();
  });

  it('falls back to longName when shortName is null', () => {
    render(
      <StopCard
        stop={{
          ...base,
          routes: [{ routeId: 'Red', shortName: null, longName: 'Red Line', routeType: 1 }],
        }}
      />,
    );
    expect(screen.getByText('Red Line')).toBeInTheDocument();
  });

  it('falls back to routeId when both shortName and longName are absent', () => {
    render(
      <StopCard
        stop={{
          ...base,
          routes: [{ routeId: 'shuttle-123', shortName: null, longName: null, routeType: 3 }],
        }}
      />,
    );
    expect(screen.getByText('shuttle-123')).toBeInTheDocument();
  });

  it('deduplicates routes with the same label', () => {
    render(
      <StopCard
        stop={{
          ...base,
          routes: [
            { routeId: 'shuttle-1', shortName: null, longName: 'Blue Line Shuttle', routeType: 3 },
            { routeId: 'shuttle-2', shortName: null, longName: 'Blue Line Shuttle', routeType: 3 },
            { routeId: 'shuttle-3', shortName: null, longName: 'Blue Line Shuttle', routeType: 3 },
          ],
        }}
      />,
    );
    const chips = screen.getAllByText('Blue Line Shuttle');
    expect(chips).toHaveLength(1);
  });

  it('keeps distinct labels when routes differ', () => {
    render(
      <StopCard
        stop={{
          ...base,
          routes: [
            { routeId: 'Red', shortName: null, longName: 'Red Line', routeType: 1 },
            { routeId: 'Blue', shortName: null, longName: 'Blue Line', routeType: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByText('Red Line')).toBeInTheDocument();
    expect(screen.getByText('Blue Line')).toBeInTheDocument();
  });

  it('renders nothing when routes array is empty', () => {
    const { container } = render(<StopCard stop={{ ...base, routes: [] }} />);
    expect(container.querySelectorAll('[class*="Chip"]')).toHaveLength(0);
  });
});

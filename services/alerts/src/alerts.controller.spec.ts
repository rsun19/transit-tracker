/// <reference types="jest" />
import { parseRouteIdsParam } from './alerts.controller';

describe('parseRouteIdsParam()', () => {
  it('splits a comma-separated value', () => {
    expect(parseRouteIdsParam('Red, 1 ,,Green-B')).toEqual(new Set(['Red', '1', 'Green-B']));
  });

  it('accepts a repeated parameter (parsed as an array)', () => {
    expect(parseRouteIdsParam(['Red', '1,Green-B'])).toEqual(new Set(['Red', '1', 'Green-B']));
  });

  it.each([undefined, '', { x: 'Red' }, ['Red', { x: '1' }]])(
    'ignores values that are not strings: %p',
    (value) => {
      const ids = parseRouteIdsParam(value);
      expect([...ids].every((id) => id === 'Red')).toBe(true);
    },
  );

  it('caps the number of route ids', () => {
    const many = Array.from({ length: 150 }, (_, i) => `r${i}`).join(',');
    expect(parseRouteIdsParam(many).size).toBe(100);
  });
});

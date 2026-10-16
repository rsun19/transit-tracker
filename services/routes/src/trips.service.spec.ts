/// <reference types="jest" />
import { ARRIVALS_LATE_WINDOW_S } from '@transit-tracker/shared';
import { parseServiceDate, pickServiceDate } from './trips.service';

describe('parseServiceDate', () => {
  it('accepts YYYYMMDD calendar dates', () => {
    expect(parseServiceDate('20261016')).toBe('2026-10-16');
    expect(parseServiceDate('20280229')).toBe('2028-02-29');
  });

  it.each(['2026-10-16', '2026101', '20261301', '20260230', '20270229', 'abcdefgh', ''])(
    'rejects %p',
    (value) => {
      expect(parseServiceDate(value)).toBeNull();
    },
  );
});

describe('pickServiceDate', () => {
  const today = '2026-10-16';
  const yesterday = '2026-10-15';
  const now = Date.parse('2026-10-16T05:00:00Z') / 1000; // 01:00 in Boston

  it("picks yesterday's run while it may still be on the road", () => {
    const runs = [
      { d: yesterday, lastStopEpoch: now - 60 },
      { d: today, lastStopEpoch: now + 20 * 3600 },
    ];
    expect(pickServiceDate(runs, today, yesterday, now)).toBe(yesterday);
  });

  it("moves to today's run once yesterday's is past the late window", () => {
    const runs = [
      { d: yesterday, lastStopEpoch: now - ARRIVALS_LATE_WINDOW_S - 1 },
      { d: today, lastStopEpoch: now + 20 * 3600 },
    ];
    expect(pickServiceDate(runs, today, yesterday, now)).toBe(today);
  });

  it('uses whichever day the trip runs on', () => {
    expect(pickServiceDate([{ d: today, lastStopEpoch: now }], today, yesterday, now)).toBe(today);
    expect(
      pickServiceDate([{ d: yesterday, lastStopEpoch: now - 86_400 }], today, yesterday, now),
    ).toBe(yesterday);
  });

  it('falls back to today when the trip runs on neither day', () => {
    expect(pickServiceDate([], today, yesterday, now)).toBe(today);
  });
});

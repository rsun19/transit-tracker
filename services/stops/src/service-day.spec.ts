/// <reference types="jest" />
import {
  activeServicesCte,
  addDays,
  candidateServiceDates,
  gtfsTimestampSql,
  localDate,
} from '@transit-tracker/shared';

const NY = 'America/New_York';

describe('addDays', () => {
  it('steps across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('candidateServiceDates', () => {
  it('uses the agency timezone, not UTC', () => {
    // 2026-10-17T02:00Z is 22:00 on Oct 16 in Boston.
    expect(candidateServiceDates(NY, new Date('2026-10-17T02:00:00Z'))).toEqual({
      today: '2026-10-16',
      yesterday: '2026-10-15',
    });
  });

  // now - 24h gives the wrong yesterday in the last hour of a 25-hour day
  // and in the first hour after a 23-hour day.
  it('derives yesterday by calendar day late on the fall-back (25 h) day', () => {
    // 23:30 EST on Nov 1; 24 h earlier is 00:30 EDT the same day.
    const now = new Date('2026-11-02T04:30:00Z');
    expect(localDate(NY, new Date(now.getTime() - 86_400_000))).toBe('2026-11-01');
    expect(candidateServiceDates(NY, now)).toEqual({
      today: '2026-11-01',
      yesterday: '2026-10-31',
    });
  });

  it('derives yesterday by calendar day just after the spring-forward (23 h) day', () => {
    // 00:30 EDT on Mar 9; 24 h earlier is 23:30 EST on Mar 7.
    const now = new Date('2026-03-09T04:30:00Z');
    expect(localDate(NY, new Date(now.getTime() - 86_400_000))).toBe('2026-03-07');
    expect(candidateServiceDates(NY, now)).toEqual({
      today: '2026-03-09',
      yesterday: '2026-03-08',
    });
  });
});

describe('gtfsTimestampSql', () => {
  it('anchors at noon minus 12 hours in the given timezone', () => {
    expect(gtfsTimestampSql('ts.d', 'st.arrival_time', '$5')).toBe(
      `(((ts.d)::date::timestamp + interval '12 hours') AT TIME ZONE ($5) - interval '12 hours' + (st.arrival_time))`,
    );
  });
});

describe('activeServicesCte', () => {
  const sql = activeServicesCte('$2', ['$3', '$4']);

  it('checks every candidate date', () => {
    expect(sql).toContain('VALUES ($3::date), ($4::date)');
  });

  it('subtracts calendar_dates removals and adds calendar_dates additions', () => {
    expect(sql).toMatch(/NOT EXISTS[\s\S]*exception_type = 2/);
    expect(sql).toMatch(/UNION[\s\S]*FROM service_calendar_dates x[\s\S]*exception_type = 1/);
  });
});

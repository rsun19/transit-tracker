/// <reference types="jest" />
import { transit_realtime } from 'gtfs-realtime-bindings';
import { readAlertEffectDetails } from './effect-detail';
import { parseAlerts } from './parse-alerts';

// Minimal protobuf encoder; the bindings can't write effect_detail (field 18).
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const lenField = (field: number, bytes: number[]) => [
  ...varint(field * 8 + 2),
  ...varint(bytes.length),
  ...bytes,
];
const strField = (field: number, s: string) => lenField(field, [...new TextEncoder().encode(s)]);
const varintField = (field: number, n: number) => [...varint(field * 8), ...varint(n)];

const translated = (...ts: [string, string?][]) =>
  ts.flatMap(([text, lang]) =>
    lenField(1, [...strField(1, text), ...(lang ? strField(2, lang) : [])]),
  );

const OTHER_EFFECT = 7;
const feedBytes = (...entities: number[][]) =>
  new Uint8Array([
    ...lenField(1, [...strField(1, '2.0'), ...varintField(3, 1_792_000_000)]),
    ...entities.flatMap((e) => lenField(2, e)),
  ]);
const alertEntity = (id: string, effectDetail: number[] | null) => [
  ...strField(1, id),
  ...lenField(5, [
    ...lenField(10, translated(['Route 31 is experiencing delays', 'en'])),
    ...varintField(7, OTHER_EFFECT),
    ...varintField(14, 3), // severity_level WARNING
    ...(effectDetail ? lenField(18, effectDetail) : []),
    ...lenField(17, translated(['TRAFFIC', 'en'])), // cause_detail, ignored
  ]),
];

describe('readAlertEffectDetails()', () => {
  it('reads effect_detail by entity id, preferring English', () => {
    const raw = feedBytes(
      alertEntity('A1', translated(['RETARDO', 'es'], ['DELAY', 'en'])),
      alertEntity('A2', translated(['ELEVATOR_CLOSURE'])),
      alertEntity('A3', null),
    );
    expect(readAlertEffectDetails(raw)).toEqual(
      new Map([
        ['A1', 'DELAY'],
        ['A2', 'ELEVATOR_CLOSURE'],
      ]),
    );
  });

  it('returns an empty map for bytes it cannot walk', () => {
    expect(readAlertEffectDetails(new Uint8Array([0x12, 0xff, 0xff]))).toEqual(new Map());
  });

  it.each([
    ['64-bit', 1, 8],
    ['32-bit', 5, 4],
  ])('returns an empty map when a %s field is truncated', (_label, wireType, width) => {
    // A complete entity, then a fixed-width field (number 9) cut one byte short.
    const raw = feedBytes(alertEntity('A1', translated(['DELAY', 'en'])));
    const truncated = new Uint8Array([
      ...raw,
      ...varint(9 * 8 + wireType),
      ...new Array(width - 1).fill(0),
    ]);
    expect(readAlertEffectDetails(truncated)).toEqual(new Map());
  });

  it('returns an empty map when a fixed-width field overruns its sub-message', () => {
    // Inside the alert, a 64-bit field (number 9) whose 8 bytes extend past
    // the alert's declared length: the outer reader would hide this.
    const alert = [...varintField(7, OTHER_EFFECT), ...varint(9 * 8 + 1), 0, 0, 0];
    const entity = [...strField(1, 'A1'), ...lenField(5, alert)];
    const raw = feedBytes(entity, alertEntity('A2', translated(['DELAY', 'en'])));
    expect(readAlertEffectDetails(raw)).toEqual(new Map());
  });

  it('feeds parseAlerts, which the bindings alone would leave without the detail', () => {
    const raw = feedBytes(alertEntity('A1', translated(['DELAY', 'en'])));
    const feed = transit_realtime.FeedMessage.decode(raw);
    const [alert] = parseAlerts(feed, null, readAlertEffectDetails(raw));
    expect(alert).toMatchObject({
      alertId: 'A1',
      effect: 'OTHER_EFFECT',
      effectDetail: 'DELAY',
      severityLevel: 'WARNING',
    });
    expect(parseAlerts(feed, null)[0].effectDetail).toBeNull();
  });
});

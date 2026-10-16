// gtfs-realtime-bindings (1.1.1) predates Alert.cause_detail / effect_detail
// (fields 17 / 18), and protobufjs drops fields it doesn't know. MBTA files
// e.g. every delay alert as effect OTHER_EFFECT with effect_detail "DELAY",
// so this reads effect_detail straight from the wire format.
//
// Wire path: FeedMessage.entity (2) -> FeedEntity.id (1) / .alert (5)
//   -> Alert.effect_detail (18): TranslatedString.translation (1)
//   -> Translation.text (1), .language (2)

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LEN = 2;
const WIRE_32BIT = 5;

class WireReader {
  pos: number;

  constructor(
    private readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error('truncated varint');
      const byte = this.buf[this.pos++];
      // Field numbers and lengths fit in 32 bits; larger varints are skipped, not used.
      if (shift < 32) result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  /** Returns a reader over the next length-delimited field and moves past it. */
  sub(): WireReader {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error('truncated field');
    return new WireReader(this.buf, start, start + len);
  }

  string(): string {
    const r = this.sub();
    return new TextDecoder().decode(this.buf.subarray(r.pos, r.end));
  }

  skip(wireType: number): void {
    if (wireType === WIRE_VARINT) this.varint();
    else if (wireType === WIRE_64BIT) this.pos += 8;
    else if (wireType === WIRE_LEN) this.sub();
    else if (wireType === WIRE_32BIT) this.pos += 4;
    else throw new Error(`unsupported wire type ${wireType}`);
  }

  /** Iterates fields as [fieldNumber, wireType]; the caller must consume or skip each one. */
  *fields(): Generator<[number, number]> {
    while (!this.done) {
      const tag = this.varint();
      yield [Math.floor(tag / 8), tag & 7];
    }
  }
}

/** English text of a TranslatedString: "en", then "en-*", then untagged. */
function englishTranslation(r: WireReader): string | null {
  const translations: { text: string; language: string | null }[] = [];
  for (const [field, wire] of r.fields()) {
    if (field !== 1 || wire !== WIRE_LEN) {
      r.skip(wire);
      continue;
    }
    const t = r.sub();
    let text = '';
    let language: string | null = null;
    for (const [f, w] of t.fields()) {
      if (f === 1 && w === WIRE_LEN) text = t.string();
      else if (f === 2 && w === WIRE_LEN) language = t.string().toLowerCase() || null;
      else t.skip(w);
    }
    translations.push({ text, language });
  }
  const pick =
    translations.find((t) => t.language === 'en') ??
    translations.find((t) => t.language?.startsWith('en-')) ??
    translations.find((t) => t.language === null);
  return pick?.text || null;
}

/**
 * Reads Alert.effect_detail for every alert entity, keyed by entity id.
 * Returns an empty map (never throws) if the bytes can't be walked, so a
 * malformed feed only loses the detail, not the alerts.
 */
export function readAlertEffectDetails(raw: Uint8Array): Map<string, string> {
  const details = new Map<string, string>();
  try {
    const feed = new WireReader(raw);
    for (const [field, wire] of feed.fields()) {
      if (field !== 2 || wire !== WIRE_LEN) {
        feed.skip(wire);
        continue;
      }
      const entity = feed.sub();
      let id: string | null = null;
      let detail: string | null = null;
      for (const [f, w] of entity.fields()) {
        if (f === 1 && w === WIRE_LEN) {
          id = entity.string();
        } else if (f === 5 && w === WIRE_LEN) {
          const alert = entity.sub();
          for (const [af, aw] of alert.fields()) {
            if (af === 18 && aw === WIRE_LEN) detail = englishTranslation(alert.sub());
            else alert.skip(aw);
          }
        } else {
          entity.skip(w);
        }
      }
      if (id !== null && detail) details.set(id, detail);
    }
  } catch {
    return new Map();
  }
  return details;
}

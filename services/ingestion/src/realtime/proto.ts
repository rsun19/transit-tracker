// protobufjs puts proto2 defaults on the message prototype, so an absent
// optional field still reads as 0 / "" / false. Use `has` to tell "absent"
// apart from "present with the default value".
export function has<T extends object>(msg: T | null | undefined, field: keyof T): boolean {
  return msg != null && Object.prototype.hasOwnProperty.call(msg, field);
}

type LongLike = { toNumber(): number };

/** Converts a protobuf int64 (number or Long) to a JS number. */
export function toNumber(value: number | LongLike | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toNumber === 'function') return value.toNumber();
  return Number(value);
}

/** Reads an optional int64 field as epoch seconds; absent or 0 becomes null. */
export function optionalEpoch<T extends object>(
  msg: T | null | undefined,
  field: keyof T,
): number | null {
  if (!has(msg, field)) return null;
  const n = toNumber(msg![field] as unknown as number | LongLike);
  return n != null && n > 0 ? n : null;
}

/** Reads an optional int32 field; absent becomes null (0 is kept). */
export function optionalInt<T extends object>(
  msg: T | null | undefined,
  field: keyof T,
): number | null {
  if (!has(msg, field)) return null;
  return toNumber(msg![field] as unknown as number | LongLike);
}

/** Reads an optional string field; absent or empty becomes null. */
export function optionalString<T extends object>(
  msg: T | null | undefined,
  field: keyof T,
): string | null {
  if (!has(msg, field)) return null;
  const value = msg![field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

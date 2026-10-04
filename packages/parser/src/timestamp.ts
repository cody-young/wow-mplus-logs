/**
 * Combat log timestamps.
 *
 * Two shapes are in circulation and a parser that must survive patch day
 * should read both:
 *   "9/30 18:50:23.123"          legacy, no year, no zone
 *   "9/30/2026 18:50:23.123-4"   current, year plus UTC offset in hours
 *
 * The event name begins after a two-space separator.
 *
 * Reading is done in place through a reusable instance rather than returning
 * an object, because this runs once per line and a per-line allocation at a
 * million lines is a measurable GC cost.
 */

const CH_SPACE = 32;
const CH_SLASH = 47;
const CH_COLON = 58;
const CH_DOT = 46;
const CH_MINUS = 45;
const CH_PLUS = 43;
const CH_0 = 48;
const CH_9 = 57;

/** Days from 1970-01-01 to the given civil date. Hinnant's algorithm. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export interface TimestampReaderOptions {
  /**
   * Year to assume for legacy lines that omit one. Callers should pass the
   * log file's mtime year; without it, month rollover still works but the
   * absolute date is meaningless.
   */
  assumedYear?: number;
}

export class TimestampReader {
  /** Wall-clock milliseconds since the Unix epoch, ignoring the zone offset. */
  ms = 0;
  /** Zone offset in minutes as written, or 0 when the line omits one. */
  tzOffsetMinutes = 0;
  /** Index of the first character of the event name, past the "  " separator. */
  bodyStart = -1;
  /** True when the line carried an explicit year. */
  hasYear = false;

  private assumedYear: number;
  private lastMonth = 0;
  private yearDrift = 0;

  constructor(options: TimestampReaderOptions = {}) {
    this.assumedYear = options.assumedYear ?? new Date().getUTCFullYear();
  }

  /** Resets rollover tracking. Call when starting a different file. */
  reset(): void {
    this.lastMonth = 0;
    this.yearDrift = 0;
    this.bodyStart = -1;
  }

  /**
   * Parses the leading timestamp of `line`, filling this reader's fields.
   * Returns false without mutating `ms` if the line is not an event line
   * (blank, truncated, or a bare header).
   */
  read(line: string): boolean {
    const len = line.length;
    let i = 0;

    const month = this.digits(line, i, len);
    if (month < 0 || this.cursor >= len || line.charCodeAt(this.cursor) !== CH_SLASH) return false;
    i = this.cursor + 1;

    const day = this.digits(line, i, len);
    if (day < 0) return false;
    i = this.cursor;

    let year = 0;
    let hasYear = false;
    if (i < len && line.charCodeAt(i) === CH_SLASH) {
      const parsed = this.digits(line, i + 1, len);
      if (parsed < 0) return false;
      year = parsed;
      hasYear = true;
      i = this.cursor;
    }

    if (i >= len || line.charCodeAt(i) !== CH_SPACE) return false;
    i++;

    const hour = this.digits(line, i, len);
    if (hour < 0 || this.cursor >= len || line.charCodeAt(this.cursor) !== CH_COLON) return false;
    const minute = this.digits(line, this.cursor + 1, len);
    if (minute < 0 || this.cursor >= len || line.charCodeAt(this.cursor) !== CH_COLON) return false;
    const second = this.digits(line, this.cursor + 1, len);
    if (second < 0) return false;
    i = this.cursor;

    let millis = 0;
    if (i < len && line.charCodeAt(i) === CH_DOT) {
      const start = i + 1;
      const parsed = this.digits(line, start, len);
      if (parsed < 0) return false;
      // Scale by written precision: ".1" is 100ms, ".123" is 123ms.
      const width = this.cursor - start;
      millis = width === 3 ? parsed : width === 2 ? parsed * 10 : width === 1 ? parsed * 100 : parsed;
      i = this.cursor;
    }

    let tzMinutes = 0;
    if (i < len) {
      const sign = line.charCodeAt(i);
      if (sign === CH_MINUS || sign === CH_PLUS) {
        const parsed = this.digits(line, i + 1, len);
        if (parsed >= 0) {
          const width = this.cursor - (i + 1);
          // One or two digits is whole hours; three or four is hhmm.
          const magnitude = width <= 2 ? parsed * 60 : Math.trunc(parsed / 100) * 60 + (parsed % 100);
          tzMinutes = sign === CH_MINUS ? -magnitude : magnitude;
          i = this.cursor;
        }
      }
    }

    // Skip to the event name. The separator is conventionally two spaces, but
    // accept any run of whitespace rather than reject an otherwise good line.
    while (i < len && line.charCodeAt(i) === CH_SPACE) i++;
    if (i >= len) return false;

    if (!hasYear) {
      // Legacy lines wrap at new year; a month that moves backwards means
      // we crossed into January.
      if (this.lastMonth !== 0 && month < this.lastMonth) this.yearDrift++;
      year = this.assumedYear + this.yearDrift;
    }
    this.lastMonth = month;

    const days = daysFromCivil(year, month, day);
    this.ms = days * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1000 + millis;
    this.tzOffsetMinutes = tzMinutes;
    this.hasYear = hasYear;
    this.bodyStart = i;
    return true;
  }

  /** End offset of the most recent `digits` call. */
  private cursor = 0;

  /** Reads an unsigned run of digits, leaving the end offset in `cursor`. */
  private digits(line: string, start: number, end: number): number {
    let i = start;
    let value = 0;
    while (i < end) {
      const c = line.charCodeAt(i);
      if (c < CH_0 || c > CH_9) break;
      value = value * 10 + (c - CH_0);
      i++;
    }
    this.cursor = i;
    return i === start ? -1 : value;
  }
}

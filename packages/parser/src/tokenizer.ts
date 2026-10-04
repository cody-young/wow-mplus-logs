/**
 * Field splitting for combat log lines.
 *
 * Lines are comma separated, but three constructs legally contain commas:
 *   "Quoted-Name"        quoted strings (pet names can contain anything)
 *   [1,2,3]              arrays (COMBATANT_INFO talents, auras, equipment)
 *   (12345,678)          tuples nested inside those arrays
 *
 * The splitter records [start,end) offsets into a caller-owned Int32Array
 * rather than allocating substrings, so the hot events (damage, heal, aura)
 * only materialize the few fields they actually read. At ~1M events per
 * long key, that difference is the whole performance budget.
 */

/** Offsets buffer capacity, in fields. COMBATANT_INFO is the widest line. */
export const MAX_FIELDS = 320;

const CH_QUOTE = 34; // "
const CH_COMMA = 44; // ,
const CH_LPAREN = 40; // (
const CH_RPAREN = 41; // )
const CH_LBRACKET = 91; // [
const CH_RBRACKET = 93; // ]
const CH_MINUS = 45; // -
const CH_PLUS = 43; // +
const CH_DOT = 46; // .
const CH_0 = 48;
const CH_9 = 57;

/**
 * Splits `line` from `from` into comma-delimited fields.
 * Writes 2 entries per field into `out` ([start, end) pairs) and returns
 * the field count. Fields beyond `out`'s capacity are dropped rather than
 * throwing: a malformed line should cost one event, not the whole run.
 */
export function splitFields(line: string, from: number, out: Int32Array): number {
  const capacity = out.length >> 1;
  const len = line.length;
  let count = 0;
  let depth = 0;
  let inQuote = false;
  let fieldStart = from;

  for (let i = from; i < len; i++) {
    const c = line.charCodeAt(i);
    if (inQuote) {
      if (c === CH_QUOTE) inQuote = false;
      continue;
    }
    if (c === CH_QUOTE) {
      inQuote = true;
    } else if (c === CH_LBRACKET || c === CH_LPAREN) {
      depth++;
    } else if (c === CH_RBRACKET || c === CH_RPAREN) {
      if (depth > 0) depth--;
    } else if (c === CH_COMMA && depth === 0) {
      if (count >= capacity) return count;
      out[count << 1] = fieldStart;
      out[(count << 1) | 1] = i;
      count++;
      fieldStart = i + 1;
    }
  }

  if (count < capacity) {
    out[count << 1] = fieldStart;
    out[(count << 1) | 1] = len;
    count++;
  }
  return count;
}

/** Raw field text, with one layer of surrounding double quotes removed. */
export function fieldStr(line: string, out: Int32Array, index: number): string {
  let s = out[index << 1]!;
  let e = out[(index << 1) | 1]!;
  if (e > s && line.charCodeAt(s) === CH_QUOTE && line.charCodeAt(e - 1) === CH_QUOTE) {
    s++;
    e--;
  }
  return line.slice(s, e);
}

/** Field text with quotes left intact — for arrays and tuples passed through verbatim. */
export function fieldRaw(line: string, out: Int32Array, index: number): string {
  return line.slice(out[index << 1]!, out[(index << 1) | 1]!);
}

/**
 * Integer field, parsed in place. Understands a leading sign and tolerates a
 * fractional part by truncating it. Returns `fallback` for "nil" and for
 * anything non-numeric, which is how the log spells "no value".
 */
export function fieldInt(line: string, out: Int32Array, index: number, fallback = 0): number {
  const start = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  return parseIntAt(line, start, end, fallback);
}

export function parseIntAt(line: string, start: number, end: number, fallback = 0): number {
  let i = start;
  let negative = false;
  if (i < end) {
    const sign = line.charCodeAt(i);
    if (sign === CH_MINUS) {
      negative = true;
      i++;
    } else if (sign === CH_PLUS) {
      i++;
    }
  }
  let value = 0;
  let digits = 0;
  for (; i < end; i++) {
    const c = line.charCodeAt(i);
    if (c < CH_0 || c > CH_9) break;
    value = value * 10 + (c - CH_0);
    digits++;
  }
  if (digits === 0) return fallback;
  return negative ? -value : value;
}

/** Float field (positions, facing, percentages). */
export function fieldFloat(line: string, out: Int32Array, index: number, fallback = 0): number {
  const start = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  let i = start;
  let negative = false;
  if (i < end) {
    const sign = line.charCodeAt(i);
    if (sign === CH_MINUS) {
      negative = true;
      i++;
    } else if (sign === CH_PLUS) {
      i++;
    }
  }
  let value = 0;
  let digits = 0;
  for (; i < end; i++) {
    const c = line.charCodeAt(i);
    if (c < CH_0 || c > CH_9) break;
    value = value * 10 + (c - CH_0);
    digits++;
  }
  if (i < end && line.charCodeAt(i) === CH_DOT) {
    i++;
    let scale = 0.1;
    for (; i < end; i++) {
      const c = line.charCodeAt(i);
      if (c < CH_0 || c > CH_9) break;
      value += (c - CH_0) * scale;
      scale *= 0.1;
      digits++;
    }
  }
  if (digits === 0) return fallback;
  return negative ? -value : value;
}

/**
 * Unit/raid flag field, written as hex ("0x512"). Also accepts plain decimal
 * and "nil", both of which appear in the wild on synthetic sources.
 */
export function fieldHex(line: string, out: Int32Array, index: number): number {
  let i = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  if (end - i > 2 && line.charCodeAt(i) === CH_0) {
    const x = line.charCodeAt(i + 1);
    if (x === 120 || x === 88) {
      i += 2;
      let value = 0;
      for (; i < end; i++) {
        const c = line.charCodeAt(i);
        let digit: number;
        if (c >= CH_0 && c <= CH_9) digit = c - CH_0;
        else if (c >= 97 && c <= 102) digit = c - 87; // a-f
        else if (c >= 65 && c <= 70) digit = c - 55; // A-F
        else break;
        value = value * 16 + digit;
      }
      return value;
    }
  }
  return parseIntAt(line, i, end, 0);
}

/** Boolean field. The log writes "nil" for false and "1" for true. */
export function fieldBool(line: string, out: Int32Array, index: number): boolean {
  const start = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  if (end - start === 1) return line.charCodeAt(start) === 49; // "1"
  if (end - start === 3 && line.charCodeAt(start) === 110) return false; // "nil"
  if (end - start === 4 && line.charCodeAt(start) === 116) return true; // "true"
  return end > start && line.charCodeAt(start) !== 48; // nonzero
}

/** True when the field is literally "nil". */
export function fieldIsNil(line: string, out: Int32Array, index: number): boolean {
  const start = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  return end - start === 3 && line.startsWith('nil', start);
}

/**
 * True when the field contains a decimal point. Used to find the advanced
 * block's position fields, which are the only fractional values in it.
 */
export function fieldHasDot(line: string, out: Int32Array, index: number): boolean {
  const start = out[index << 1]!;
  const end = out[(index << 1) | 1]!;
  for (let i = start; i < end; i++) {
    if (line.charCodeAt(i) === CH_DOT) return true;
  }
  return false;
}

/** True when the field opens a bracketed array. */
export function fieldIsArray(line: string, out: Int32Array, index: number): boolean {
  const start = out[index << 1]!;
  return start < out[(index << 1) | 1]! && line.charCodeAt(start) === CH_LBRACKET;
}

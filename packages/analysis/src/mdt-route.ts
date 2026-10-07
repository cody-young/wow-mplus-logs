import type { MdtPlacement } from './mdt.js';
import type { Segment } from './segments.js';

/**
 * A run's pulls as a Mythic Dungeon Tools route, to paste into MDT's import.
 *
 * Each pull of the run that placed any kills on MDT's spawns becomes one MDT
 * pull, in the order they were fought, holding the spawns those kills were
 * matched to. Kills that were not matched (on a floor that did not fit, or
 * dragged too far to say which spawn they were) are left out, so the route is
 * what the map could place, not necessarily all of what was killed.
 *
 * MDT 6.2 reads only its `!~MDT2~` format: the preset table as CBOR, raw
 * deflate, then base64, which is what `C_EncodingUtil` does on its side.
 */

/** What MDT's import checks for and needs to draw the route. */
export interface MdtRoute {
  text: string;
  uid: string;
  difficulty: number;
  value: {
    currentDungeonIdx: number;
    currentSublevel: number;
    currentPull: number;
    selection: number[];
    /** Each pull: MDT enemy index to clone indices, plus `color`. */
    pulls: Array<Map<number | 'color', number[] | string>>;
  };
  objects: never[];
  colorPaletteInfo: { autoColoring: boolean; colorPaletteIdx: number };
}

const PREFIX = '!~MDT2~';
const UID_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()';

/**
 * MDT's rainbow palette (its palette 1), as hex. MDT recolours pulls from the
 * preset's palette when it loads them; a colour of its own is still needed,
 * since a pull without one breaks MDT before that happens.
 */
const RAINBOW = [
  [0.2446, 1, 0.2446],
  [0.2446, 1, 0.6223],
  [0.2446, 1, 1],
  [0.2446, 0.6223, 1],
  [0.2446, 0.2446, 1],
  [0.6223, 0.6223, 1],
  [1, 0.2446, 1],
  [1, 0.2446, 0.6223],
  [1, 0.2446, 0.2446],
  [1, 0.60971, 0.2446],
  [1, 0.98741, 0.2446],
  [0.63489, 1, 0.2446],
].map((rgb) => rgb.map((c) => Math.floor(c * 255).toString(16).padStart(2, '0')).join(''));

/**
 * The route, or null when no kill was placed on MDT's map.
 *
 * `uid` is MDT's route id: importing a route whose id MDT already has offers
 * to overwrite it, so one from `routeUid` of the run makes a second export of
 * the same key replace the first.
 */
export function mdtRoute(
  placement: MdtPlacement,
  segments: readonly Segment[],
  text: string,
  keystoneLevel: number,
  uid: string,
): MdtRoute | null {
  const bySegment = new Map<number, number>();
  for (const segment of segments) for (const actor of segment.enemies) bySegment.set(actor, segment.id);
  const sublevelOf = new Map<string, number>();
  for (const enemy of placement.dungeon.enemies) {
    for (const clone of enemy.clones) sublevelOf.set(`${enemy.index}:${clone.index}`, clone.sublevel);
  }

  const matchesBySegment = new Map<number, typeof placement.matches>();
  for (const match of placement.matches) {
    const segment = bySegment.get(match.actor);
    if (segment === undefined) continue;
    const list = matchesBySegment.get(segment);
    if (list === undefined) matchesBySegment.set(segment, [match]);
    else list.push(match);
  }

  const pulls: MdtRoute['value']['pulls'] = [];
  let firstSublevel = 1;
  for (const segment of [...segments].sort((a, b) => a.startTs - b.startTs)) {
    const matches = matchesBySegment.get(segment.id);
    if (matches === undefined) continue;
    const pull = new Map<number | 'color', number[] | string>();
    for (const match of [...matches].sort((a, b) => a.enemyIndex - b.enemyIndex || a.cloneIndex - b.cloneIndex)) {
      const clones = pull.get(match.enemyIndex) as number[] | undefined;
      if (clones === undefined) pull.set(match.enemyIndex, [match.cloneIndex]);
      else clones.push(match.cloneIndex);
    }
    pull.set('color', RAINBOW[pulls.length % RAINBOW.length]!);
    if (pulls.length === 0) {
      const first = matches[0]!;
      firstSublevel = sublevelOf.get(`${first.enemyIndex}:${first.cloneIndex}`) ?? 1;
    }
    pulls.push(pull);
  }
  if (pulls.length === 0) return null;

  return {
    text,
    uid,
    difficulty: keystoneLevel,
    value: {
      currentDungeonIdx: placement.dungeon.dungeonIndex,
      currentSublevel: firstSublevel,
      currentPull: 1,
      selection: [1],
      pulls,
    },
    objects: [],
    colorPaletteInfo: { autoColoring: true, colorPaletteIdx: 1 },
  };
}

/** An id in MDT's alphabet, 11 characters as MDT makes them, the same for the same seed. */
export function routeUid(seed: string): string {
  // FNV-1a over the seed, then mixed once per character out.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  let out = '';
  for (let i = 0; i < 11; i++) {
    hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
    out += UID_CHARACTERS[hash % UID_CHARACTERS.length];
  }
  return out;
}

/** The route as MDT's import string. */
export async function mdtExportString(route: MdtRoute): Promise<string> {
  const compressed = await deflateRaw(encodeCbor(route));
  let binary = '';
  for (let i = 0; i < compressed.length; i += 0x8000) {
    binary += String.fromCharCode(...compressed.subarray(i, i + 0x8000));
  }
  return PREFIX + btoa(binary);
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * CBOR (RFC 8949) for the values a route holds: integers, strings, booleans,
 * arrays, plain objects, and Maps for tables keyed by number. Lua reads a CBOR
 * array as a table indexed from 1 and a map as a table with those keys.
 */
export function encodeCbor(value: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number): void => {
    const m = major << 5;
    if (n < 24) out.push(m | n);
    else if (n < 0x100) out.push(m | 24, n);
    else if (n < 0x10000) out.push(m | 25, n >> 8, n & 0xff);
    else out.push(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  };
  const write = (v: unknown): void => {
    if (typeof v === 'number') {
      if (!Number.isInteger(v) || Math.abs(v) > 0xffffffff) throw new Error(`CBOR: unsupported number ${v}`);
      if (v >= 0) head(0, v);
      else head(1, -1 - v);
    } else if (typeof v === 'string') {
      const bytes = new TextEncoder().encode(v);
      head(3, bytes.length);
      for (const b of bytes) out.push(b);
    } else if (typeof v === 'boolean') {
      out.push(v ? 0xf5 : 0xf4);
    } else if (Array.isArray(v)) {
      head(4, v.length);
      for (const item of v) write(item);
    } else if (v instanceof Map) {
      head(5, v.size);
      for (const [key, item] of v) {
        write(key);
        write(item);
      }
    } else if (typeof v === 'object' && v !== null) {
      const entries = Object.entries(v).filter(([, item]) => item !== undefined);
      head(5, entries.length);
      for (const [key, item] of entries) {
        write(key);
        write(item);
      }
    } else {
      throw new Error(`CBOR: unsupported value ${String(v)}`);
    }
  };
  write(value);
  return Uint8Array.from(out);
}

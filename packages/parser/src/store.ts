/**
 * Columnar event store.
 *
 * One object per event would be roughly 300 bytes and would put a million
 * short-lived objects through the GC for a single long key. Struct-of-arrays
 * gets the same data into ~60 bytes per event, lets analysis scan a run in a
 * tight allocation-free loop, and — because the columns are already typed
 * arrays — doubles as the wire format for sharing a run later.
 *
 * Writers call `reserve()` for an index and assign into the columns directly,
 * rather than passing fourteen arguments to a push method.
 */

const DEFAULT_CAPACITY = 1 << 14;

export class EventStore {
  /** Number of events written. Columns are valid in [0, count). */
  count = 0;
  capacity: number;

  /** Milliseconds relative to `baseMs`. Int32 covers ~24 days of log. */
  ts: Int32Array;
  /** Event code from the Ev enum. */
  code: Uint8Array;
  /**
    * EvFlag bitfield.
    *
    * Sixteen bits rather than eight: the eighth was the last one a byte had,
    * and BUFF needed a ninth. One extra byte on an event that already costs
    * ~54 is a better trade than overloading a damage flag to mean something
    * else on aura rows, which is the kind of saving that reads as a bug later.
    */
  flags: Uint16Array;
  /** Actor row indices; -1 when absent. */
  srcActor: Int32Array;
  dstActor: Int32Array;
  /** Prefix spell id, 0 for swings. */
  spellId: Int32Array;
  /** Suffix spell id: the interrupted/dispelled/absorbed spell. */
  extraSpellId: Int32Array;
  /** Damage, heal or energize amount. */
  amount: Float64Array;
  /** Overkill for damage, overhealing for heals; -1 when not applicable. */
  waste: Int32Array;
  absorbed: Int32Array;
  /** Destination health at the time of the event, from advanced logging. */
  hpCurrent: Int32Array;
  hpMax: Int32Array;
  /**
   * World position of the advanced block's subject: the destination, or the
   * source when the row carries EvFlag.INFO_IS_SOURCE. 0,0 without a block.
   */
  posX: Float32Array;
  posY: Float32Array;
  /**
   * The uiMap that position is on, 0 without a block.
   *
   * Positions are only comparable within one uiMap: a dungeon with floors is
   * several maps, each with its own coordinate frame on the minimap. Sixteen
   * bits is ample — retail uiMapIDs are in the low thousands.
   */
  uiMapId: Uint16Array;

  /**
   * Augmentation Evoker attribution: row -> actor index of the supporter.
   *
   * Sparse rather than a column, because _SUPPORT events are well under 1% of
   * a run and a dense Int32 column would cost 4 bytes on every other event to
   * carry it. The map serializes as two parallel arrays.
   */
  readonly support = new Map<number, number>();

  /**
   * Row -> actor index of the third party an event names, which today means the
   * caster of the shield on a SPELL_ABSORBED. Sparse for the same reason as
   * `support`: absorbs are a few percent of a run and nothing else needs the
   * column, so a dense Int32 would be four bytes wasted on every other event.
   */
  readonly extraActor = new Map<number, number>();

  /** Wall-clock ms of ts=0. */
  baseMs = 0;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.ts = new Int32Array(capacity);
    this.code = new Uint8Array(capacity);
    this.flags = new Uint16Array(capacity);
    this.srcActor = new Int32Array(capacity);
    this.dstActor = new Int32Array(capacity);
    this.spellId = new Int32Array(capacity);
    this.extraSpellId = new Int32Array(capacity);
    this.amount = new Float64Array(capacity);
    this.waste = new Int32Array(capacity);
    this.absorbed = new Int32Array(capacity);
    this.hpCurrent = new Int32Array(capacity);
    this.hpMax = new Int32Array(capacity);
    this.posX = new Float32Array(capacity);
    this.posY = new Float32Array(capacity);
    this.uiMapId = new Uint16Array(capacity);
  }

  /**
   * Claims the next row, growing the columns if needed, and returns its index.
   * The row's columns hold stale data from before the last grow, so writers
   * must set every field they care about — see `clear`.
   */
  reserve(): number {
    if (this.count === this.capacity) this.grow(this.capacity * 2);
    return this.count++;
  }

  /** Zeroes a reserved row and sets the "absent" sentinels. */
  clear(index: number): void {
    this.code[index] = 0;
    this.flags[index] = 0;
    this.srcActor[index] = -1;
    this.dstActor[index] = -1;
    this.spellId[index] = 0;
    this.extraSpellId[index] = 0;
    this.amount[index] = 0;
    this.waste[index] = 0;
    this.absorbed[index] = 0;
    this.hpCurrent[index] = -1;
    this.hpMax[index] = -1;
    this.posX[index] = 0;
    this.posY[index] = 0;
    this.uiMapId[index] = 0;
  }

  private grow(target: number): void {
    const next = Math.max(target, DEFAULT_CAPACITY);
    this.ts = growI32(this.ts, next);
    this.code = growU8(this.code, next);
    this.flags = growU16(this.flags, next);
    this.srcActor = growI32(this.srcActor, next);
    this.dstActor = growI32(this.dstActor, next);
    this.spellId = growI32(this.spellId, next);
    this.extraSpellId = growI32(this.extraSpellId, next);
    this.amount = growF64(this.amount, next);
    this.waste = growI32(this.waste, next);
    this.absorbed = growI32(this.absorbed, next);
    this.hpCurrent = growI32(this.hpCurrent, next);
    this.hpMax = growI32(this.hpMax, next);
    this.posX = growF32(this.posX, next);
    this.posY = growF32(this.posY, next);
    this.uiMapId = growU16(this.uiMapId, next);
    this.capacity = next;
  }

  /**
   * Trims columns to `count`, releasing the slack left by doubling. Call once
   * a run is complete; a live-tailing run should stay untrimmed.
   */
  compact(): void {
    if (this.capacity === this.count) return;
    const n = this.count;
    this.ts = this.ts.slice(0, n);
    this.code = this.code.slice(0, n);
    this.flags = this.flags.slice(0, n);
    this.srcActor = this.srcActor.slice(0, n);
    this.dstActor = this.dstActor.slice(0, n);
    this.spellId = this.spellId.slice(0, n);
    this.extraSpellId = this.extraSpellId.slice(0, n);
    this.amount = this.amount.slice(0, n);
    this.waste = this.waste.slice(0, n);
    this.absorbed = this.absorbed.slice(0, n);
    this.hpCurrent = this.hpCurrent.slice(0, n);
    this.hpMax = this.hpMax.slice(0, n);
    this.posX = this.posX.slice(0, n);
    this.posY = this.posY.slice(0, n);
    this.uiMapId = this.uiMapId.slice(0, n);
    this.capacity = n;
  }

  /** Approximate heap cost in bytes, for the UI's memory readout. */
  byteLength(): number {
    return (
      this.ts.byteLength +
      this.code.byteLength +
      this.flags.byteLength +
      this.srcActor.byteLength +
      this.dstActor.byteLength +
      this.spellId.byteLength +
      this.extraSpellId.byteLength +
      this.amount.byteLength +
      this.waste.byteLength +
      this.absorbed.byteLength +
      this.hpCurrent.byteLength +
      this.hpMax.byteLength +
      this.posX.byteLength +
      this.posY.byteLength +
      this.uiMapId.byteLength +
      this.support.size * 8
    );
  }

  /**
   * Index of the first event at or after `tsValue`. The ts column is
   * monotonically non-decreasing, so analysis windows (a death's ten-second
   * lookback, an affix window) resolve by binary search.
   */
  seek(tsValue: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ts[mid]! < tsValue) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

function growI32(source: Int32Array, capacity: number): Int32Array {
  const next = new Int32Array(capacity);
  next.set(source);
  return next;
}
function growU16(source: Uint16Array, capacity: number): Uint16Array {
  const next = new Uint16Array(capacity);
  next.set(source);
  return next;
}
function growU8(source: Uint8Array, capacity: number): Uint8Array {
  const next = new Uint8Array(capacity);
  next.set(source);
  return next;
}
function growF64(source: Float64Array, capacity: number): Float64Array {
  const next = new Float64Array(capacity);
  next.set(source);
  return next;
}
function growF32(source: Float32Array, capacity: number): Float32Array {
  const next = new Float32Array(capacity);
  next.set(source);
  return next;
}

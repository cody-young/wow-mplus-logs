/**
 * String interning.
 *
 * GUIDs, unit names and spell names repeat tens of thousands of times in a
 * single run. Interning them to Int32 ids is what lets the event store be
 * numeric typed arrays, and it makes equality a integer compare instead of a
 * string compare in every analysis loop.
 */
export class StringInterner {
  private readonly ids = new Map<string, number>();
  private readonly values: string[] = [];

  /** Interns `value`, returning its stable id. Id 0 is always the empty string. */
  intern(value: string): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.values.push(value);
    this.ids.set(value, id);
    return id;
  }

  /** Id for `value` if already interned, else -1. Does not allocate an id. */
  lookup(value: string): number {
    return this.ids.get(value) ?? -1;
  }

  resolve(id: number): string {
    return this.values[id] ?? '';
  }

  get size(): number {
    return this.values.length;
  }

  /** Snapshot of the id->string table, index-aligned. Cheap to serialize. */
  table(): readonly string[] {
    return this.values;
  }

  static fromTable(values: readonly string[]): StringInterner {
    const interner = new StringInterner();
    for (const value of values) interner.intern(value);
    return interner;
  }
}

export function createInterner(): StringInterner {
  const interner = new StringInterner();
  interner.intern(''); // reserve id 0 as "absent"
  return interner;
}

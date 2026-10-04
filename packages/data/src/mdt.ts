/**
 * Reading enemy forces out of Mythic Dungeon Tools' data files.
 *
 * MDT ships one Lua file per dungeon, machine-generated, in the shape
 *
 *   local dungeonIndex = 164
 *   MDT.mapInfo[dungeonIndex] = { englishName = "Altar of Fangs", mapID = 588,
 *                                 teleportId = 1286812 }
 *   MDT.dungeonTotalCount[dungeonIndex] = { normal = 817 }
 *   MDT.dungeonEnemies[dungeonIndex] = {
 *     [1] = { ["name"] = "...", ["id"] = 270306, ["count"] = 25, ["clones"] = {...} },
 *   }
 *
 * `mapID` is the join key: it is the **challenge-mode** map id, the same number
 * `CHALLENGE_MODE_START` writes as its third field. The instance id in the same
 * log line is a different number and does not appear in MDT at all.
 *
 * This is not a Lua interpreter and does not try to be. It is a brace-depth
 * scanner, which is the part that matters: the fields we want (`id`, `count`,
 * `name`, `isBoss`) sit at one known depth, while `spells` and `clones` — the
 * bulk of the file, and the parts whose shape churns between patches — nest
 * deeper and are skipped wholesale. Depth rather than indentation, because
 * indentation is a formatter's choice and has changed before.
 */
import type { DungeonForces, EnemyForces } from './forces.js';

/** Matches `[dungeonIndex]` and `[164]` alike; older files used the literal. */
const INDEX = String.raw`\[\s*(?:dungeonIndex|\d+)\s*\]`;

const TOTAL_COUNT = new RegExp(String.raw`MDT\.dungeonTotalCount${INDEX}\s*=\s*\{([^}]*)\}`);
const MAP_INFO = new RegExp(String.raw`MDT\.mapInfo${INDEX}\s*=\s*\{`);
const DUNGEON_ENEMIES = new RegExp(String.raw`MDT\.dungeonEnemies${INDEX}\s*=\s*\{`);

/** `normal` is the live requirement; `teeming` is a retired affix's variant. */
const NORMAL = /\bnormal\s*=\s*(\d+)/;
/** Quoted or bare key, since MDT mixes `["x"] =` and `x =` across files. */
const field = (name: string): RegExp => new RegExp(String.raw`\[\s*"${name}"\s*\]\s*=|\b${name}\s*=`);

const NUMBER_AFTER = /\s*=\s*(-?\d+)/;
const STRING_AFTER = /\s*=\s*"((?:[^"\\]|\\.)*)"/;
const BOOL_AFTER = /\s*=\s*(true|false)/;

/**
 * The value assigned to `name` in one record's top-level text.
 *
 * Returns null when the key is absent, which is meaningful: `isBoss` only
 * appears on bosses, and an enemy with no `count` is one MDT knows about but
 * has no forces value for.
 */
function readField(record: string, name: string, after: RegExp): string | null {
  const key = field(name).exec(record);
  if (key === null) return null;
  const value = after.exec(record.slice(key.index + key[0].length - 1));
  return value?.[1] ?? null;
}

/**
 * Start and end of the balanced `{...}` whose opening brace is at `open`.
 *
 * String literals are tracked so a brace inside a creature name cannot throw
 * the depth off, and `--` comments are skipped to end of line for the same
 * reason. Returns null on an unbalanced file rather than guessing, so a
 * truncated download reads as "no data" instead of as a short roster.
 */
function balanced(source: string, open: number): { end: number } | null {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"' || c === "'") {
      i = skipString(source, i);
      continue;
    }
    if (c === '-' && source[i + 1] === '-') {
      const nl = source.indexOf('\n', i);
      if (nl === -1) return null;
      i = nl;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { end: i };
  }
  return null;
}

/** Index of the closing quote of the string literal opening at `start`. */
function skipString(source: string, start: number): number {
  const quote = source[start]!;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}

/**
 * Each enemy record's top-level text, with nested tables elided.
 *
 * Characters are collected only while the scanner sits at the record's own
 * depth, so `["spells"] = { ... }` contributes its key and nothing else. That
 * is what makes a regex over the result safe: no `["id"]` from a clone or a
 * spell block can be mistaken for the creature's own.
 */
function enemyRecords(source: string, open: number, end: number): string[] {
  const records: string[] = [];
  let depth = 0;
  let current: string[] | null = null;

  for (let i = open; i <= end; i++) {
    const c = source[i]!;
    if (c === '"' || c === "'") {
      const close = skipString(source, i);
      if (depth === 2 && current !== null) current.push(source.slice(i, close + 1));
      i = close;
      continue;
    }
    if (c === '-' && source[i + 1] === '-') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? end : nl;
      continue;
    }
    if (c === '{') {
      depth++;
      if (depth === 2) current = [];
      continue;
    }
    if (c === '}') {
      if (depth === 2 && current !== null) {
        records.push(current.join(''));
        current = null;
      }
      depth--;
      continue;
    }
    if (depth === 2 && current !== null) current.push(c);
  }

  return records;
}

/**
 * One MDT dungeon file's forces, or null when the file is not one.
 *
 * MDT's directory also holds textures and an XML loader, and a dungeon file
 * missing either its `mapID` or its enemy table cannot be joined to a run, so
 * both absences return null rather than a half-filled dungeon.
 */
export function parseMdtDungeon(source: string): DungeonForces | null {
  const mapInfo = MAP_INFO.exec(source);
  if (mapInfo === null) return null;
  const mapInfoEnd = balanced(source, mapInfo.index + mapInfo[0].length - 1);
  if (mapInfoEnd === null) return null;
  const header = source.slice(mapInfo.index, mapInfoEnd.end + 1);

  const mapId = readField(header, 'mapID', NUMBER_AFTER);
  if (mapId === null) return null;
  const challengeModeId = Number(mapId);
  if (!Number.isInteger(challengeModeId) || challengeModeId <= 0) return null;

  const name = readField(header, 'englishName', STRING_AFTER) ?? '';

  // Optional, and only ever used for its icon: a dungeon MDT ships without a
  // teleport simply has no art, the same way one without a requirement has no
  // percentage.
  const teleport = Number(readField(header, 'teleportId', NUMBER_AFTER) ?? 0);
  const teleportSpellId = Number.isInteger(teleport) && teleport > 0 ? teleport : 0;

  // A dungeon with no requirement line still yields useful per-mob values, so
  // total falls back to 0 and the UI drops the percentage rather than the row.
  const totalBlock = TOTAL_COUNT.exec(source);
  const total = totalBlock === null ? 0 : Number(NORMAL.exec(totalBlock[1]!)?.[1] ?? 0);

  const enemiesAt = DUNGEON_ENEMIES.exec(source);
  if (enemiesAt === null) return null;
  const open = enemiesAt.index + enemiesAt[0].length - 1;
  const span = balanced(source, open);
  if (span === null) return null;

  const enemies: EnemyForces[] = [];
  const seen = new Set<number>();
  for (const record of enemyRecords(source, open, span.end)) {
    const id = readField(record, 'id', NUMBER_AFTER);
    if (id === null) continue;
    const npcId = Number(id);
    // A creature can appear twice when MDT splits it across sublevels; the
    // forces value is the same on both, so the first wins and the duplicate
    // is dropped rather than overwriting it.
    if (!Number.isInteger(npcId) || seen.has(npcId)) continue;
    seen.add(npcId);
    enemies.push({
      npcId,
      name: readField(record, 'name', STRING_AFTER) ?? '',
      count: Number(readField(record, 'count', NUMBER_AFTER) ?? 0),
      isBoss: readField(record, 'isBoss', BOOL_AFTER) === 'true',
    });
  }
  if (enemies.length === 0) return null;

  return { challengeModeId, name, total, teleportSpellId, enemies };
}

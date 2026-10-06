/**
 * Reading Mythic Dungeon Tools' data files: a dungeon's teleport spell, and
 * its spawns and map art.
 *
 * This used to read enemy forces. It no longer does: the forces table comes
 * from Blizzard's own scenario criteria now (see `enemy-forces.ts`), which
 * agrees with MDT on every total and every per-kill value tested and credits
 * ten creatures across six dungeons that MDT omits.
 *
 * What is left is one cosmetic number per dungeon. MDT ships one Lua file per
 * dungeon, machine-generated, whose header is
 *
 *   local dungeonIndex = 164
 *   MDT.mapInfo[dungeonIndex] = { englishName = "Altar of Fangs", mapID = 588,
 *                                 teleportId = 1286812 }
 *
 * `teleportId` is a spell, and that spell's icon *is* the dungeon's art, which
 * makes a dungeon icon one more id through the spell-icon path the app already
 * has rather than a second table mapping dungeons to texture names by hand.
 * Nothing in the criteria data links a dungeon to a spell, so this is the only
 * source for it, and it is strictly optional — without MDT a dungeon has no
 * art and every number on the page is unchanged.
 *
 * `mapID` is the join key: it is the **challenge-mode** map id, the same number
 * `CHALLENGE_MODE_START` writes as its third field and the same one
 * `MapChallengeMode` is keyed on. The instance id in the log line is a
 * different number and does not appear in MDT at all.
 */

/** Matches `[dungeonIndex]` and `[164]` alike; older files used the literal. */
const INDEX = String.raw`\[\s*(?:dungeonIndex|\d+)\s*\]`;

const MAP_INFO = new RegExp(String.raw`MDT\.mapInfo${INDEX}\s*=\s*\{`);

/** Quoted or bare key, since MDT mixes `["x"] =` and `x =` across files. */
const field = (name: string): RegExp => new RegExp(String.raw`\[\s*"${name}"\s*\]\s*=|\b${name}\s*=`);

const NUMBER_AFTER = /\s*=\s*(-?\d+)/;

/** The value assigned to `name` in one record's text, or null when absent. */
function readField(record: string, name: string): string | null {
  const key = field(name).exec(record);
  if (key === null) return null;
  const value = NUMBER_AFTER.exec(record.slice(key.index + key[0].length - 1));
  return value?.[1] ?? null;
}

/**
 * Index of the closing quote of the string literal opening at `start`.
 *
 * Tracked rather than ignored so a brace inside a dungeon name cannot throw
 * the depth count off.
 */
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
 * End of the balanced `{...}` whose opening brace is at `open`.
 *
 * Returns null on an unbalanced file rather than guessing, so a truncated
 * download reads as "no teleport" instead of as a wrong one.
 */
function balanced(source: string, open: number): number | null {
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
    else if (c === '}' && --depth === 0) return i;
  }
  return null;
}

/** A dungeon's challenge-mode id and the spell whose icon is its art. */
export interface MdtTeleport {
  challengeModeId: number;
  teleportSpellId: number;
}

/**
 * One MDT dungeon file's teleport spell, or null when the file has none.
 *
 * MDT's directory also holds textures, locale tables and an XML loader, and a
 * dungeon file with no `mapID` cannot be joined to a run, so both absences
 * return null. A dungeon MDT ships without a `teleportId` returns null too:
 * there is nothing to contribute, and the caller already has every number it
 * needs from the criteria table.
 */
export function parseMdtTeleport(source: string): MdtTeleport | null {
  const mapInfo = MAP_INFO.exec(source);
  if (mapInfo === null) return null;
  const open = mapInfo.index + mapInfo[0].length - 1;
  const end = balanced(source, open);
  if (end === null) return null;
  const header = source.slice(mapInfo.index, end + 1);

  const challengeModeId = Number(readField(header, 'mapID'));
  if (!Number.isInteger(challengeModeId) || challengeModeId <= 0) return null;

  const teleportSpellId = Number(readField(header, 'teleportId'));
  if (!Number.isInteger(teleportSpellId) || teleportSpellId <= 0) return null;

  return { challengeModeId, teleportSpellId };
}

// ------------------------------------------------------------ dungeon files

/**
 * A dungeon's spawns and map art, as MDT draws them.
 *
 * Read from the user's own MDT install at run time and never shipped, for the
 * same licence reason as the teleport above: MDT is GPL-2.0. What this gives
 * the app is MDT's canvas — every spawn's position on an 840 by 555 map, and
 * where the tiles that draw that map live — so a run can be placed on it.
 */
export interface MdtDungeon {
  challengeModeId: number;
  /** MDT's own number for the dungeon, which a route it imports must carry. */
  dungeonIndex: number;
  name: string;
  /** Zero when MDT has no teleport for the dungeon. */
  teleportSpellId: number;
  sublevels: MdtSublevel[];
  enemies: MdtEnemy[];
}

export interface MdtSublevel {
  /** 1-based, as MDT numbers them and as each clone's `sublevel` refers to them. */
  index: number;
  /** MDT's locale key for the floor, which is its English name or close to it. */
  name: string;
  /**
   * The folder holding this floor's 150 tiles, relative to MDT's own folder
   * and with forward slashes, or null when MDT draws the floor from the
   * game's own map art, which is inside the game's archives and out of reach.
   */
  textureDir: string | null;
}

export interface MdtEnemy {
  /** Position in MDT's enemy table, which a route refers to enemies by. */
  index: number;
  npcId: number;
  name: string;
  count: number;
  isBoss: boolean;
  clones: MdtClone[];
}

export interface MdtClone {
  /** Position in the enemy's clone table, which a route refers to spawns by. */
  index: number;
  /** MDT canvas units: x right from 0 to 840, y down from 0 to -555. */
  x: number;
  y: number;
  sublevel: number;
  /** MDT's pack number, or null for a spawn MDT does not group. */
  group: number | null;
}

/** MDT's canvas, in its own units. */
export const MDT_CANVAS = { width: 840, height: 555 } as const;

/**
 * MDT's tile grid: 15 across and 10 down, each tile a 128 px square covering
 * 56 canvas units, numbered row by row from 1 at the top left. The grid is
 * 560 units tall, so the last five units of the bottom row hang off the canvas.
 */
export const MDT_TILES = { columns: 15, rows: 10, pixels: 128, units: 56 } as const;

/** A tile's file name within a floor's `textureDir`. */
export function mdtTileName(sublevel: number, row: number, column: number): string {
  return `${sublevel}_${row * MDT_TILES.columns + column + 1}.png`;
}

type LuaValue = string | number | boolean | null | LuaTable;
type LuaTable = Map<string | number, LuaValue>;

/**
 * A reader for the Lua table literals MDT's generated files are made of.
 *
 * Not a Lua parser: tables, strings, numbers, booleans and nil, `L["Key"]`
 * locale lookups read as the key, a bare name read as its own name, and `..`
 * joining whatever is either side as text. That is everything the dungeon
 * files assign. Anything else throws, so a format change fails loudly rather
 * than reading as a map with half its spawns.
 */
function readLua(source: string, start: number): LuaValue {
  let i = start;
  const skip = (): void => {
    for (;;) {
      while (i < source.length && /\s/.test(source[i]!)) i++;
      if (!source.startsWith('--', i)) return;
      if (source.startsWith('--[[', i)) {
        const end = source.indexOf(']]', i);
        i = end === -1 ? source.length : end + 2;
      } else {
        const nl = source.indexOf('\n', i);
        i = nl === -1 ? source.length : nl;
      }
    }
  };
  const expect = (c: string): void => {
    skip();
    if (source[i] !== c) throw new Error(`expected ${c} at ${i}`);
    i++;
  };
  const string = (): string => {
    const quote = source[i++];
    let out = '';
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') i++;
      out += source[i++] ?? '';
    }
    i++;
    return out;
  };
  const primary = (): LuaValue => {
    skip();
    const c = source[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return string();
    const number = /^-?(?:0x[0-9a-f]+|\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)/i.exec(source.slice(i, i + 40));
    if (number !== null) {
      i += number[0].length;
      return Number(number[0]);
    }
    const word = /^[A-Za-z_]\w*/.exec(source.slice(i, i + 64));
    if (word === null) throw new Error(`unexpected ${JSON.stringify(source.slice(i, i + 20))} at ${i}`);
    i += word[0].length;
    if (word[0] === 'true') return true;
    if (word[0] === 'false') return false;
    if (word[0] === 'nil') return null;
    skip();
    if (source[i] === '[') {
      i++;
      const key = value();
      expect(']');
      return key;
    }
    return word[0];
  };
  const value = (): LuaValue => {
    let out = primary();
    for (;;) {
      skip();
      if (!source.startsWith('..', i)) return out;
      i += 2;
      out = `${String(out)}${String(primary())}`;
    }
  };
  const table = (): LuaTable => {
    i++; // {
    const out: LuaTable = new Map();
    let next = 1;
    for (;;) {
      skip();
      if (source[i] === '}') {
        i++;
        return out;
      }
      if (i >= source.length) throw new Error('unterminated table');
      let key: string | number;
      if (source[i] === '[') {
        i++;
        const k = value();
        if (typeof k !== 'string' && typeof k !== 'number') throw new Error(`bad key at ${i}`);
        key = k;
        expect(']');
        expect('=');
      } else {
        const named = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(source.slice(i, i + 80));
        if (named !== null) {
          key = named[1]!;
          i += named[0].length;
        } else {
          key = next++;
        }
      }
      out.set(key, value());
      skip();
      if (source[i] === ',' || source[i] === ';') i++;
    }
  };
  return value();
}

/** The value assigned to `MDT.<name>[dungeonIndex]`, or null when the file has none. */
function assignment(source: string, name: string): LuaValue {
  const found = new RegExp(String.raw`MDT\.${name}${INDEX}\s*=\s*`).exec(source);
  return found === null ? null : readLua(source, found.index + found[0].length);
}

const isTable = (value: LuaValue | undefined): value is LuaTable => value instanceof Map;
const num = (value: LuaValue | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * A texture path as MDT writes it, `'Interface\\AddOns\\'..addonName..'\\…'`,
 * as a folder relative to MDT's own: everything after `AddOns\<addon>\`.
 */
function textureDir(path: string): string | null {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  const addons = parts.findIndex((part) => part.toLowerCase() === 'addons');
  if (addons === -1 || addons + 2 >= parts.length) return null;
  const rest = parts.slice(addons + 2);
  return rest.some((part) => part === '..') ? null : rest.join('/');
}

/**
 * One MDT dungeon file's spawns and map art, or null when the file is not a
 * dungeon or cannot be read.
 *
 * Null rather than a partial dungeon for anything malformed: a map missing
 * half its spawns would fit a run worse than no map, and look like it fitted.
 */
export function parseMdtDungeon(source: string): MdtDungeon | null {
  if (!source.includes('MDT.dungeonEnemies[')) return null;
  try {
    const info = assignment(source, 'mapInfo');
    if (!isTable(info)) return null;
    const challengeModeId = num(info.get('mapID'));
    if (challengeModeId === null || challengeModeId <= 0) return null;
    const indexMatch = /local\s+dungeonIndex\s*=\s*(\d+)/.exec(source) ?? /MDT\.mapInfo\[\s*(\d+)\s*\]/.exec(source);
    if (indexMatch === null) return null;

    const maps = assignment(source, 'dungeonMaps');
    const names = assignment(source, 'dungeonSubLevels');
    const sublevels: MdtSublevel[] = [];
    if (isTable(names)) {
      for (const [index, name] of names) {
        if (typeof index !== 'number') continue;
        const art = isTable(maps) ? maps.get(index) : undefined;
        const custom = isTable(art) ? art.get('customTextures') : undefined;
        sublevels.push({
          index,
          name: typeof name === 'string' ? name : `Floor ${index}`,
          textureDir: typeof custom === 'string' ? textureDir(custom) : null,
        });
      }
    }
    sublevels.sort((a, b) => a.index - b.index);

    const table = assignment(source, 'dungeonEnemies');
    if (!isTable(table)) return null;
    const enemies: MdtEnemy[] = [];
    for (const [index, record] of table) {
      if (typeof index !== 'number' || !isTable(record)) continue;
      const npcId = num(record.get('id'));
      if (npcId === null) continue;
      const clones: MdtClone[] = [];
      const list = record.get('clones');
      if (isTable(list)) {
        for (const [cloneIndex, clone] of list) {
          if (typeof cloneIndex !== 'number' || !isTable(clone)) continue;
          const x = num(clone.get('x'));
          const y = num(clone.get('y'));
          if (x === null || y === null) continue;
          clones.push({ index: cloneIndex, x, y, sublevel: num(clone.get('sublevel')) ?? 1, group: num(clone.get('g')) });
        }
      }
      const name = record.get('name');
      enemies.push({
        index,
        npcId,
        name: typeof name === 'string' ? name : String(npcId),
        count: num(record.get('count')) ?? 0,
        isBoss: record.get('isBoss') === true,
        clones,
      });
    }
    const englishName = info.get('englishName');
    return {
      challengeModeId,
      dungeonIndex: Number(indexMatch[1]),
      name: typeof englishName === 'string' ? englishName : `Dungeon ${challengeModeId}`,
      teleportSpellId: num(info.get('teleportId')) ?? 0,
      sublevels,
      enemies,
    };
  } catch {
    return null;
  }
}

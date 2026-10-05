/**
 * Reading dungeon teleport spells out of Mythic Dungeon Tools' data files.
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

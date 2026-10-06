import assert from 'node:assert/strict';
import test from 'node:test';

import { mdtTileName, parseMdtDungeon, parseMdtTeleport } from '../src/index.js';

/**
 * An MDT dungeon file in miniature, shaped like the real ones.
 *
 * Only the `mapInfo` header is read now — the forces values come from
 * Blizzard's criteria data — but the rest of the file is kept because finding
 * that header in a realistic file is the whole job. The enemy table below it
 * is full of `["id"]` keys at several depths, and "Brace { Bearer" puts a
 * brace inside a string literal, so a scanner that loses its place has plenty
 * of chances to return the wrong number instead of none.
 */
const FIXTURE = `local _, MDT = ...
local addonName = MDT.AddonName
local L = MDT.L
local dungeonIndex = 164
MDT.dungeonList[dungeonIndex] = L["TestHold"]
MDT.mapInfo[dungeonIndex] = {
  teleportId = 1286812,
  shortName = L["TestHoldShortName"],
  englishName = "Test Hold",
  mapID = 588
};

MDT.dungeonMaps[dungeonIndex] = {
  [0] = "",
  [1] = { customTextures = 'Interface\\\\AddOns\\\\'..addonName..'\\\\Midnight\\\\Textures\\\\TestHold' },
  [2] = "Interface\\\\WorldMap\\\\TestHoldLower\\\\",
}

MDT.dungeonSubLevels[dungeonIndex] = {
  [1] = L["TestHold"],
  [2] = L["Test Hold Lower"],
}

MDT.dungeonTotalCount[dungeonIndex] = { normal = 800 }

MDT.dungeonEnemies[dungeonIndex] = {
  [1] = {
    ["name"] = "Ritual Chieftain",
    ["id"] = 270306,
    ["count"] = 25,
    ["health"] = 5189208,
    ["spells"] = {
      [1221063] = {
      },
      [1306517] = {
      },
    },
    ["clones"] = {
      [1] = {
        ["x"] = 65.5,
        ["y"] = -205.5,
        ["id"] = 999999,
        ["sublevel"] = 1,
      },
      [2] = {
        ["x"] = 70.5,
        ["y"] = -210.5,
        ["id"] = 999998,
        ["g"] = 4,
        ["sublevel"] = 2,
      },
    },
  },
  [2] = {
    ["name"] = "Brace { Bearer",
    ["id"] = 270307,
    ["count"] = 5,
    ["health"] = 1000000,
    ["spells"] = {},
    ["clones"] = {
      [1] = { ["x"] = 1.0, ["y"] = 2.0, ["id"] = 888888 },
    },
  },
  [3] = {
    ["name"] = "The Warden",
    ["id"] = 270400,
    ["count"] = 0,
    ["isBoss"] = true,
    ["encounterID"] = 3100,
    ["instanceID"] = 1202,
    ["health"] = 90000000,
    ["spells"] = {
      [1310012] = {
      },
    },
    ["clones"] = {
      [1] = { ["x"] = 500.0, ["y"] = -400.0, ["id"] = 777777 },
    },
  },
}
`;

test("an MDT dungeon file yields its dungeon's teleport spell", () => {
  const teleport = parseMdtTeleport(FIXTURE);
  assert.notEqual(teleport, null);
  // The join key is the challenge-mode map id, not the instanceID the boss
  // record carries — reading that one instead would never match a run.
  assert.equal(teleport!.challengeModeId, 588);
  assert.equal(teleport!.teleportSpellId, 1286812);
});

test('the enemy table below the header cannot be mistaken for the header', () => {
  const teleport = parseMdtTeleport(FIXTURE)!;
  // Every id buried in the enemy, clone and spell tables, and the creature
  // counts beside them. None of them is a teleport or a map.
  for (const intruder of [270306, 270307, 270400, 999999, 888888, 777777, 1310012, 3100, 1202]) {
    assert.notEqual(teleport.teleportSpellId, intruder);
    assert.notEqual(teleport.challengeModeId, intruder);
  }
});

test('a file that is not a dungeon reads as no teleport, not as a zero one', () => {
  assert.equal(parseMdtTeleport('local _, MDT = ...\nMDT.L = {}\n'), null);
  // A header with no teleport: MDT ships these for dungeons with no portal.
  assert.equal(
    parseMdtTeleport('MDT.mapInfo[dungeonIndex] = {\n  englishName = "Stub",\n  mapID = 1\n};\n'),
    null,
  );
  // A header with a teleport but no map id cannot be joined to a run.
  assert.equal(parseMdtTeleport('MDT.mapInfo[dungeonIndex] = {\n  teleportId = 5\n};\n'), null);
});

test('a truncated header reads as no teleport rather than a guess', () => {
  const cut = FIXTURE.slice(0, FIXTURE.indexOf('englishName'));
  assert.equal(parseMdtTeleport(cut), null);
});

test('a literal dungeon index is read like the local one', () => {
  const literal = FIXTURE.replace('MDT.mapInfo[dungeonIndex]', 'MDT.mapInfo[164]');
  assert.equal(parseMdtTeleport(literal)!.teleportSpellId, 1286812);
});

test('a dungeon file yields its spawns, floors and map art', () => {
  const dungeon = parseMdtDungeon(FIXTURE);
  assert.notEqual(dungeon, null);
  assert.equal(dungeon!.challengeModeId, 588);
  assert.equal(dungeon!.dungeonIndex, 164);
  assert.equal(dungeon!.name, 'Test Hold');
  assert.equal(dungeon!.teleportSpellId, 1286812);
  // MDT's own floor names are locale keys; the key is the name.
  assert.deepEqual(dungeon!.sublevels, [
    // Built by concatenation around the addon's folder name, which is
    // whatever the user's addon folder is called: what matters is the rest.
    { index: 1, name: 'TestHold', textureDir: 'Midnight/Textures/TestHold' },
    // Blizzard's own map art is in the game's archives, out of reach.
    { index: 2, name: 'Test Hold Lower', textureDir: null },
  ]);

  const chieftain = dungeon!.enemies.find((enemy) => enemy.npcId === 270306)!;
  assert.equal(chieftain.index, 1);
  assert.equal(chieftain.count, 25);
  assert.equal(chieftain.isBoss, false);
  assert.deepEqual(chieftain.clones, [
    { index: 1, x: 65.5, y: -205.5, sublevel: 1, group: null },
    { index: 2, x: 70.5, y: -210.5, sublevel: 2, group: 4 },
  ]);
  // A clone with no sublevel is on the first, as MDT draws it.
  assert.equal(dungeon!.enemies.find((enemy) => enemy.npcId === 270307)!.clones[0]!.sublevel, 1);
  assert.equal(dungeon!.enemies.find((enemy) => enemy.npcId === 270400)!.isBoss, true);
});

test('a dungeon file that is cut short or is not a dungeon reads as none', () => {
  assert.equal(parseMdtDungeon('local _, MDT = ...\nMDT.L = {}\n'), null);
  // Missing half its spawns would fit a run worse than no map, and look right.
  const cut = FIXTURE.slice(0, FIXTURE.indexOf('"Brace { Bearer"'));
  assert.equal(parseMdtDungeon(cut), null);
});

test('a texture folder that climbs out of the addon is refused', () => {
  const climbing = FIXTURE.replace("'\\\\Midnight\\\\Textures\\\\TestHold'", "'\\\\..\\\\..\\\\WTF'");
  assert.notEqual(climbing, FIXTURE);
  assert.equal(parseMdtDungeon(climbing)!.sublevels[0]!.textureDir, null);
});

test("tiles are named the way MDT's map view asks for them", () => {
  assert.equal(mdtTileName(1, 0, 0), '1_1.png');
  assert.equal(mdtTileName(1, 0, 14), '1_15.png');
  assert.equal(mdtTileName(2, 1, 0), '2_16.png');
  assert.equal(mdtTileName(1, 9, 14), '1_150.png');
});

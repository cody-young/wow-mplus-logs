import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMdtTeleport } from '../src/index.js';

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
        ["sublevel"] = 1,
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

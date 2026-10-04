import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_TABLE, forcesFor, forcesFraction, parseMdtDungeon, type ForcesTable } from '../src/index.js';

/**
 * An MDT dungeon file in miniature, shaped like the real ones.
 *
 * Three traps are deliberate. The `clones` blocks carry their own `["id"]`,
 * which a naive regex would read as a creature id. The `spells` blocks are
 * tables keyed by number, so brace depth is the only thing distinguishing them
 * from an enemy record. And "Brace { Bearer" puts a brace inside a string
 * literal, which is what the scanner's quote handling is for.
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

test('an MDT dungeon file yields its forces values', () => {
  const dungeon = parseMdtDungeon(FIXTURE);
  assert.notEqual(dungeon, null);
  assert.equal(dungeon!.name, 'Test Hold');
  assert.equal(dungeon!.total, 800);
  // The join key is the challenge-mode map id, not the instanceID the boss
  // record carries — reading that one instead would never match a run.
  assert.equal(dungeon!.challengeModeId, 588);
  assert.deepEqual(
    dungeon!.enemies.map((enemy) => [enemy.npcId, enemy.name, enemy.count, enemy.isBoss]),
    [
      [270306, 'Ritual Chieftain', 25, false],
      [270307, 'Brace { Bearer', 5, false],
      [270400, 'The Warden', 0, true],
    ],
  );
});

test('clone and spell ids are not mistaken for creature ids', () => {
  const dungeon = parseMdtDungeon(FIXTURE)!;
  const ids = new Set(dungeon.enemies.map((enemy) => enemy.npcId));
  for (const intruder of [999999, 999998, 888888, 777777, 1221063, 1306517, 1310012, 3100, 1202]) {
    assert.ok(!ids.has(intruder), `${intruder} leaked out of a nested table`);
  }
});

test('a file that is not a dungeon reads as no dungeon, not as an empty one', () => {
  assert.equal(parseMdtDungeon('local _, MDT = ...\nMDT.L = {}\n'), null);
  // mapInfo without an enemy table: a stub MDT ships before a season starts.
  assert.equal(
    parseMdtDungeon('MDT.mapInfo[dungeonIndex] = {\n  englishName = "Stub",\n  mapID = 1\n};\n'),
    null,
  );
});

test('a truncated file reads as no dungeon rather than a short roster', () => {
  const cut = FIXTURE.slice(0, FIXTURE.indexOf('["clones"]', FIXTURE.indexOf('Brace')));
  assert.equal(parseMdtDungeon(cut), null);
});

test('a missing requirement line leaves the per-mob values usable', () => {
  const dungeon = parseMdtDungeon(FIXTURE.replace('MDT.dungeonTotalCount[dungeonIndex] = { normal = 800 }', ''))!;
  assert.equal(dungeon.total, 0);
  assert.equal(dungeon.enemies.length, 3);
  // And the fraction stays a number, so the UI gets a blank and not "NaN%".
  assert.equal(forcesFraction(25, dungeon.total), 0);
});

test('a teeming value does not displace the normal one', () => {
  const dungeon = parseMdtDungeon(
    FIXTURE.replace('{ normal = 800 }', '{ teeming = 1000, normal = 800 }'),
  )!;
  assert.equal(dungeon.total, 800);
});

test('lookup is by challenge-mode id and misses are null', () => {
  const table: ForcesTable = { source: 'test', dungeons: [parseMdtDungeon(FIXTURE)!] };
  const forces = forcesFor(table, 588);
  assert.notEqual(forces, null);
  assert.equal(forces!.of(270306), 25);
  assert.equal(forces!.isBoss(270400), true);
  // A creature the table has never heard of is null, not 0: "worth nothing"
  // and "unknown" display differently and must not collapse together.
  assert.equal(forces!.of(123), null);
  assert.equal(forcesFor(table, 399), null);
  assert.equal(forcesFor(table, -1), null);
  assert.equal(forcesFor(EMPTY_TABLE, 588), null);
});

test('forces are a fraction of the requirement', () => {
  assert.equal(forcesFraction(400, 800), 0.5);
  assert.equal(forcesFraction(0, 0), 0);
});

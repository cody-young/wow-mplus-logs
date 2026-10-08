import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import type { MdtDungeon } from '@mplus/data';

import {
  SegmentKind,
  encodeCbor,
  mdtExportString,
  mdtRoute,
  routeUid,
  type MdtPlacement,
  type Segment,
} from '../src/index.js';

/** Enough CBOR to read back what `encodeCbor` writes, maps as Maps. */
function decodeCbor(bytes: Uint8Array): unknown {
  let at = 0;
  const length = (info: number): number => {
    if (info < 24) return info;
    const size = 1 << (info - 24);
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + bytes[at++]!;
    return n;
  };
  const read = (): unknown => {
    const byte = bytes[at++]!;
    const major = byte >> 5;
    const info = byte & 31;
    if (byte === 0xf4) return false;
    if (byte === 0xf5) return true;
    const n = length(info);
    switch (major) {
      case 0:
        return n;
      case 1:
        return -1 - n;
      case 3: {
        const text = new TextDecoder().decode(bytes.subarray(at, at + n));
        at += n;
        return text;
      }
      case 4:
        return Array.from({ length: n }, read);
      case 5: {
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < n; i++) map.set(read(), read());
        return map;
      }
      default:
        throw new Error(`unexpected major type ${major}`);
    }
  };
  return read();
}

test('CBOR heads are as RFC 8949 spells them', () => {
  assert.deepEqual([...encodeCbor(0)], [0x00]);
  assert.deepEqual([...encodeCbor(23)], [0x17]);
  assert.deepEqual([...encodeCbor(24)], [0x18, 0x18]);
  assert.deepEqual([...encodeCbor(1000)], [0x19, 0x03, 0xe8]);
  assert.deepEqual([...encodeCbor(-1)], [0x20]);
  assert.deepEqual([...encodeCbor('a')], [0x61, 0x61]);
  assert.deepEqual([...encodeCbor([1, 2])], [0x82, 0x01, 0x02]);
  assert.deepEqual([...encodeCbor(new Map([[1, true]]))], [0xa1, 0x01, 0xf5]);
});

const DUNGEON: MdtDungeon = {
  challengeModeId: 9999,
  dungeonIndex: 164,
  name: 'Test Hold',
  teleportSpellId: 0,
  sublevels: [
    { index: 1, name: 'Upper', textureDir: null },
    { index: 2, name: 'Lower', textureDir: null },
  ],
  enemies: [1, 2].map((index) => ({
    index,
    npcId: 1000 + index,
    name: `Creature ${index}`,
    count: 4,
    isBoss: false,
    displayId: null,
    clones: [1, 2, 3].map((clone) => ({ index: clone, x: 0, y: 0, sublevel: 2, group: null })),
  })),
};

function segment(id: number, startTs: number, enemies: number[]): Segment {
  return {
    id,
    kind: SegmentKind.PULL,
    label: '',
    pullNumber: id,
    startTs,
    endTs: startTs + 1000,
    enemies,
    roster: [],
    forces: 0,
    encounterId: 0,
    success: null,
    overlaps: [],
    centroidX: 0,
    centroidY: 0,
  };
}

const placement: MdtPlacement = {
  dungeon: DUNGEON,
  floors: [],
  matches: [
    { actor: 10, enemyIndex: 2, cloneIndex: 3, distance: 1 },
    { actor: 11, enemyIndex: 1, cloneIndex: 1, distance: 1 },
    { actor: 12, enemyIndex: 2, cloneIndex: 1, distance: 1 },
    { actor: 20, enemyIndex: 1, cloneIndex: 2, distance: 1 },
  ],
};

test("a run's pulls become MDT pulls in the order fought, skipping any with nothing placed", () => {
  // Segment 2 was fought first; segment 3 placed nothing.
  const segments = [segment(1, 5000, [20]), segment(2, 1000, [10, 11, 12, 99]), segment(3, 3000, [30])];
  const route = mdtRoute(placement, segments, 'Test Hold +12', 12, 'abcdefghijk')!;
  assert.equal(route.value.currentDungeonIdx, 164);
  assert.equal(route.value.currentSublevel, 2);
  assert.equal(route.difficulty, 12);
  assert.deepEqual(
    route.value.pulls.map((pull) => [...pull].filter(([key]) => key !== 'color')),
    [
      [
        [1, [1]],
        [2, [1, 3]],
      ],
      [[1, [2]]],
    ],
  );
  assert.ok(route.value.pulls.every((pull) => /^[0-9a-f]{6}$/.test(pull.get('color') as string)));
});

test('nothing placed is no route', () => {
  assert.equal(mdtRoute({ ...placement, matches: [] }, [segment(1, 0, [10])], 'x', 2, 'abcdefghijk'), null);
});

test('the export string reads back as the route', async () => {
  const route = mdtRoute(placement, [segment(1, 0, [10, 11, 12, 20])], 'Test Hold +12', 12, routeUid('run-1'))!;
  const exported = await mdtExportString(route);
  assert.ok(exported.startsWith('!~MDT2~'));
  const decoded = decodeCbor(inflateRawSync(Buffer.from(exported.slice(7), 'base64'))) as Map<string, unknown>;
  assert.equal(decoded.get('text'), 'Test Hold +12');
  assert.equal(decoded.get('uid'), route.uid);
  const value = decoded.get('value') as Map<string, unknown>;
  assert.equal(value.get('currentDungeonIdx'), 164);
  assert.equal(value.get('currentPull'), 1);
  const pulls = value.get('pulls') as Array<Map<unknown, unknown>>;
  assert.equal(pulls.length, 1);
  assert.deepEqual(pulls[0]!.get(1), [1, 2]);
  assert.deepEqual(pulls[0]!.get(2), [1, 3]);
});

test('a route id is MDT-shaped and the same for the same run', () => {
  assert.match(routeUid('run-1'), /^[a-zA-Z0-9()]{11}$/);
  assert.equal(routeUid('run-1'), routeUid('run-1'));
  assert.notEqual(routeUid('run-1'), routeUid('run-2'));
});

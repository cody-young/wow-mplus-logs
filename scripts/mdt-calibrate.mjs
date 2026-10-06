#!/usr/bin/env node
/**
 * Can a key's combat log be placed on Mythic Dungeon Tools' map?
 *
 * The log gives every acting or hit unit a world position and the uiMapID it
 * stood on. MDT gives every enemy spawn a position on its own 840x555 canvas.
 * Exporting a run as an MDT route means matching each kill to one of MDT's
 * spawns, and that needs the transform from one space to the other.
 *
 * There is no single transform: MDT's canvas for a multi-map dungeon is
 * stitched together by hand, each uiMap scaled and placed on its own. Free
 * similarity fits per uiMap showed every good fit rotated by +90 degrees with
 * no reflection, and the bad ones landing on mirrored or skewed nonsense, so
 * this fits the constrained model
 *
 *   mdt = s * i * world + b        (complex numbers, world = x + iy)
 *
 * per (uiMap, MDT sublevel): one scale and one offset. It is RANSAC over pairs
 * of observed enemies matched to MDT spawns by npc id, then least squares over
 * the inliers.
 *
 * An enemy's observed position is its first advanced-log sample at full
 * health, falling back to its first sample of any kind: the closest thing the
 * log has to where it stood before anyone touched it. Patrols and dragged
 * packs are the outliers RANSAC is there to ignore.
 *
 * What it prints, per key and uiMap, is the fit and its error in MDT units,
 * then per dungeon how much the fits agree across keys and how well one pooled
 * fit serves every key. That last number decides whether the app can fit per
 * run or should ship a table.
 *
 *   node scripts/mdt-calibrate.mjs [--mdt <MythicDungeonTools dir>]
 *                                  [--dungeon <name substring>] <log>...
 *
 * --mdt defaults to the addon beside the first log's WoW install.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
let mdtDir = null;
let only = null;
let verbose = false;
const logs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mdt') mdtDir = args[++i];
  else if (args[i] === '--dungeon') only = args[++i].toLowerCase();
  else if (args[i] === '--verbose') verbose = true;
  else logs.push(args[i]);
}
if (logs.length === 0) {
  console.error('usage: node scripts/mdt-calibrate.mjs [--mdt <dir>] [--dungeon <name>] <log>...');
  process.exit(2);
}
mdtDir ??= join(dirname(logs[0]), '..', 'Interface', 'AddOns', 'MythicDungeonTools');
if (!existsSync(mdtDir)) {
  console.error(`no MDT at ${mdtDir}; pass --mdt`);
  process.exit(2);
}

// ------------------------------------------------------------ MDT Lua files

/**
 * A reader for the Lua table literals MDT's generated files are made of.
 *
 * Not a Lua parser: tables, strings, numbers, booleans and nil, plus
 * `L["Key"]` locale lookups read as the key. That is everything the dungeon
 * files assign, and anything else throws, so a format change is loud.
 */
function readLuaValue(src, start) {
  let i = start;
  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('--', i)) {
        if (src.startsWith('--[[', i)) i = src.indexOf(']]', i) + 2;
        else {
          const nl = src.indexOf('\n', i);
          i = nl === -1 ? src.length : nl;
        }
        continue;
      }
      return;
    }
  };
  const string = () => {
    const q = src[i++];
    let out = '';
    while (src[i] !== q) {
      if (src[i] === '\\') i++;
      out += src[i++];
    }
    i++;
    return out;
  };
  const value = () => {
    skip();
    const c = src[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return string();
    const num = /^-?(?:0x[0-9a-f]+|\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)/i.exec(src.slice(i, i + 40));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const word = /^[A-Za-z_]\w*/.exec(src.slice(i, i + 64));
    if (word) {
      i += word[0].length;
      if (word[0] === 'true') return true;
      if (word[0] === 'false') return false;
      if (word[0] === 'nil') return null;
      skip();
      if (src[i] === '[') {
        i++;
        const key = value();
        skip();
        i++; // ]
        return key;
      }
      return word[0];
    }
    throw new Error(`unexpected ${JSON.stringify(src.slice(i, i + 20))} at ${i}`);
  };
  const table = () => {
    i++; // {
    const out = new Map();
    let next = 1;
    for (;;) {
      skip();
      if (src[i] === '}') {
        i++;
        return out;
      }
      let key;
      if (src[i] === '[') {
        i++;
        key = value();
        skip();
        i++; // ]
        skip();
        i++; // =
      } else {
        const m = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(src.slice(i, i + 80));
        if (m) {
          key = m[1];
          i += m[0].length;
        } else key = next++;
      }
      out.set(key, value());
      skip();
      if (src[i] === ',' || src[i] === ';') i++;
    }
  };
  const v = value();
  return v;
}

/** The value assigned to `MDT.<name>[dungeonIndex]`, or null. */
function mdtAssignment(src, name) {
  const m = new RegExp(String.raw`MDT\.${name}\[\s*(?:dungeonIndex|\d+)\s*\]\s*=\s*`).exec(src);
  return m ? readLuaValue(src, m.index + m[0].length) : null;
}

function luaFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...luaFiles(path));
    else if (name.endsWith('.lua')) out.push(path);
  }
  return out;
}

/** challenge-mode id -> { name, clones: Map<npcId, {x, y, g, sublevel, index}[]> } */
const mdtDungeons = new Map();
for (const path of luaFiles(mdtDir)) {
  const src = readFileSync(path, 'utf8');
  if (!src.includes('MDT.dungeonEnemies[')) continue;
  const info = mdtAssignment(src, 'mapInfo');
  const cm = info?.get('mapID');
  if (typeof cm !== 'number') continue;
  const enemies = mdtAssignment(src, 'dungeonEnemies');
  const clones = new Map();
  for (const [enemyIndex, enemy] of enemies) {
    const id = enemy.get('id');
    const list = clones.get(id) ?? [];
    for (const [cloneIndex, c] of enemy.get('clones') ?? []) {
      list.push({
        x: c.get('x'),
        y: c.get('y'),
        g: c.get('g') ?? null,
        sublevel: c.get('sublevel') ?? 1,
        enemyIndex,
        cloneIndex,
      });
    }
    clones.set(id, list);
  }
  mdtDungeons.set(cm, { name: info.get('englishName') ?? basename(path, '.lua'), clones });
}

// -------------------------------------------------------------- log reading

/** Fields before the advanced block, by event: base 8 plus the prefix. */
const ADVANCED_AT = new Map([
  ['SPELL_DAMAGE', 12],
  ['SPELL_PERIODIC_DAMAGE', 12],
  ['RANGE_DAMAGE', 12],
  ['SPELL_HEAL', 12],
  ['SPELL_PERIODIC_HEAL', 12],
  ['SPELL_CAST_SUCCESS', 12],
  ['SPELL_ENERGIZE', 12],
  ['SPELL_PERIODIC_ENERGIZE', 12],
  ['SWING_DAMAGE', 9],
  ['SWING_DAMAGE_LANDED', 9],
]);

/**
 * A copy of a string that does not share storage with the line it came from.
 *
 * V8 slices point into their parent, and readline's lines point into the 4MB
 * chunk they were read from, so keeping a GUID from every key otherwise keeps
 * every chunk any enemy was first seen in: gigabytes over a season of logs.
 */
const own = (s) => Buffer.from(s, 'utf8').toString('utf8');

const npcOf = (guid) => {
  if (!guid.startsWith('Creature-') && !guid.startsWith('Vehicle-')) return null;
  return Number(guid.split('-')[5]);
};

/**
 * Every key in a log: its challenge-mode id, the uiMaps it entered with their
 * bounds, and one observed position per enemy.
 */
async function readKeys(path) {
  const keys = [];
  let key = null;
  const rl = createInterface({ input: createReadStream(path, { highWaterMark: 1 << 22 }), crlfDelay: Infinity });
  for await (const line of rl) {
    const sep = line.indexOf('  ');
    if (sep === -1) continue;
    const body = line.slice(sep + 2);
    const comma = body.indexOf(',');
    const event = body.slice(0, comma);
    if (event === 'CHALLENGE_MODE_START') {
      // The affix list at the end is bracketed and comma-separated, so read from the front.
      const m = /^CHALLENGE_MODE_START,"(.*)",\d+,(\d+),(\d+),/.exec(body);
      key = m && { log: basename(path), name: own(m[1]), cm: Number(m[2]), level: Number(m[3]), maps: new Map(), seen: new Map() };
      continue;
    }
    if (key === null) continue;
    if (event === 'CHALLENGE_MODE_END') {
      key.kills = new Map();
      for (const s of key.seen.values()) if (s.died) key.kills.set(s.npc, (key.kills.get(s.npc) ?? 0) + 1);
      keys.push(key);
      key = null;
      continue;
    }
    if (event === 'UNIT_DIED') {
      const s = key.seen.get(body.split(',')[5]);
      if (s) s.died = true;
      continue;
    }
    if (event === 'MAP_CHANGE') {
      const m = /^MAP_CHANGE,(\d+),".*",(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(body);
      if (m) key.maps.set(Number(m[1]), m.slice(2).map(Number));
      continue;
    }
    const at = ADVANCED_AT.get(event);
    if (at === undefined) continue;
    const f = body.split(',');
    const guid = f[at];
    const npc = npcOf(guid);
    if (npc === null || f.length < at + 17) continue;
    const hp = Number(f[at + 2]);
    const maxHp = Number(f[at + 3]);
    const x = Number(f[at + 14]);
    const y = Number(f[at + 15]);
    const uiMap = Number(f[at + 16]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(uiMap)) continue;
    let s = key.seen.get(guid);
    if (s === undefined) {
      const name = f[at] === f[1] ? f[2] : f[at] === f[5] ? f[6] : '?';
      s = { npc, name: own(name.replace(/"/g, '')), first: { x, y, uiMap }, full: null, died: false };
      key.seen.set(own(guid), s);
    }
    if (s.full === null && hp === maxHp && maxHp > 0) s.full = { x, y, uiMap };
  }
  return keys;
}

// ------------------------------------------------------------------ fitting

/** Mulberry32, so a rerun prints the same numbers. */
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INLIER = 12;

/** world (x, y) -> MDT under { s, bx, by }: s * i * (x + iy) + b = (-s*y + bx, s*x + by). */
const apply = (t, p) => [-t.s * p.y + t.bx, t.s * p.x + t.by];

/** Distance from a transformed observation to its nearest same-npc spawn, and that spawn. */
function nearest(t, p, candidates) {
  const [u, v] = apply(t, p);
  let best = Infinity;
  let spawn = null;
  for (const c of candidates) {
    const d = Math.hypot(c.x - u, c.y - v);
    if (d < best) {
      best = d;
      spawn = c;
    }
  }
  return { d: best, spawn };
}

/** Least squares for s, b given matched pairs, rotation held at +90. */
function solve(pairs) {
  let ux = 0, uy = 0, zx = 0, zy = 0;
  for (const { p, c } of pairs) {
    ux += -p.y;
    uy += p.x;
    zx += c.x;
    zy += c.y;
  }
  const n = pairs.length;
  ux /= n; uy /= n; zx /= n; zy /= n;
  let num = 0, den = 0;
  for (const { p, c } of pairs) {
    const du = -p.y - ux;
    const dv = p.x - uy;
    num += du * (c.x - zx) + dv * (c.y - zy);
    den += du * du + dv * dv;
  }
  const s = num / den;
  return { s, bx: zx - s * ux, by: zy - s * uy };
}

/** The free rotation least squares would pick for the same pairs, in degrees. */
function freeRotation(pairs) {
  let ux = 0, uy = 0, zx = 0, zy = 0;
  for (const { p, c } of pairs) {
    ux += p.x; uy += p.y; zx += c.x; zy += c.y;
  }
  const n = pairs.length;
  ux /= n; uy /= n; zx /= n; zy /= n;
  let re = 0, im = 0;
  for (const { p, c } of pairs) {
    const a = p.x - ux, b = p.y - uy, cx = c.x - zx, cy = c.y - zy;
    // conj(w) * z
    re += a * cx + b * cy;
    im += a * cy - b * cx;
  }
  return (Math.atan2(im, re) * 180) / Math.PI;
}

/**
 * Fit observations (each { p, candidates }) to MDT spawns.
 *
 * Returns null under six points: two define the fit, and a handful more are
 * the least that can outvote a bad pair.
 */
function fit(obs, seed = 1) {
  if (obs.length < 6) return null;
  const random = rng(seed);
  const pick = (a) => a[Math.floor(random() * a.length)];
  let best = { score: -1, t: null };
  for (let iter = 0; iter < 6000; iter++) {
    const a = pick(obs);
    const b = pick(obs);
    const dwx = b.p.x - a.p.x, dwy = b.p.y - a.p.y;
    if (Math.hypot(dwx, dwy) < 15) continue;
    const ca = pick(a.candidates);
    const cb = pick(b.candidates);
    // (z2 - z1) / (i (w2 - w1)) should be a positive real: s.
    const ix = -dwy, iy = dwx;
    const dzx = cb.x - ca.x, dzy = cb.y - ca.y;
    const den = ix * ix + iy * iy;
    const re = (dzx * ix + dzy * iy) / den;
    const im = (dzy * ix - dzx * iy) / den;
    if (!(re > 0.2 && re < 5) || Math.abs(im) > re * 0.15) continue;
    const t = { s: re, bx: ca.x - re * -a.p.y, by: ca.y - re * a.p.x };
    const score = assign(t, obs).matched;
    if (score > best.score) best = { score, t };
  }
  if (best.t === null) return null;
  let t = best.t;
  let pairs = [];
  for (let round = 0; round < 3; round++) {
    pairs = assign(t, obs).pairs;
    if (pairs.length < 3) break;
    t = solve(pairs);
  }
  return { t, ...score(t, obs), rot: pairs.length >= 3 ? freeRotation(pairs) : NaN };
}

/**
 * Match observations to spawns one-to-one, closest pairs first.
 *
 * Nearest-spawn scoring lets a too-small scale pile every kill of an npc onto
 * one spawn and call them all inliers; claiming a spawn once is what makes
 * that collapse score badly. Claims are per key, so a pooled fit can match
 * every key's kills to the same spawns. An observation left without a spawn keeps its
 * distance to the nearest one, so the median still says how far off it was.
 */
function assign(t, obs) {
  const edges = [];
  const dist = obs.map((o, oi) => {
    const [u, v] = apply(t, o.p);
    let best = Infinity;
    for (const c of o.candidates) {
      const d = Math.hypot(c.x - u, c.y - v);
      if (d < best) best = d;
      if (d < INLIER) edges.push({ oi, c, d });
    }
    return best;
  });
  edges.sort((a, b) => a.d - b.d);
  const usedObs = new Set();
  /** key -> spawns claimed in it; one per key, since a pooled fit spans keys. */
  const usedSpawn = new Map();
  const pairs = [];
  const d = dist.slice();
  for (const e of edges) {
    const group = obs[e.oi].key;
    if (!usedSpawn.has(group)) usedSpawn.set(group, new Set());
    const used = usedSpawn.get(group);
    if (usedObs.has(e.oi) || used.has(e.c)) continue;
    usedObs.add(e.oi);
    used.add(e.c);
    d[e.oi] = e.d;
    pairs.push({ p: obs[e.oi].p, c: e.c, d: e.d });
  }
  for (let i = 0; i < d.length; i++) if (!usedObs.has(i)) d[i] = Math.max(d[i], INLIER);
  return { matched: pairs.length, pairs, d };
}

function score(t, obs) {
  const { d: all } = assign(t, obs);
  const d = all.sort((a, b) => a - b);
  const inl = d.filter((x) => x < INLIER);
  return {
    n: obs.length,
    inliers: inl.length,
    median: d[d.length >> 1],
    inlierMedian: inl.length ? inl[inl.length >> 1] : NaN,
  };
}

/**
 * The observations on one uiMap that MDT could match on one sublevel.
 *
 * `which` picks the spawn proxy: 'full' is the first sample at full health
 * where there is one, 'first' is the first sample of any kind.
 */
function observations(key, uiMap, sublevel, which) {
  const dungeon = mdtDungeons.get(key.cm);
  const out = [];
  for (const s of key.seen.values()) {
    // Only kills: a route is made of them, and what lives is mostly summons,
    // scripted spawns and the bosses' own adds. An npc killed more often than
    // MDT has spawns for it is a summon too, whatever MDT calls it.
    if (!s.died) continue;
    if (key.kills.get(s.npc) > (dungeon.clones.get(s.npc)?.length ?? 0)) continue;
    const p = which === 'full' ? (s.full ?? s.first) : s.first;
    if (p.uiMap !== uiMap) continue;
    const candidates = (dungeon.clones.get(s.npc) ?? []).filter((c) => c.sublevel === sublevel);
    if (candidates.length) out.push({ p, candidates, seen: s, key });
  }
  return out;
}

// --------------------------------------------------------------------- main

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const pct = (a, b) => `${((100 * a) / Math.max(b, 1)).toFixed(0)}%`;

const allKeys = [];
for (const path of logs) {
  const keys = await readKeys(path);
  for (const k of keys) {
    if (!mdtDungeons.has(k.cm)) continue;
    if (only && !k.name.toLowerCase().includes(only)) continue;
    allKeys.push(k);
  }
  process.stderr.write(`read ${basename(path)}: ${keys.length} keys\n`);
}

/** `${cm}:${uiMap}` -> [{ key, sublevel, fit, obs }] */
const perMap = new Map();

for (const key of allKeys) {
  const dungeon = mdtDungeons.get(key.cm);
  const sublevels = [...new Set([...dungeon.clones.values()].flat().map((c) => c.sublevel))].sort();
  const uiMaps = [...new Set([...key.seen.values()].map((s) => s.first.uiMap))].sort();
  console.log(`\n${key.name} +${key.level}  (${key.log}, ${key.seen.size} enemies seen)`);
  for (const uiMap of uiMaps) {
    let best = null;
    for (const sublevel of sublevels) {
      const obs = observations(key, uiMap, sublevel, 'full');
      const f = fit(obs);
      if (f && (best === null || f.inliers > best.fit.inliers)) best = { sublevel, fit: f, obs };
    }
    const bounds = key.maps.get(uiMap);
    if (best === null) {
      console.log(`  uiMap ${uiMap}: too few matchable enemies`);
      continue;
    }
    const first = fit(observations(key, uiMap, best.sublevel, 'first'));
    const { t, n, inliers, median, inlierMedian, rot } = best.fit;
    console.log(
      `  uiMap ${uiMap} -> sub ${best.sublevel}: ${inliers}/${n} inliers (${pct(inliers, n)}), ` +
        `median ${f1(median)}, inlier median ${f1(inlierMedian)}, s ${t.s.toFixed(4)}, ` +
        `b (${f1(t.bx)}, ${f1(t.by)}), free rot ${f1(rot)}` +
        (first ? ` | first-seen proxy: ${first.inliers}/${first.n}, median ${f1(first.median)}` : '') +
        (bounds ? '' : ' | no MAP_CHANGE'),
    );
    if (verbose) {
      const byNpc = new Map();
      const assigned = assign(t, best.obs);
      for (const o of best.obs) {
        const r = byNpc.get(o.seen.npc) ?? { name: o.seen.name, seen: 0, died: 0, clones: o.candidates.length, d: [] };
        r.seen++;
        if (o.seen.died) r.died++;
        r.d.push(assigned.d[best.obs.indexOf(o)]);
        byNpc.set(o.seen.npc, r);
      }
      for (const [npc, r] of [...byNpc].sort((a, b) => b[1].seen - a[1].seen))
        console.log(`      ${npc} ${r.name}: seen ${r.seen} died ${r.died} mdt ${r.clones} | d ${r.d.sort((a, b) => a - b).map((x) => x.toFixed(0)).join(' ')}`);
    }
    const k = `${key.cm}:${uiMap}`;
    if (!perMap.has(k)) perMap.set(k, []);
    perMap.get(k).push({ key, sublevel: best.sublevel, fit: best.fit, obs: best.obs });
  }
}

console.log('\n================ across keys ================');
console.log('per uiMap: spread of per-key fits, then one pooled fit scored on each key');
for (const [k, runs] of [...perMap].sort()) {
  const [cm, uiMap] = k.split(':').map(Number);
  const name = mdtDungeons.get(cm).name;
  const good = runs.filter((r) => r.fit.inliers >= Math.max(6, r.fit.n * 0.3));
  const ss = good.map((r) => r.fit.t.s).sort((a, b) => a - b);
  const bxs = good.map((r) => r.fit.t.bx).sort((a, b) => a - b);
  const bys = good.map((r) => r.fit.t.by).sort((a, b) => a - b);
  const subs = [...new Set(runs.map((r) => r.sublevel))].join(',');
  const pooled = fit(runs.flatMap((r) => r.obs), 7);
  console.log(
    `\n${name} uiMap ${uiMap} (sub ${subs}): ${runs.length} keys, ${good.length} good` +
      (good.length
        ? `; s ${ss[0].toFixed(4)}..${ss.at(-1).toFixed(4)}, bx ${f1(bxs[0])}..${f1(bxs.at(-1))}, by ${f1(bys[0])}..${f1(bys.at(-1))}`
        : ''),
  );
  if (!pooled) continue;
  console.log(
    `  pooled: s ${pooled.t.s.toFixed(4)} b (${f1(pooled.t.bx)}, ${f1(pooled.t.by)}), ` +
      `${pooled.inliers}/${pooled.n} (${pct(pooled.inliers, pooled.n)}), median ${f1(pooled.median)}, free rot ${f1(pooled.rot)}`,
  );
  for (const r of runs) {
    const sc = score(pooled.t, r.obs);
    console.log(
      `    ${r.key.log} +${r.key.level}: own ${r.fit.inliers}/${r.fit.n} med ${f1(r.fit.median)} | ` +
        `pooled ${sc.inliers}/${sc.n} med ${f1(sc.median)}`,
    );
  }
}

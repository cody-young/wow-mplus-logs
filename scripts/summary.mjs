#!/usr/bin/env node
/**
 * Per-run damage, healing and death summary.
 *
 * Fixtures prove the parser reads the fields it was told about. This proves
 * the numbers that come out are plausible, which is the part fixtures cannot
 * check. It also settles two attribution questions from evidence rather than
 * recollection: whether SWING_DAMAGE and SWING_DAMAGE_LANDED duplicate each
 * other, and how large the Augmentation Evoker's _SUPPORT share is.
 *
 *   node scripts/summary.mjs <log>
 */
import { createReadStream } from 'node:fs';

import { Ev, EvFlag, LogSession } from '../packages/parser/dist/src/index.js';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/summary.mjs <WoWCombatLog-*.txt>');
  process.exit(2);
}

const DAMAGE = new Set([
  Ev.SPELL_DAMAGE,
  Ev.SPELL_PERIODIC_DAMAGE,
  Ev.SPELL_BUILDING_DAMAGE,
  Ev.RANGE_DAMAGE,
  Ev.DAMAGE_SHIELD,
  Ev.DAMAGE_SPLIT,
]);
const HEAL = new Set([Ev.SPELL_HEAL, Ev.SPELL_PERIODIC_HEAL]);

// Keys only: a raid pull has no keystone, and counting pulls would shift run indices.
const session = new LogSession({ raids: false });
for await (const chunk of createReadStream(target, { highWaterMark: 1 << 20 })) {
  session.push(chunk);
}
session.end();

const fmt = new Intl.NumberFormat('en-US');
const short = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n | 0}`;

for (const run of session.runs) {
  const { store, actors, meta } = run;
  const seconds = (meta.elapsedMs ?? meta.totalTimeMs ?? 1) / 1000;

  /** actor index -> totals */
  const stats = new Map();
  const of = (index) => {
    let row = stats.get(index);
    if (row === undefined) {
      row = { damage: 0, overkill: 0, swing: 0, swingLanded: 0, support: 0, healed: 0, overheal: 0, deaths: 0 };
      stats.set(index, row);
    }
    return row;
  };

  for (let i = 0; i < store.count; i++) {
    const code = store.code[i];
    const flags = store.flags[i];
    const src = actors.attribute(store.srcActor[i]);
    const amount = store.amount[i];

    if (code === Ev.SWING_DAMAGE) of(src).swing += amount;
    else if (code === Ev.SWING_DAMAGE_LANDED) of(src).swingLanded += amount;

    if (DAMAGE.has(code)) {
      if (flags & EvFlag.SUPPORT) {
        const supporter = store.support.get(i);
        of(supporter === undefined ? src : actors.attribute(supporter)).support += amount;
      } else {
        const row = of(src);
        row.damage += amount;
        if (store.waste[i] > 0) row.overkill += store.waste[i];
      }
    } else if (HEAL.has(code)) {
      const row = of(src);
      row.healed += amount;
      row.overheal += store.waste[i];
    } else if (code === Ev.UNIT_DIED) {
      const dst = store.dstActor[i];
      const actor = actors.at(dst);
      if (actor?.inParty) of(dst).deaths += 1;
    }
  }

  // This run's party, not everyone who played tonight.
  const party = meta.party.map((index) => {
    const actor = actors.at(index);
    return { actor, name: session.parser.interner.resolve(actor.nameId), s: of(index) };
  });

  const timing = `${(seconds / 60).toFixed(1)} min`;
  console.log(
    `\n+${meta.keystoneLevel} ${meta.zoneName} — ${meta.success ? 'timed' : 'depleted'}, ${timing}, ${fmt.format(store.count)} events`,
  );
  console.log(
    '  player                       spec      dps     damage  overkill    hps    overheal  deaths',
  );
  for (const { name, actor, s } of party.sort((a, b) => b.s.damage + b.s.swing - (a.s.damage + a.s.swing))) {
    const total = s.damage + s.swing;
    console.log(
      `  ${name.padEnd(28).slice(0, 28)} ${String(actor.specId).padStart(4)} ` +
        `${short(total / seconds).padStart(8)} ${short(total).padStart(10)} ` +
        `${short(s.overkill).padStart(9)} ${short(s.healed / seconds).padStart(7)} ` +
        `${short(s.overheal).padStart(10)} ${String(s.deaths).padStart(6)}`,
    );
  }

  const swing = [...stats.values()].reduce((a, s) => a + s.swing, 0);
  const landed = [...stats.values()].reduce((a, s) => a + s.swingLanded, 0);
  const support = [...stats.values()].reduce((a, s) => a + s.support, 0);
  const totalDamage = [...stats.values()].reduce((a, s) => a + s.damage + s.swing, 0);
  console.log(
    `  SWING_DAMAGE ${short(swing)} vs SWING_DAMAGE_LANDED ${short(landed)}` +
      (landed > 0 &&
      Math.abs(swing - landed) / Math.max(swing, landed) < 0.05
        ? '  → the same hits, so count only one'
        : '  → materially different, investigate'),
  );
  console.log(
    `  _SUPPORT damage ${short(support)} (${((support / Math.max(totalDamage, 1)) * 100).toFixed(1)}% of total), held separately`,
  );
  const deaths = [...stats.values()].reduce((a, s) => a + s.deaths, 0);
  console.log(`  party deaths ${deaths} → ${deaths * 5}s of timer penalty`);
}
console.log();

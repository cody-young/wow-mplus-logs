/**
 * The spells a player presses to stop a cast.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-effects.mjs`.
 * Built from SpellEffect.db2, retail build 12.1.0.69933, via wago.tools.
 *
 * Interrupts that landed need no table: the game logs SPELL_INTERRUPT and
 * names both spells on it. This table answers the other half of the question —
 * how many times the button was pressed — which the log only reports as an
 * ordinary cast, indistinguishable from any other until you know what the
 * spell is.
 *
 * The effect to look for is SPELL_EFFECT_INTERRUPT_CAST (68), and 603 spells
 * carry it. Most are not interrupts in the sense anyone means: Avenger's
 * Shield interrupts, and a protection paladin presses it on cooldown as a
 * rotational ability. What tells the two apart is everything else the spell
 * does — Avenger's Shield also deals damage, jumps to two more targets and
 * silences, while a Kick does nothing at all except stop a cast. So the rule
 * is subtraction: the 136 spells whose *every* described effect is
 * INTERRUPT_CAST. Every player interrupt in the game is in that set, and
 * nothing that deals damage is.
 *
 * A further 5 are added by hand, because the press and the interrupt are two
 * different spells and the data only describes the second one:
 *
 *   106839  Skull Bash — DUMMY in the data; the interrupt lands as 93985 (64 pairings)
 *    15487  Silence — a MOD_SILENCE aura; the interrupt lands as 220543 (18 pairings)
 *   132409  Spell Lock, sacrificed pet — INTERRUPT_CAST plus a DUMMY, so not dedicated (7 pairings)
 *    78675  Solar Beam — triggers 97547, which is dedicated (2 pairings)
 *    89766  Axe Toss — a stun whose trigger, 347008, is dedicated
 *
 * A button missing from this list costs only its whiffs. Its interrupts still
 * count, because those are read off the log's own SPELL_INTERRUPT lines.
 *
 * 141 spells. Only ids are stored: no names, no descriptions, no art.
 */

const STOPPERS =
  '1d2.ad.3el.ei.67k.a5.37c.8.1w.mu.6z.6of.ee.19f.b7.j8.1k.3n7.nf.l7.14v.5o.20.569.35e.4xc.4xa.13a.' +
  'f5.3m7.5wl.f8.84v.2p9.jy.1qe.10k.wg.69o.6we.80.6.hi.4rq.4t.3x0.1cr.1xy.be.x1.2b.2ot.y9.ru.272.24' +
  'y.2v.1ew.13v.2qz.41w.12q.1ew.9.1.6dl.1k9.4n5.193.3u6.31v.2y4.3vc.6ly.5sm.644.4ef.ah0.5v.4p.ab.xf' +
  '.4km.1mz.1ba.287.5ww.19l.1bo.1eq.rb.24j.53h.3if.1x.2n.us.1v.3i.1t.2l.555.1o0.1xa.2fj.2js.aw8.1lp' +
  '.7tn.52g.2gf.1c4.5w9.39w.2e.20q.2a7.fi1.4.ghw.bsk.4ya.6e.5u.11i.3d4.2r8.11d.oh.eyz.2fo.2m1.76h.1' +
  '9x.gpxm.bpp.41e.fdt.4sa.5iz.516';

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Set<number> | null = null;

function decode(): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of STOPPERS.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/**
 * Whether pressing this spell is an attempt to interrupt something.
 *
 * False for every id the table has never heard of, so an interrupt added in a
 * patch newer than this file reads as an ordinary cast: it goes uncounted
 * rather than counted wrong, and the interrupts it lands are reported anyway.
 */
export function isInterrupt(spellId: number): boolean {
  table ??= decode();
  return table.has(spellId);
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function interruptCount(): number {
  table ??= decode();
  return table.size;
}

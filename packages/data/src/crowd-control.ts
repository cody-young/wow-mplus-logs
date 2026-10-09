/**
 * The auras that take a unit out of the fight.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-effects.mjs`.
 * Built from SpellEffect.db2, retail build 12.1.0.69933, via wago.tools.
 *
 * The game has no flag for "this is crowd control" any more than it has one
 * for "this is a defensive", and the answer is the same: the aura each effect
 * applies. Seven of them mean the unit is not fighting, and membership here is
 * a fact about what a spell does rather than an opinion about whether it
 * counts.
 *
 * Each aura was confirmed twice over, because the number on its own is a
 * guess. A witness spell carries it and is unarguably that kind of control;
 * and the mechanic column agrees — most rows carrying these auras also name a
 * mechanic, and it is the matching one. Two independent columns saying the
 * same thing is the case for all seven.
 *
 *    12  stun      Hammer of Justice                        STUN on 1351 rows
 *   298  stun      Asphyxiate, which carries no other       STUN on 17 rows
 *     5  disorient Blind                                    DISORIENTED on 189 rows
 *     7  fear      Psychic Scream                           FEAR on 222 rows
 *    27  silence   Silence                                  SILENCE on 131 rows
 *    26  root      Chains of Ice                            ROOT on 355 rows
 *   455  root      Entangling Roots, which carries no other ROOT on 46 rows
 *
 * Stun and root have two aura numbers each, and the second is not spare:
 * Asphyxiate carries 298 alone and Entangling Roots carries 455 alone.
 *
 * Slows are not here, which is the decision that shapes the table. A slow is
 * not being taken out of the fight, and MOD_DECREASE_SPEED cannot tell a Ring
 * of Frost from a paladin standing in their own Consecration. On one real
 * evening of keys, including it put Consecration top of the chart at 1,430
 * applications, then Grip of the Dead (1,058) and Permeating Chill (891) —
 * three passives, none of them pressed, between them nine times all the hard
 * control in the log. Left out, the same log reports eight spells and every
 * one is a real press.
 *
 * Asked of the wrong event this answers a question nobody should rely on: an
 * enemy's stun on a player is in this table too, and so is a mob's root on
 * another mob. The pairing that makes it mean "the party controlled
 * something" — a debuff, cast by the party, onto something that is not the
 * party — is done once, in `crowdControlReport` in @mplus/analysis.
 *
 * 6748 spells. Only ids are stored: no names, no descriptions, no art.
 */

/** What a control aura does to the unit. A spell can do several. */
export const Control = {
  STUN: 1,
  DISORIENT: 2,
  FEAR: 4,
  SILENCE: 8,
  ROOT: 16,
} as const;

export type ControlKind = (typeof Control)[keyof typeof Control];

/** 4213 spells. */
const STUN =
  'p.v.19.8j.84.a.a.b.2w.i.6l.v.i7.1l.mc.6r.6d.y.2r.l.2k.2j.2x.1m.q.1.bw.1.1.1.1.1.d1.fs.1m.1b.1t.a' +
  'c.1.1i.5.i.1.5b.x.8e.d.12.2x.n.3.v.1m.1k.r.1l.1s.2.j.5.g.3g.x.1j.2s.1l.er.3p.4e.3.3.21.32.1.1l.y' +
  '.17.2y.8.6v.4r.2c.1.2k.4l.2p.5i.4.q.qv.ft.bc.2.e.11.4p.56.14.66.8z.14.27.3.j.4s.4c.37.6g.1.2h.70' +
  '.6d.2m.5.5f.m8.9q.v.70.1m.p.3.v.3.2q.3h.2k.23.u.l.8.6u.2t.1.19.2v.3j.1r.8.5.1u.3y.7d.a.7.e.1.2i.' +
  '2m.8.gr.15.6z.a8.z.e.8s.8.6c.m.73.3k.b.4.2g.5e.5u.1.7k.1u.1c.6.e.2.8g.32.1h.f.l.h8.13.3z.8b.2.1u' +
  '.1y.2k.16.v.1n.15.b.49.1j.4.58.4m.15.2.1g.2i.cx.2t.s.41.k.3c.2.14.j.e.5c.1s.7.f.4.8.28.x.6t.3p.5' +
  '2.1i.2i.3v.1z.v.i.1b.v.6y.26.g.9w.hd.ag.c.1e.3z.1e.4v.40.57.9.c.3d.1u.5n.fz.3h.1n.6.l.5.4a.6.3.5' +
  '.6.l.55.7.5t.3.2t.1.1u.4y.4g.10.v.21.t.16.i.13.2j.6.1o.5n.p.i.6.4.2g.i.e.1m.1p.7.1q.30.f.m.1s.o.' +
  '2h.w.u.l.6.2.29.1.19.4t.12.1j.4s.1u.2q.r.2d.q.f.67.35.2j.3n.o.1j.l.22.20.20.5.6.3j.i.27.7.1.2c.3' +
  'r.36.49.32.15.1j.10.58.1z.8e.d.1k.16.42.18.4p.4u.51.5f.1x.1b.1o.i.37.t.1p.2d.i.r.f.1b.2g.1p.19.2' +
  'e.1.1.4j.1c.2m.g.1t.76.l.1c.2f.3.e.1.1.o.1e.1.1.1.1.1.1.1.1r.1u.5q.k.1c.1.18.6l.20.1c.2j.f.1o.48' +
  '.9l.k.s.1a.6.4j.8a.14.9.26.19.e.11.m.32.7.6.1o.f.j.1e.3j.1p.b.i.20.f.3o.2r.4.b.g.8.1f.2.1s.1f.7.' +
  'p.1b.1o.6.1m.aa.5o.1.4e.32.6l.n.s.hd.8.1n.1.w.1z.9.2c.13.7x.5m.52.2n.39.a.5.62.2z.4d.2l.27.2.1v.' +
  '45.1l.2q.d.2h.5k.1z.1r.e.2.4d.5.1f.1d.r.70.n.4s.3p.3w.8h.a0.i.i.10.9z.3s.b.a.34.64.gj.3a.9.e.3h.' +
  '3r.1n.1o.2v.7a.3q.a3.3q.t.38.40.d3.77.2.4.ax.k.12.1s.1b.2c.1j.14.28.o.13.1k.n.2.m.12.1g.1.3.1.6.' +
  'c.1g.v.1e.1k.1z.2n.1e.4w.q.9.2q.1j.3c.7v.1.2o.7.1s.7c.1a.k.5t.8i.1o.15.2a.g.54.5w.7u.b.t.1.n.cd.' +
  'l.11.5q.1k.4j.p.fd.6o.d.1h.1o.7d.z.5h.53.t.2s.1.2b.24.p.1.2q.a.k.1q.8.2n.n.4l.2v.28.1f.1b.26.g.4' +
  '.h.3v.5m.7.3.w.3j.7n.3n.6m.28.2q.7.26.r.1i.7f.3t.y.60.3.2f.1.l.1g.5j.1k.d.6.g.2d.3.1v.5u.6f.19.4' +
  '7.2w.70.1o.8i.5i.2p.a.m.56.3b.4r.k.34.12.2r.o.t.2z.r.8e.a.12.2i.8q.i.15.b.2.24.1.4.7q.39.2z.j.d.' +
  '1.1u.1y.6.29.30.m.14.hn.1.2.4n.i.6.15.1m.m.9z.88.7.5h.m.5t.2d.1w.i.1z.e.9.3f.3r.l.1c.15.1w.o.3.5' +
  'f.72.11.5.f.2a.3s.2l.f.t.e.1k.6.3s.d.1q.1.1.1.1.1.4e.40.3r.w.z.26.43.2.m.1.3.2p.14.t.2.1.1o.30.5' +
  '.s.3h.4b.1v.74.75.4c.46.1.dv.5l.5.6.2k.s.1.a.ar.s.2p.m.23.s.2t.1e.67.6h.28.m.g.10.m.v.3y.3k.4t.x' +
  '.14.14.m.34.d.y.2h.12.15.1k.23.d.9.8.8.9.1f.x.1d.1b.3t.10.a.9h.3h.m.3f.1z.2y.h.22.e.14.7y.1s.w.b' +
  'h.68.5.22.39.1e.12.n.8e.6.4.m.1e.5.12.1e.3s.1.1.2w.1s.it.z.t.1e.5d.1c.17.a1.1l.1.b.1n.30.9f.2.4e' +
  '.d.k.41.6r.1f.k.v.g.o.l.29.6d.6.4o.ev.23.26.1y.27.2y.8x.5s.1w.1h.t.y.39.18.50.4c.c2.8t.6w.1b.3.3' +
  'w.s.3n.n.15.14.y.cw.2i.6o.47.4r.1v.3.a.4o.31.1.3c.9s.24.a.4w.h3.23.1i.3.1p.c9.3d.2o.bj.7z.63.8t.' +
  '1z.3.1k.35.9.1.3d.92.cu.7j.14.3i.1v.29.3t.3k.m.1i.38.137.3e.s.e8.3g.7.k.3b.1m.3a.29.32.e.7.2o.g.' +
  '2.i.m.25.36.4e.12.8y.15.a8.3n.e.8i.1n.mc.1c.7e.1d.10.2q.2l.30.2.44.cm.i.2e.5.1.6w.x.5.23.7u.z.1o' +
  '.5p.25.5e.y.6q.2j.5.c4.3.1.4w.3l.fu.3s.1i.c.6x.3s.8g.34.4v.c.j.4n.57.8e.5.1o.1h.2.ll.2s.2k.y.1h.' +
  '3u.1x.7j.n.2v.46.7m.bl.2e.1q.9w.6r.21.1x.hk.9c.1e.j.4.1.3b.2f.o.l3.3x.c5.12.z2.d0.bu.7a.3t.c.3y.' +
  '14.3r.e.i.1y.76.59.17.k.4q.k.6p.1a.4v.6e.88.3a.2y.1y.80.3n.8m.54.1r.42.3z.g.8g.2g.3e.5j.6l.3g.w.' +
  'q.l.21.90.1.3l.c5.3u.2z.5j.4m.1z.8j.e.4m.in.3k.e.b.8.m.38.1.3t.m.5v.8g.d.a.1z.a.3.a.1.1.f0.54.16' +
  '.2.13.gq.d.6.e.1w.c7.3c.2b.1d.g.5b.2b.13.r.1y.8r.2l.4d.1a.2s.2k.c.h.e.3.5m.m.2b.4q.13.h.h.71.2z.' +
  '4.1i.1d.v.u.3g.31.1.1c.8.3j.1f.k.1k.1.1.1.1.1.1.1.1.2.1.1.1.2.v.y.1p.ik.1n.j.4.o.3l.2.2q.71.2v.2' +
  '3.2v.3l.1a.36.u.2y.3.2h.g.v.63.99.76.ac.4o.ba.1.5b.1.1h.5n.6a.12.d.l.7r.1b.o.51.3p.1.8.1.u.5t.1z' +
  '.2o.4t.3r.1.2i.3.5u.70.2s.2.7.y.32.s.6c.17.l.2p.13.1v.4d.g.5.bj.4c.3q.1e.5z.2g.t.e.3e.3.19.1i.3i' +
  '.2.6l.1o.7u.13.z.7l.1s.9o.49.1s.1m.31.u.8.2t.5r.18.t.1o.1o.n.3m.i.3f.44.l.4o.17.11.3p.1x.3p.h.b.' +
  's.9.13.40.78.9o.v.21.1r.3.3.25.b0.u.1b.48.27.3n.6q.1i.47.es.3j.7l.24.4i.z.5c.6e.5.18.o.1u.13.1q.' +
  '1b.1.g.80.1n.1.2h.1b.43.2l.2r.97.7.3x.27.5s.13.1.6.23.1c.4l.a.7e.9.57.2a.n.56.10.1j.n.c.2.3.q.1.' +
  '1.2r.7.1h.31.l.d8.1.3m.g.4.1r.b.7n.33.l.3b.3a.3v.2y.23.2s.w.m.4.1b.31.1o.t.13.e.1w.d5.d.2x.k.q.1' +
  'b.54.24.3y.51.o.3o.6o.b.10.11.5d.7b.2b.19.1r.9p.25.32.79.17.g.1p.9l.9c.27.3g.b3.58.m.3p.46.69.2m' +
  '.3z.10.3e.ev.1.30.ma.50.4.c5.be.4l.9.14.2d.6a.87.2e.25.96.4y.2d.4k.3n.12.1c.4.15.10.19.2p.x.2t.3' +
  'z.6o.7z.69.br.2c.3p.1.k.y.g.2s.34.4p.2y.k.3m.d1.7d.7.gb.16.1m.1n.3x.k.4.1c.14.3q.1e.46.39.a.cr.1' +
  's.k.39.a.38.4c.1.q.k.q.5f.10.6a.9i.1d.b.2n.z.3.3.3o.4.46.3.5e.23.x.4o.14.2x.1e.4.25.61.18.8.1n.m' +
  '.j.5a.8.1o.3q.48.7.2u.24.8.1b.1.8.7.1p.1t.3r.1.1.1.1.2.s.p.1y.w.6x.1u.l.1q.y.2r.12.i.3c.3n.5q.5.' +
  '2t.o.j.1m.17.26.18.1.1e.2g.7.50.q.7k.44.3y.1.l.aw.75.2.i.1t.5.z.4c.1q.2.8.2s.y.i.1d.4f.r.bu.2q.r' +
  '.1m.24.18.9m.1a.10.5.c.17.b0.6j.1o.c.l.2m.1v.9.2j.n.w.t.1l.48.10.g.1e.y.b.1u.1w.1n.16.h.16.23.8.' +
  '6.1p.y.1.41.2e.y.a7.am.2z.2.dn.db.1w.b.h.e.7v.1u.15.1.cm.1.ir.6c.4w.6h.d.39.9r.1.4k.14.4l.1z.n0.' +
  '3s.n.7w.7m.8.28.3c.27.3e.w.v.1e.2d.1k.2k.v.3e.5b.6s.7.2h.5o.3p.t.66.w.3y.n.1l.3.1u.18.c.31.am.85' +
  '.1.v.7e.2j.4l.3m.4p.6.1m.8.27.83.5h.4v.3q.2.6a.ao.4c.3t.v.1h.4.1.4x.e.3.i.g.z.p.1.40.8f.6i.m.1p.' +
  'ab.3b.18.4n.8p.x.4a.1f.x.2l.5i.1y.2.6r.z.3a.8p.m.6.9v.d.8f.5k.c.38.1l.1i.2s.1g.4k.3r.69.54.8b.42' +
  '.3g.5v.z.1b.c.6u.3w.b7.c.1s.4o.1b.4q.2r.1f.43.1w.26.5o.1.1s.21.6.2a.2k.5l.g1.9y.4w.73.6a.75.5.15' +
  '.89.u.4.1p.4y.2.49.4x.1g.j.22.45.m3.4x.z.k.2d.4.g.1b.1t.1.10.c.4p.3n.i.2p.2j.77.3.5v.35.5j.h.s.c' +
  '.2s.38.n.b.1.2d.x.3c.5o.12.n.n.4w.1m.u.2y.3s.6x.1g.1f.7d.o.2y.2k.2.65.7f.1x.q.29.23.5.6.n.47.5r.' +
  'm.52.1s.du.u.66.6.4b.da.o.t.1k.61.2b.z.22.2u.4b.5n.5e.2.4c.10.d.3q.a.4s.1j.i.d.2z.1r.3q.1.19.7a.' +
  '20.9u.48.65.1z.4l.1e.46.2e.5.13.1n.27.17.60.5g.b4.1l.1.1s.9.2i.p.6.1v.o.82.1m.6m.1u.1t.24.10.cg.' +
  'g.10.3u.p.4.57.3w.h.2v.2t.6g.c.7.63.s.1e.18.1j.1h.6p.8h.f.6a.3.2y.3k.3x.2b.3k.50.3m.7s.d.28.9.5.' +
  'h.8.p.7o.1k.j.q.29.2j.3k.j.3e.h.5g.13.1c.3j.m.6h.1u.1g.56.3x.1k.1q.14.5e.2f.5q.4c.5m.z.55.19.ba.' +
  'k.l.26.48.1u.3x.6.40.1z.12.20.1o.h.6w.30.d3.11.23.1f.g.59.3.n.s.1e.2s.4.3k.27.a.s.7y.5p.q.1j.1g.' +
  '2.1m.4n.4u.2p.6s.1.40.2o.bz.o.y.6s.w.1l.9n.11.m.p.40.4t.8.7r.1g.39.v.6e.d.20.42.q.69.8h.io.22.1x' +
  '.3q.gj.20.39.1o.2k.36.10.7u.1d.7o.3f.1j.1s.a4.9w.8t.4x.8l.bf.r.35.n.5b.nu.4p.28.1.54.a.1t.1r.a.5' +
  'i.3g.d.7.83.49.53.57.aa.4j.u.i.6j.o.7u.j.59.1c.f.c.w.v.18.d3.ni.4f.95.24.i.8a.d.21.68.24.b.6k.4b' +
  '.15.3.11.f.j.6.1s.4.2e.v.1v.13.ba.13.a.4q.25.6l.1z.5i.35.an.19.1q.2m.5p.7v.3u.3j.2p.z.d.1k.a.t.7' +
  'q.a.7l.2h.1w.38.x.23.h.1l.17.b.2g.8c.d6.v.9.4f.59.29.4w.m.1i.8.ae.3i.75.2v.7.30.2k.2o.r.6b.z.3t.' +
  '3.h.3s.g1.6k.7k.b.2b.35.a0.4r.3a.a.8.7l.94.h.5y.u.95.3i.m.4d.10.5d.ev.1a.1x.3.2.2.40.2g.9.7.33.1' +
  'y.d.9m.1m.3j.b.1.6i.23.2j.1x.2n.4i.2a.r.c.35.17.18.10.2g.7.17.gi.1.1s.8t.u.3e.3j.q.1y.19.h.1e.25' +
  '.v.j.8.2g.33.2.1h.p.6k.o.2w.4.x.h.1.l.1y.e.t.2.h.2d.4h.18.5j.5.9s.f0.1l.l.d.5.1v.1j.21.13.17.3g.' +
  '2.4b.r.1y.2g.2i.6q.7y.3n.1.7.a.1b.1n.x.5u.c.s.5m.r.43.1x.36.19.2j.4.u.13.3l.p.5x.7m.1s.86.1d.2.q' +
  '.b.e.w.5k.j.1d.i.3m.13.27.fd.2t.1d.a.5k.1p.2.u.8.1o.6f.a.k.22.1r.3e.r6.45.1q.14.1.io.72.1t.6.4v.' +
  '3r.4.2.2.1a.11.5.9v.5j.6.o.2f.5l.10.1t.7g.95.e.3c.6l.10.1.1a.2.1.1.2.1y.ch.t.u.i.2h.aj.s.9z.7m.9' +
  '.23.8g.1y.2s.4f.25.8k.6.2o.64.1g.6y.3x.66.1.1.d.30.9u.3x.9.i.4l.f.50.j.2a.2y.3a.18.2p.1p.24.4w.5' +
  'r.f0.1.11.42.4p.9.65.1.3u.z.hg.t.a.1h.2e.7l.24.o.1v.2.1.2.1.1.2.1.1.1.2j.1b.6.2n.54.ed.2d.3u.1a.' +
  't.f3.1.10m.l.2y.1m.h.6j.1c.13.3t.5.2f.n.59.1j.1q.1w.1f.dh.1.8.11.6.63.15.85.4i.3.1j.c.8j.40.1g.3' +
  '0.2p.27.x.4.4r.7b.4.2l.1i.6s.1w.6e.27.4.6.1s.4j.1e.6c.69.10.2.r.5h.c.h.c.1l.3s.50.9x.1r.r.5.4u.3' +
  '.3.1s.1s.5a.4i.21.1p.2i.15.dz.4l.q.3k.2.7.2.a3.48.6.1.1.1.g.3e.1k.fv.ef.1f.d.6y.3.27.41.5i.n.15.' +
  '4g.gx.2k.l.au.58.c.28.l.1h.z.t.28.p.22.1j.l.1t.3x.v.w.1w.2n.14.k.60.3q.8y.3n.w.1c.1.1.27.10.6o.7' +
  'j.2d.22.3.h.4w.7f.17.bo.7k.8.7.1t.q.3m.5.d.2c.33.1b.38.3w.98.7.1o.22.6q.2c.8.5b.1.3.d.h.1.1v.3g.' +
  'eq.6.3c.20.3y.77.fl.52.3u.3d.2z.76.2t.as.58.q.1v.27.1s.w.2n.61.26.7.5f.8z.2u.a.4s.1z.1.15.c.18.w' +
  '.7.3j.10.k.6.cm.25.7e.1.p.36.6.6d.4u.4v.2m.28.17.1n.1b.1h.11.d.7.2i.ah.8n.8q.5j.5p.r.8e.28.f5.s.' +
  '6u.3s.11.3b.6t.37.d1.7x.eg.51.gi.a9.2x.i.4j.16.2q.2y.3w.1a.3.2b.3s.9y.36.4c.4p.3.1z.1.2s.w.3c.11' +
  '.4.1n.7c.as.5v.3i.4h.5p.s.r.4b.6l.5q.5y.1s.1c.as.2.v2.bq.m.11.v.2b.y.4.35.18.10.eh.2u.1h.7r.c7.5' +
  '.2w.90.68.2a.2.3r.c.t.3.ae.58.1p.37.1o.e.8y.21.cs.48.x.6h.bc.2r.2b.1e.g.h.4m.9n.19.28.dv.e.3.1d.' +
  '4w.l.2f.1l.23.e.2b.1.21.40.27.1.4a.18.l.b.2c.4.q.7t.30.v.d.41.2.1h.7v.7d.34.4v.2.g0.2f.7s.11.77.' +
  '9r.59.2w.1s.1y.27.6z.8f.9d.4m.4a.t.1y.8w.1.d.4s.1e.1m.12.3.1y.b.1j.1y.2h.3y.69.1v.6n.1n.2b.28.fm' +
  '.q.62.7.15.25.7.1c.45.2l.u.1.1h.38.6q.f.9v.o.7s.2.4u.13.3g.2z.9.46.12.4.du.2o.f.h.34.h.18.r.2d.7' +
  'f.49.s.5g.78.27.8.7j.o.39.5g.2h.h.90.1a.u.1n.2h.1a.1w.2v.2m.2w.23.5z.2u.1a.ac.1v.h.10.b3.m.2d.k.' +
  '1x.a.hf.2n.24.1y.2d.3.1g.b.2c.3c.t.1h.2e.f.3x.2i.92.29.tk.4t.14.98.d2.5r.16.r.i.13.5p.25.ak.31.1' +
  'j.5.3c.3z.3t.42.s.14.66.1.f.6n.m.1b.1d.r.2d.2l.v.8o.3.14k.71.27.h.1.1a.3m.1.1b.3p.di.1i.1.8l.r.a' +
  'h.71.4p.16.2.w.7j.5.2l.3i.1e.74.f2.1b.1w.1m.5r.1x.46.1u.1n.4.4f.6h.6.3i.11.b.q.o.z.6m.7.3v.5.1i.' +
  'r.5x.1q.u.1c.o.12.1q.4b.3p.4f.1s.2.23.d.4z.27.11.30.60.10.4.1q.15.1d.25.4r.2u.1o.3o.6.7s.i.8i.14' +
  '.bi.4k.bc.37.v.66.bd.2b.20.1g.42.4r.8.1a.2h.2b.8j.33.4f.7.3z.1l.8d.4s.2v.4n.ab.dt.4n.e3.36.1n.d.' +
  '3w.o.3g.2b.1u.6x.3c.y.2x.9.n.9.1h.t.6.3k.36.2k.3h.ig.6n.d3.as.4l.y.1z.2r.6p.81.84.3w.1b.6.2t.1t.' +
  '1v.j.5c.cn.1.77.hm.21.2z.1n.cl.3a.2b.3c.19.2z.8j.q.4s.1u.4g.7l.j.1h.13.44.4j.fk.1o.1g.4x.5.5m.c.' +
  'ad.62.1f.46.4v.j.5d.1y.59.n.8l.7f.1y.13.1.2.57.4a.1v.4e.5v.22.1b.2e.4n.2e.18.b6.17.1tc.5o.fr.8b.' +
  'dr.t.b4.l8.1p.18.68.2.9.1z.39.6.s.4x.3b.63.24.10.4.28.2k.7l.8w.f7.1c.47.9l.64.26.9e.2r.b6.5u.1l.' +
  '3m.39.i.fg.do.10.x.eq.19.10.22.g.6i.c.17.14.1l.11.f.1g.18.6g.s.7.7p.50.1u.13.c.5.2t.4.5p.5n.1n.2' +
  'q.54.4m.cl.21.2g.t.br.g.1k.5m.3c.1m.1b.2l.1d.1.4g.1x.4.3.74.1.2c.1q.13.3j.14.r.a0.3m.60.39.f.9.3' +
  '.1d.c.3p.33.30.1i.u.d.6m.5.34.1.1.o.1.1.1.3u.bn.2e.9z.3.1e.y.1c.2c.1h.2a.54.2e.51.6.4t.lr.2v.18.' +
  '3g.9d.v.2b.9.2.52.72.x.5c.di.5z.du.47.8m.2i.b5.22.8r.t.dp.f.3p.2z.16.w.2w.1c.c3.6j.79.1x.3d.2w.1' +
  '.9.1.2i.5k.2c.48.8f.29.54.3k.2b.sx.bt.75.au.30.5h.lm.10.3r.gg.il.83.as.1x.8v.1z.b.d.32.13.4w.hc.' +
  '6f.5c.9c.g.12.9u.49.iu.n.l8.e.5e.1p.6w.3m.2b.t.6e.2v.2y.11.1w.2c.1.3u.d.h.4t.1.an.ah.2z.6j.14.2o' +
  '.3l.u.lz.y.1h.6v.54.16d.5d.f4.jb.5l.1p.3i.63.28.8.6g.pu.22.6m.2k.43.l.v.3.br.4a.35.a.2e.2.7w.3l.' +
  '2y.9x.1u.11.3h.1n.3q.1.4b.1c.6u.1m.8l.1i.jw.67.6k.ur.b.7m.i.d.6a.di.1v.11.ge.bd.90.5n.65.k.2.2.4' +
  'a.28.1.2.1d.4.55.f.2m.3q.j.bi.51.bo.1vk.5s.5e.4x.1h.1r.au.j9.1s.fx.4p.28.1l.37.2.77.j.v.32.3g.ab' +
  '.8b.4t.6.37.6r.6i.1t.4b.6i.9g.9w.3h.2ih.7f.10.32.8e.3c.ia.w.2d.bt.3q.5.3j.2q.1d.30.7f.qn.ft.f.1d' +
  '.2t.35.7w.36.m5.1e.c7.38.nc.h.a3.ae.43.3r.y5.1c.ct.14.p.1z.l4.54.5.d7.3v.3i.j.1y.ce.2.12.d.75.sv' +
  '.k8.1g.8o.pr.80.2q.84.4y.s.4l.13.2z.2b.1n.19.3w.2n.w.3c.1e.5w.49.1i.i6.a9.3.bc.c5.41.1o.2m.4m.1v' +
  '.e.2u.e7.5j.69.35.22.2f.20.9a.2o.ag.8i.13.2r.2p.7s.51.7z.by.3x.3h.29.1c.1b.5u.60.n.4f.h.34.3q.t.' +
  '24.fu85.r.20.bv.3l.ds.e.g.7g.39.1o.1.1p.19.t.7.s.5v.6c.1s.4u.38.7h.5s.31.ki.8.c.z.u.1h.bq.3l.1q.' +
  '5e.3.2.3x.51.34.bk.1k.4p.t.o.f.17f.yc.wp.89.15.88.ka.57.73.ei.1o.2w.86.8e.16.4e.3f.2w.ed.gr.12c.' +
  '2f.xy.1k.fq.n.gh.9w.56.rw.4l.el.2f.1k.fs.cw.db.fk.py.cq.g4.7.d4.af.ad.5u.ap.32.1i.th.f3.8k.1.6.1' +
  'q.2l.bk.47.65.26.4z.3e.4y.16.e7.60.c1.g9.80.6.9j.b.h.45.1j.63.2l.1j.1.1.1.1.1.1.1.1.1.1.1.1.1.l1' +
  '.31.gj.dj.2h.d0.lx.b.c5.76.1y.fp.5l.3y.15.3p.4r.tv.4o.m.6a.2z.2d.3z.1a.3e.6t.24.11.19.8h.4y.6k.p' +
  '.7i.6s.8v.3v.m.5c.7n.x.1i.a.i.96.i.2q.1i.1g.j.6l.4a.2r.17.q.3q.3q.9b.2p.j.5y.1e.3o.4g.f7.1q.u.as' +
  '.he.6l.3o.1u.12.ic.36.cd.3j.t.ii.2n.48.cf.2j.e0.9v.4h.5u.7u.85.1b.f.3.13.1.3x.1w.3.1v.c.5.d8.5e.' +
  '25.1jh.20.13.5n.2.3d.1v.3.1v.5y.19.l.hc.2e.38.2.a.5t.1r.4z.z.z.cs.ah.34.1a.a8.40.e.df.1xt.23.5h.' +
  'c0.1.10c.a.86.i.3o.du.3j.r.6a.1.dv.1ge.bz.16.k.13g.1n7.2v.up.kl.m0.fa.d.59.18d.sf.6.5w.1.5i.9m.3' +
  'q.5w.2.b2.93.uz.3.89.c0.d4.3f.2i.ih.ga.15.bt.b.zn.34.lo.7p.9e.1qz.9j.62.21.1o3.3d.4.9k.q7.3q.l.g' +
  'a.34.55.3x.1dg.9g.b7.rr.ho.5c7';

/** 555 spells. */
const DISORIENT =
  '2r.j.1iw.7d7.1aq.4l.1ku.fn.gy.1.1.2o.a7.fq.l9.o2.i2.sx.xq.84.cp.g2.2.ci.1l3.19w.e7.1.lg.mc.37.1.' +
  'oa.mv.l4.kw.14q.f.14.9v.5l.14a.3q.6.4y.7j.qk.i3.b1.ur.2j.nf.1r.t.m2.2s.1o.gg.9d.3g.rj.n4.2e.q2.f' +
  '.aq.l5.81.mz.129.m6.iw.uv.pf.va.2va.72.n0.1a4.7s.bk.1n.27n.7.vv.4f.2b.mr.1ua.ta.30.p9.bz.z.dl.1a' +
  'x.4u.8v.7c.1mc.6.o5.m4.u.i5.xk.iu.a8.1ny.5a.28z.24w.m6.40j.rf.qd.1px.1lg.2vk.12z.d.1.s.6.58d.co.' +
  'ua.r.du.1we.1iu.4ox.2w.d6.tn.1ss.268.94.13t.b9.bt.m5.2lt.261.5.4.29i.j0.1pp.k7.1r.lz.2hc.n2.oy.1' +
  'k.j.26a.gl.18b.zr.1.1.h.bo.qk.ai.11y.bl.sc.5u.my.rh.1n.1ev.4s.20a.dc.n.1f.2n.kt.z0.ps.r4.29.m5.6' +
  '.cd.d.3.xo.pa.4o.tt.4up.jw.7c.c7.1wq.2oz.hm.16v.pf.1iy.be.y9.wf.3q.b9.v1.9i.1c0.45y.uk.q.gw.qp.r' +
  'e.gf.13l.4s.ht.8u.1.4.1.1.1.1.1.1.1.1.1.z8.18u.3m.1w7.2e7.6m.2dp.1mc.3b.wb.1j1.1je.9d.67.ph.ar.6' +
  '0.ew.dh.w.87.3.gy.oe.10g.va.5f.xe.5i.xy.1l.10m.6u.h9.19o.pr.z.ce.ah.6k.90.g7.36.3n.2g.k9.9n.8t.a' +
  'h.9m.3s.gg.1h.16.1x.sf.13m.89.7n.9v.vb.4w.92.bg.1q.d9.b8.6.j8.2z.ob.2.r8.97.cq.71.gh.78.1v.1e.6c' +
  '.g.39.ni.6e.7w.10.49.k5.5l.es.99.8e.lf.b2.bs.ae.mm.1.5l.6u.3f.bg.1.4.1.7.1.4k.8x.ei.1.hu.b.bb.5d' +
  '.9w.24.i.2q.2.8x.1.1p8.e9.1e9.zk.4n.7.71.r3.2.in.gs.6a.1cq.m.2a2.o1.sp.1kc.p.1no.1c5.1iv.64.8r.1' +
  'a.163.4n.wf.pg.o6.6y.hb.yr.f1.1c2.hb.1zp.1tg.1dh.5z.1a.c1.3w.n6.91.a.to.4s5.5a.g.pp.99.kj.1e.10p' +
  '.97.kw.st.ln.38.25.cb.10t.kp.g3.1b.7a.3g.f7.6b.gx.f3.d0.1by.co.q4.5dr.14.5t.rp.1lo.n2.7b.k0.2g.1' +
  'b9.u7.2km.d8.qz.25.6k.aq.12w.1eh.1l2.fl.rb.2w6.9e.6d.sv.21d.24.1a2.2i7.1s1.72.c5.1qq.9.1ne.1v.pa' +
  '.8o.sc.7u.w.3k.c5.7o.1.1.5qk.zn.m1.4c5.a.jw.126.jp.am.1pr.4o1.ud.35.ad.ba.1id.b1.51l.3sd.2as.3kc' +
  '.10i.91.1hk.46.9f.6e.8h.b1.fk.1tf.21.13.o5.kr.2l.xy.11a.oo.4.ud.2zy.1e5.1dm.n8.fyfl.3t0.ctz.vp.6' +
  '2f.3b.g8.1jj.2o.7if.vv.28.4dh.1l.y.qu.cr.yu.2i3.rh.c.5ej.dx.79u.3xo.kz.1fj.ek.dm1';

/** 662 spells. */
const FEAR =
  '161.2sl.34.6m.oa.62.t.54.8g.8i.k3.gh.18r.1d6.ce.1z.ob.60.b0.1uw.1hf.jj.7m.8t.18l.ez.t.lo.8.5i.av' +
  '.bj.17m.ff.6b.2.5.l.e6.1p.qx.v.9p.91.2p.l0.49.2q.3h.3x.8t.du.u.1i.v.3i.b.79.av.fq.1y.5l.d0.bp.bl' +
  '.6q.3r.9b.1r.37.f7.5y.7o.w3.85.s.rh.3i.2h.2w.9d.1t.7x.1.2u.1z.1l.y.5p.c.6i.71.8j.12.ah.c2.28.7y.' +
  'yu.4z.fn.4e.fc.k1.si.ay.x.6t.r1.gy.fc.be.12n.de.79.2v.3g.aj.188.l2.1pc.vq.138.1k9.s9.1eu.1f.e1.w' +
  '5.7e.b.32.ha.1da.hc.vl.f.1x.1nq.36.hn.1r.yr.2g.p5.ce.5p.2oy.1hg.10c.db.of.76.18g.ye.1uj.l.18g.jt' +
  '.19w.3ct.lq.r4.3m8.778.14y.2pl.1hm.1no.2k.1.4m.o9.q4.9v.ct.2l.s.1kj.7p.27.3c.xh.2w.e5.dx.8j.3rq.' +
  'p7.78.tk.ei.1ha.5d.153.ep.5n.192.1m.dz.zq.qz.20s.ir.18w.1n0.vb.2o.18j.6r.3b2.rm.1c7.m.103.3w.7f.' +
  '90.er.6h.90.m7.t6.1bv.1hu.1ms.5p.c1.l0.14t.5l.1tx.qf.2x.8g.m8.2m.b7.3h.i0.m5.6jv.157.35.gk.1es.g' +
  'k.bt.12.1ge.mp.4j.4z.77.1sr.4o.dg.3y.kd.w5.pn.z.2sr.xe.a.7.5t.oi.1ub.d3.a6.10.f5.ct.kh.hl.170.7o' +
  '.u.7p.ri.7.db.7h.1.ej.65.aa.h1.1b.6y.80.24l.8s.1i.6c.he.pe.1ia.yd.2.vl.19q.az.2il.3j.1i.64.gz.9.' +
  '5o.k.18.lu.8j.99.f.pr.1.b8.iw.bk.kf.8l.1eh.2x.uz.hr.b2.64.ld.1v.26.ps.bw.p4.7l.j.87.lj.96.va.io.' +
  '2y.6b.81.1lv.3d.rf.fu.11.2r.1o.9.11.ah.pe.jc.he.dl.gb.13v.lq.15a.53.bg.54.6u.6t.3p.v.hh.h4.ko.j4' +
  '.3t.c1.8z.2v.12a.92.y.3y.ee.bo.36.37.i.16k.e7.of.1q5.4t.27s.29.52.qj.gf.10b.m1.y.go.1al.wt.3q.nw' +
  '.fj.t.pe.fj.r2.q.1eq.nx.25q.1.s1.u.24.24.ye.cd.ec.eh.3m.5n.ox.ka.1b6.4m.ma.9r.4g.cn.141.l1.7q.3n' +
  '.11h.6w.am.2.1u5.1x.177.e0.1g1.zq.u.a7.op.2h3.hs.2.5u.8y.cq.1e.6o.1d.xa.6o.1sb.9f.1lm.jl.19j.lx.' +
  '39.9x.77.rg.2l.2x.tz.gp.2c3.6a.7g.3w.2g8.5b.8h.2e.p2.7h.ey.1wb.d2.9h.ny.6m.7q.f2.r.34.6t.4c.48.6' +
  'a.zr.ia.76.1a7.2hi.j2.o1.15z.1px.wd.3g.a1.e1.17o.10r.vf.2jx.wi.fu.ug.rx.le.jb.r.7y.ou.vf.k5.s8.r' +
  'k.yi.eh.175.4v.2e.a5.1n.f2.z.4u.12f.1.1.1eh.ro.1jl.ju.1dt.6y.14j.1w.4.bt.1ku.14w.v3.rm.50.1w8.1s' +
  'm.7a.28.bu.1a.1o.sh.2uo.fw.zg.6c.uu.ny.4t.1y8.2uu.8u.tu.i3.3es.166.og.5jk.6m.b7.1.az.hb.ir.i3.1.' +
  '11a.hm.4w.bn.mx.5y.2m.j5.155.2k.ns.4e.2cq.2rr.m.g0.1tv.iv.1zv.19t.flfb.95r.wl.2a.144.t3.69w.159.' +
  '49.fj.4ju.gl.59t.5t.2db.1a1.467.ld.1hn.zo.bw.az.1c.1eu.1hh.1he.1i.49.bj.1tr.yn.56.nz.2zg.bt.4.1c' +
  'k.6mz.u7.1ka.19t.1nc.1p4.1i2.t1.ag.e5.ht.fu.e.1s9.32w';

/** 304 spells. */
const SILENCE =
  '6c.um.1qr.i6.25.1uu.177.jn.fo.sg.1i8.29r.g.11j.140.1d.tm.bw.271.kv.dx.5c.e5.1w.19.l.bc.dr.b1.g.1' +
  '5e.1p.5e.ji.7i.jz.7.aw.13.7u.7o.3.9l.64.7n.gf.3a.hp.jg.88.6b.4u.2v.kc.bg.fi.3m.7n.ge.40.3l.re.9l' +
  '.3z.60.1r.3v.1kg.2c.y6.7l.no.13u.y1.zy.8f.1a4.7u.136.55.85.80.wl.qg.1z.xx.k.95.uy.jt.15q.i.236.u' +
  'u.10i.1d.d6.y.nh.7j.5p.28o.8w.3kj.9f.y6.3s2.hj.86.157.133.bw8.1d9.nf.kn.id.ben.3hc.fc.ai.vk.31w.' +
  'fk.bt.sb.4ib.be.2fm.7qy.zl.1h4.2cq.1l6.31d.17.1sr.125.34s.18h.h.lj.70.u.8.5.4.6a.6j.9d.1i9.50.gs' +
  '.16.4uh.261.14i.3gk.14.3fp.4o.2fg.4r.1o.2gm.179.ay.ex.1qp.1by.30k.5c.2o.66.49.dg.zr.s.1ky.8k.r4.' +
  '204.ea.57.ai.1hc.uk.i1.2ty.6j1.2n.226.eo.2ia.2g4.ha.1md.165.vp.a5.2s.w.37v.4nv.s9.44l.1ef.1zr.3o' +
  '6.be.197.1oc.sq.2zh.14u.2p0.un.181.t4.39i.ps.14t.30.1ok.8.3n6.t8.2oh.1b5.69h.ve.1m3.r4.ex.2qh.2d' +
  'j.g0.1f2.1i4.8i.hv.13.29a.19v.3ae.1k0.g3.31.19j.vf.468.j1.2ms.x8.1j3.1.h1.3nz.703.4bf.20n.6tr.3h' +
  '8.3l5.34.26c.5np.5z7.14s.8oo.1e1.19r.wc.11f.37t.1st.kf.gr.8ku.17n.4kv.86.fus5.15l.eo.2de.4y9.5uw' +
  '.1ph.2y4.16f.3uw.2id.dc.3jd.44t.3yz.dh.9xq.6l.de.qy.cj0.17h.14z';

/** 1116 spells. */
const ROOT =
  '35.9.61.4t.6h.1n.242.13g.75.r.4d.l.3z.qu.l6.cy.a1.k.4q.y.v.16q.2u.lw.t.1.1.g.bg.fg.b.2j.2t.1.62.' +
  'a.75.c.49.21.1.9r.k.j.d2.bq.od.4c.bc.3.1l.1.25.nw.13.mx.2k9.19.hk.m4.80.6e.2r.1k.3g.b.1n.bo.jc.e' +
  'y.9y.tl.1dx.v7.nu.3y.2v.w4.11.3.24.1.1.15.fy.5a.j.1d.3g.dq.ew.6.cb.pz.94.3j.k9.na.q.4i.ct.u.9j.5' +
  'u.2.g.7d.m.8z.6n.c.3f.s.5p.8s.al.39.7n.6.7.4b.18.4e.44.a.5l.dq.172.k.5w.1h.b.g.1b.2o.aw.5k.14.v1' +
  '.fv.i2.cy.43.a6.4k.dd.bq.2n.b0.9n.e.6z.7.7f.11.ir.20.6j.d2.do.3j.b9.66.1c.3e.2i.1a.1e.8.1z.1y.2w' +
  '.3c.l.1z.ie.75.f4.ez.g3.8m.5r.1p.9x.19.eu.13.ly.6.ic.t.2s.7.2f.i0.12d.9.25.2m.n.h.ad.l.8y.4d.1l.' +
  '1z.8.yw.1f.l0.r.30.2s.1v.5n.h7.1t.4v.12.b8.dp.xh.di.b6.8c.5v.fj.2g.6d.et.9g.7.8w.1u.9.n.7.6.1.1.' +
  '4p.4h.29.46.20z.36.2e.jt.2s.f8.75.19b.v5.1z.79.4r.1h.vk.qm.th.2fq.yi.l8.xi.zl.pr.3i.2i.1b6.3y.g2' +
  '.l2.uf.9f.s.22f.43.5q.2z.m.5v.35.bp.z6.em.67.1z5.t.22.el.fb.ly.1s7.3dc.h1.1g5.bt.ii.n4.8r.13.1bi' +
  '.w.i3.v1.56.h0.1.1d.dn.1ao.sk.3y.4.5p.hx.h0.14.bd.z6.l.43.9g.im.bw.1b7.fp.1gv.4i.mr.2v.57.48.m8.' +
  'ru.5b.9r.1n.67.12e.5r.l0.2v.ns.h.98.pr.ke.t.i.f.1b.1.nk.yi.1co.7c.7n.58.2o.fl.ah.h.51.19.3d.2n.5' +
  '.1m.i4.a.34.9p.8f.2h.1hv.79.7h.4n.53.ce.4c.55.vi.61.8s.b4.av.6f.kh.dn.a.d7.1u.4.qw.jb.9q.1t.jp.7' +
  'd.h1.a9.1u.3b.og.6o.tu.5g.4n.9i.fn.250.e0.2z.bu.x9.7g.e9.ff.2u.64.i2.h.59.42.2q.4d.4l.2z.1f.2b.2' +
  'k.ni.1.75.8v.3c.21.uo.9w.97.d3.8t.1i3.ag.7v.lh.x.2.8y.1ix.h.t.19s.fp.45.nv.y4.k.2.2y.3g.2f.kt.ai' +
  '.gk.8v.4y.76.6v.c0.ge.y1.8b.dz.3i.g0.b5.pl.l.iw.a5.sx.9.y.b1.ic.a6.oe.7p.8r.jl.72.8x.ak.13m.ea.1' +
  '.66.qw.17w.2.op.42.1e.e7.7p.m.4f.s.2q.9f.4t.5d.7q.16.7v.119.ah.lv.1s.mz.3c.6t.7a.3s.2e.1q.ux.kl.' +
  'l.d5.4r.in.76.sa.51.5e.fx.lq.hc.rs.la.u9.4.xw.fd.c1.kb.3h.y8.kw.6z.4m.57.19x.f9.4o.b.au.36.3q.43' +
  '.75.g3.9v.11h.ah.9b.5a.kh.cx.3z.5z.2m.2r.4b.102.264.hz.2o.9.gs.3b.1b.y1.5x.17.tu.5o.1td.2p.ds.44' +
  '.16.15k.5a.fo.3j.m.ah.ds.1x.2.4v.87.8k.8o.fx.2.gb.7p.5y.su.4p.6e.l7.jf.1s.fl.7t.s2.ij.54.5q.1.3t' +
  '.2.yj.1m.1.sq.p7.64.dq.5i.e.8g.5n.5y.2k.uw.1uz.fx.6z.ac.ai.j.7n.fj.39.y.1.8k.7p.3f.g5.28.69.fr.d' +
  'c.2t.7k.im.13o.bh.tw.13w.z.qa.g3.j6.2x.75.y.6.3m.lu.1p.ig.2a.ko.1e.2k.xg.1t8.1rk.26.c.102.y1.mt.' +
  'bt.1.2g.f3.ce.1.vn.2u.cz.9s.d.10.6f.2d.2g.n4.j.26.4r.9b.f7.32.6c.10.eo.1jh.gx.24c.3j.yl.2k8.7f.2' +
  '.rm.c9.nm.19.ad.7h.xx.6x.up.fu.q8.22.7e.aq.2y.ab.di.2.ov.1o.sf.9p.49.9t.2.6b.ad.6p.4.iz.b0.94.2.' +
  '4d.7s.ao.2x.49.vx.b2.3t.a2.45.96.xn.1j.2i.pa.lz.re.ep.6p.94.3k.60.bg.b2.3y.77.9k.1q.1v.1h.dg.4.h' +
  'b.2.8s.1s.g.8g.dl.u6.71.2r.5p.jz.ag.3t.1a1.1ox.1m4.ap.u2.5n.ew.1.9e.3o.hj.ij.gb.2v.2a.4q.4d.fj.4' +
  'c.1q.be.1dh.jk.f.1cc.1f.bq.er.93.1q.4.17n.2j8.iy.2c.dk.ai.5o.df.1a2.3u.9r.8b.mx.qb.jk.87.aa.cg.q' +
  'w.8g.3cp.aw.i3.dw.8q.ki.ca.g4.y.e.ni.15.3v.qw.3.49.a0.1na.77.6u.r5.dk.1v.5.9x.g2.1k.dz.on.3b.ba.' +
  'g.1x.7.79.7.g.1n.69.21.3x.1.1.43.9l.g5.d3.fo.iv.8v.lp.4s.aa.1sh.1ue.13f.6v.rp.sg.pg.bj.27h.5s.d9' +
  '.w.99.qq.dd.17z.lr.ta.kq.8.12t.154.l.i.b1.78.bv.3f.em.k2.2k.35.as.93.2wr.t1.an.5x.4c.3.4.cr.bh.c' +
  'l.3.1xc.11f.11v.2n.14.aa.f7.12r.2t.8m.s.2r.26.1j3.1j1.a7.iu.17.gw.3i.16.o.1y.tz.8h.xp.5c.94.2j.1' +
  '4h.7g.k.4q.t.7w.sy.y.5v.x.la.or.ki.2z.f8.12h.q.nn.6l.wf.27o.xk.d1.76.2b.16t.d1.a4.100.ci.j6.gc.c' +
  '0.u8.1.7s.c.fuxh.6j.44.14o.za.6z.cw.2nc.ds.26e.3f.m3.1zl.2f4.ib.1bv.66.v.uc.qv.qc.i1.1bo.1vt.1jq' +
  '.3p.2rc.ex.av.1lu.1co.25.ny.b.ag.bi.dq.1t.gi.l0.11c.bp.55.qc.48.66.3r.a8.bx.zb.yv.a7.pa.3f.l.ac.' +
  '22.e2.1aw.34j.o1.92.3t.2zq.4k5.2i.bm.il.4l.1a9.1bl.14y.6i.2le.1t.5.2.sz.b0.1s.45.s.9m.3.80.ol.8h' +
  '.jv.a2.1c2.16.45.kl.3.3vh';

const LISTS: readonly (readonly [string, number])[] = [
  [STUN, 1],
  [DISORIENT, 2],
  [FEAR, 4],
  [SILENCE, 8],
  [ROOT, 16],
];

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Map<number, number> | null = null;

function decode(): Map<number, number> {
  const built = new Map<number, number>();
  for (const [text, bit] of LISTS) {
    let id = 0;
    for (const delta of text.split('.')) {
      id += parseInt(delta, 36);
      built.set(id, (built.get(id) ?? 0) | bit);
    }
  }
  return built;
}

/**
 * What this aura does to the unit, as a mask of `Control` values, or 0.
 *
 * 0 for every id the table has never heard of, so a control added in a patch
 * newer than this file reads as an ordinary debuff: it goes uncounted rather
 * than counted wrong, which is the right way round for a chart whose whole
 * claim is that everything on it was a press.
 */
export function controlKinds(spellId: number): number {
  table ??= decode();
  return table.get(spellId) ?? 0;
}

/** Whether the aura takes the unit out of the fight at all. */
export function isCrowdControl(spellId: number): boolean {
  return controlKinds(spellId) !== 0;
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function controlCount(): number {
  table ??= decode();
  return table.size;
}

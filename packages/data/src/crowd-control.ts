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
 * 11995 spells. Only ids are stored: no names, no descriptions, no art.
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

/** 7395 spells. */
const STUN =
  'p.v.19.8j.84.a.a.b.1x.z.i.6l.v.i7.1l.mc.6r.6d.y.2r.i.3.8.2c.2j.2x.1m.9.h.1.bw.1.1.1.1.1.d1.fn.5.' +
  '1m.1b.1t.ac.1.1i.5.i.1.5b.x.8e.d.5.x.2x.n.3.v.1m.d.17.r.1l.1s.2.j.5.g.2r.p.x.i.11.2s.1l.5.14.2b.' +
  'b7.3p.4e.3.3.21.o.2e.1.1l.y.17.1h.1h.8.33.2t.z.q.41.24.8.1.2k.12.3j.k.25.5i.4.q.qv.7y.1l.1q.4k.b' +
  'c.2.e.11.4p.56.14.66.10.7z.14.27.3.j.4s.4c.37.6e.2.1.2h.x.63.6d.2m.5.5f.jz.2.1b.1.v.9q.v.70.1m.p' +
  '.3.v.3.5.2l.1x.1k.2k.23.u.l.8.5q.14.2t.1.19.2v.3j.1r.8.5.1u.3y.6n.m.4.a.7.e.1.2i.2m.8.3g.r.14.bg' +
  '.15.6z.a8.z.e.8s.8.6c.m.73.3k.b.4.2g.5e.5u.1.7k.1u.1c.6.e.2.8g.32.1h.f.l.h8.13.1.2g.18.a.8b.2.1u' +
  '.1y.2k.16.v.1n.15.b.49.1j.4.3w.1c.1w.f.2b.15.2.1g.28.3.7.2.1.cu.2d.g.s.41.k.33.9.2.p.f.j.e.56.6.' +
  '1b.h.7.f.4.8.28.x.20.10.3g.d.3p.52.1i.1y.k.3v.v.d.r.v.i.1b.v.2d.3g.15.26.g.3s.64.hd.ag.c.1e.4.3v' +
  '.1e.20.2v.40.x.4a.9.c.13.24.6.1c.i.2s.2v.f1.y.9.38.1n.6.l.5.4a.6.3.5.6.l.55.7.5t.3.1h.1c.1.11.t.' +
  '4y.4g.10.v.21.t.16.i.7.w.1f.w.8.6.1o.5n.p.i.6.4.2g.i.e.6.1g.1l.2.2.7.1q.30.f.m.1s.o.2h.w.u.l.6.2' +
  '.29.1.19.4t.12.1j.4s.1u.2q.r.1h.w.q.f.67.35.2j.2i.15.o.1j.l.22.f.1l.20.5.6.3j.i.s.1f.7.1.2c.3r.3' +
  '6.49.32.15.1j.10.i.v.e.1y.1g.3.x.12.5b.33.d.1k.16.1w.26.18.4p.21.2t.51.38.27.1x.1b.p.z.i.1c.1n.8' +
  '.t.1c.d.25.8.7.b.r.f.y.d.2g.h.18.u.f.2e.1.1.4j.1c.24.i.g.1t.4i.e.1t.h.l.1c.2f.3.e.1.1.o.1e.1.1.1' +
  '.1.1.1.1.1r.1u.3e.2c.k.1c.1.18.5n.y.13.x.1c.2j.f.1o.48.9f.6.k.s.1a.6.4j.8a.14.9.26.17.2.e.11.m.i' +
  '.b.12.17.7.6.7.1.1g.f.d.6.n.r.1c.1t.e.1p.b.c.6.20.f.3o.1b.1g.4.b.g.5.2.1.1f.2.1s.i.2.v.7.p.1b.b.' +
  '1d.6.1k.2.aa.5o.1.1e.30.1p.m.r.2d.2t.r.o.n.s.bm.5r.8.1n.1.l.b.1z.9.2c.13.7x.5m.2n.2f.w.1r.h.2s.a' +
  '.5.62.1z.10.3e.z.11.1k.27.2.1v.45.j.12.2q.d.2h.4s.s.d.x.p.1c.f.e.2.4d.5.1f.1d.r.1w.s.5.p.3i.n.e.' +
  '4e.3p.34.s.22.6f.23.d.12.3h.31.i.i.c.o.2a.1x.4f.1d.3s.b.a.z.j.1m.5g.o.2b.5z.2z.41.19.3a.9.e.3h.3' +
  'r.1n.1o.2d.i.4.6z.7.3q.8m.1h.19.2h.t.1g.r.11.15.2v.3y.4d.a.4i.2i.4p.2.4.97.f.1b.g.4.d.p.1s.g.v.2' +
  'c.1j.2.12.1h.r.7.9.8.13.g.14.n.2.m.12.1g.1.3.1.6.3.9.1g.v.1e.s.s.7.1s.2n.1e.4g.g.q.9.s.1y.1j.3c.' +
  '7v.1.2o.7.1s.6e.e.k.h.t.k.z.4u.49.49.1m.2.p.g.2a.g.b.4t.17.4p.73.r.b.i.b.1.5.i.cd.l.11.5q.1k.9.4' +
  'a.p.cs.2l.r.33.1n.17.d.1h.1o.w.6h.z.37.2a.53.6.n.2s.1.8.23.24.p.1.2q.a.h.3.1o.2.8.24.j.3.k.3j.12' +
  '.2v.28.1f.1b.26.g.4.h.2m.19.5m.7.3.w.3j.7n.3n.6m.28.2q.7.1z.7.r.y.k.7f.1u.1z.y.60.3.2f.1.2.j.1g.' +
  'e.3n.1i.7.1d.d.6.g.1e.z.3.1b.k.5u.2p.2p.11.19.q.29.18.2w.3i.3i.1o.8i.3v.1.1.n.3.v.2p.a.4.i.2.54.' +
  '3b.4r.k.2x.7.12.2r.o.t.2z.r.2v.1c.40.7.a.12.2i.x.3.65.1.1k.i.15.b.2.1e.1.p.1.4.7q.39.2z.j.d.1.1u' +
  '.1y.6.1x.c.1o.f.x.m.14.29.2.1.9i.2u.2z.1.2.2z.1o.i.6.b.b.f.4.1l.1.m.9g.j.3.3y.1c.2v.7.27.24.16.m' +
  '.25.3o.q.4.1j.1w.i.1z.e.9.3f.3r.l.1c.15.1w.o.3.5f.5t.19.11.5.f.2a.j.1t.1g.2l.f.t.e.9.10.2.9.6.1x' +
  '.1v.d.1q.1.1.1.1.1.45.9.19.1.1.1l.14.3r.w.z.26.43.2.m.1.3.2p.14.t.2.1.1o.30.5.s.3h.4b.1v.8.2d.4j' +
  '.75.4c.46.1.a8.3n.5l.5.6.2k.s.1.a.8r.20.2.5.l.26.j.m.23.s.j.2a.1e.n.26.1g.1j.f.1a.57.28.m.g.10.m' +
  '.v.18.4.e.9.1z.i.32.15.3.2.3j.x.14.14.m.1m.c.16.d.y.g.f.1m.12.15.1k.6.1x.1.1.b.9.8.8.9.11.e.x.1d' +
  '.1b.3t.10.a.38.23.46.2t.o.m.6.1y.1b.1z.17.1r.h.i.1h.3.2.c.14.4.7u.1s.w.33.6.6g.1s.5.c.2f.3c.5.22' +
  '.39.1e.12.n.52.23.19.6.4.m.1e.5.12.w.i.2n.13.2.1.1.c.t.1r.a.1i.7i.3o.56.2h.z.d.g.1e.m.4r.1c.17.3' +
  'y.4f.14.k.1l.1.b.1n.30.4l.e.4g.2.w.3i.d.k.33.y.2.38.3h.o.r.k.v.g.o.l.29.2w.3h.6.j.1n.8.2a.ev.23.' +
  '26.1y.27.i.2g.16.5g.u.1h.48.6.1.1.1c.1w.1h.t.y.s.9.28.18.50.2n.1p.m.t.t.4.9f.b.4h.u.3i.6w.1b.3.1' +
  '.3v.s.z.1g.18.n.15.8.2.u.y.4r.85.22.g.4.39.3b.1e.2t.4r.13.3.1.o.3.a.u.3u.31.1.1o.1o.r.7s.19.24.a' +
  '.3t.8.v.2r.1.6n.2p.d.4m.j.3.1h.1i.3.1p.9.7b.1.4o.3d.2o.bj.7b.o.4s.1b.7k.19.6.1t.3.1k.35.9.1.3d.9' +
  '2.cu.7j.14.37.b.1v.u.1f.3t.1e.26.m.1i.l.2n.2h.4w.7m.m.20.7x.bw.1t.19.25.s.64.84.b.35.7.k.3b.1m.3' +
  'a.1o.l.32.d.1.7.x.13.k.4.g.2.i.m.25.32.4.4e.12.1i.1f.m.2n.22.5.l.b.4.a.g.14.3.91.3n.e.34.17.9.3y' +
  '.3.4.1g.2.5u.3c.d4.1c.3r.3i.5.w.h.10.i.28.b.2a.30.2.44.5n.34.3a.l.6.1.b.2e.5.1.6w.x.5.23.1b.1.1.' +
  '25.26.26.z.1l.3.2f.2i.s.25.5e.y.6q.28.b.5.3.1.21.17.8s.3.1.17.38.h.1y.1n.x.37.35.68.2d.3s.1i.c.5' +
  'j.2.y.e.3s.8g.34.49.d.9.c.j.4n.b.r.37.y.3v.i.3u.7.5.c.1c.3.1e.2.2.10.2.4.23.s.2d.53.25.7x.2s.2k.' +
  'y.1h.3u.1x.1d.r.3u.1l.k.3.2q.5.3q.g.7m.bl.2e.1q.9w.3v.7.2p.d.1o.1g.g.1.o.fq.16.2c.70.1e.j.4.1.3b' +
  '.2f.f.9.9j.88.2r.l.3x.3q.8f.12.5b.tr.b.2r.1.9x.13.h.9b.6.t.7a.19.2k.c.31.b.m.14.8.w.2n.e.i.1y.i.' +
  '6o.59.17.k.2c.1.2d.5.f.6p.p.l.4v.h.b.2z.c.2b.88.3a.2y.1y.7i.i.2i.14.1.2.1.8j.4d.r.1r.42.a.2u.v.g' +
  '.2t.3m.21.2g.z.1p.q.5j.i.36.2x.3g.w.q.l.21.g.8k.1.3l.21.2g.7o.2a.1k.2z.5j.1r.k.2b.1z.8j.e.4m.98.' +
  '2f.d.6n.2q.u.e.b.8.m.8.30.1.3t.m.h.29.1f.1q.5.8b.d.a.1z.a.3.a.1.1.7n.6.2b.1n.3.14.22.21.1b.1s.2.' +
  '4.a.q.2.13.6m.1.1.3.f.9.9b.d.6.e.11.v.12.3l.7k.3c.2b.1d.a.6.3t.5.1d.1q.l.13.r.1y.4z.3s.1.2k.5.20' +
  '.28.1a.2s.2k.c.d.4.e.3.8.1b.3t.a.m.2b.4q.13.h.h.71.2w.3.4.1g.2.1d.v.u.3g.31.1.1c.8.2s.9.i.1f.k.1' +
  'k.1.1.1.1.1.1.1.1.2.1.1.1.2.v.y.1p.1s.67.al.1n.j.4.o.3l.2.1v.v.q.6b.2r.4.k.1j.1t.12.18.u.1j.18.2' +
  '.36.k.7.3.a.k.1.1.2.20.3.4.17.16.g.v.63.q.8j.2l.2t.1s.b.2u.5x.1a.4o.16.4d.5r.1.38.23.1.1h.43.1k.' +
  '6a.12.d.l.u.50.1x.1b.o.1l.c.9.2v.1.3o.1.8.1.a.k.z.3u.10.1z.2f.9.4t.3r.1.2i.3.b.3a.27.2.70.2s.2.7' +
  '.y.32.s.6c.17.l.2p.13.1v.2r.1m.g.5.4g.32.41.4c.3q.1e.2i.3h.o.1s.t.e.3e.3.19.1.h.10.3i.2.64.h.1o.' +
  '47.3n.1.z.1.1.1.z.7l.1s.p.7w.r.c.49.1s.1m.28.t.u.8.1v.j.f.2w.2v.18.t.1o.1o.n.b.3.1.1.e.2s.i.3f.2' +
  'd.1r.l.1a.3e.13.4.11.1y.4.1n.1x.29.1g.h.b.p.3.9.1.12.40.78.1.n.43.4p.8.v.20.1.u.x.3.3.1y.7.f.al.' +
  'u.f.w.48.27.3n.2g.27.23.1i.p.g.32.3r.38.7t.1x.1m.7l.22.2.15.3d.z.5c.i.q.56.5.18.o.1u.13.1i.8.x.e' +
  '.1.g.12.6y.1a.d.1.2h.1b.43.j.8.4.1.1p.2r.a.3p.58.7.3x.27.5s.13.1.2.4.d.1q.1c.4l.a.6.4s.2g.9.14.1' +
  '4.2z.2a.n.28.2y.10.1j.n.c.1.1.3.b.f.1.1.6.2l.7.1h.31.l.r.19.3g.37.4l.1.35.g.1.g.4.1r.b.7n.20.13.' +
  'l.3b.3a.24.1r.2y.23.p.23.w.m.4.1b.31.1k.4.t.13.e.1w.1v.2.4w.4a.1s.a.d.2x.k.q.1b.3f.1o.1.24.3w.2.' +
  '11.40.o.w.1.2r.3z.2p.b.10.11.5d.6.21.4w.8.2b.q.j.b.1g.4m.53.25.32.79.17.g.1p.1t.2g.29.6.2x.6d.t.' +
  'y.11.7.3.24.3g.9.4e.2d.3l.i.g.3f.w.f.2.m.3p.e.3s.69.2m.25.1u.10.3e.1s.2y.2z.76.1.30.2i.21.30.bm.' +
  '35.2y.t.6.11.2.4.1k.al.1p.72.2n.4l.9.14.1u.2.2.f.4.66.40.47.2e.v.1a.1v.q.1v.4q.4y.2d.4k.3n.r.3.8' +
  '.1c.4.15.10.19.2p.x.g.1.r.z.m.d.1l.1f.m.2f.49.z.6q.a.69.br.2c.3p.1.k.7.r.g.x.1v.34.4p.2y.k.3m.5.' +
  '5k.2r.2.2.j.3y.7d.7.1r.aj.41.e.s.1m.1n.o.39.k.4.1c.14.3q.1e.p.13.2e.39.a.3f.9.93.1s.k.u.1x.i.a.3' +
  '8.3l.r.1.q.g.4.q.54.5.6.10.g.1u.3y.2.9i.f.y.b.15.3.1.1e.z.3.3.2z.p.4.46.3.1r.h.1j.g.17.1p.e.x.4o' +
  '.14.17.1q.v.j.4.25.61.p.j.8.1n.m.j.5a.8.1o.3q.3e.u.7.2u.1p.f.8.19.2.1.8.7.1k.5.1t.27.1k.1.1.1.1.' +
  '2.4.o.p.1y.w.6x.1u.l.1q.y.1i.19.c.a.g.i.2z.3.a.a.1m.1r.5.5l.5.18.1l.o.j.1d.9.17.11.f.q.18.1.1e.2' +
  'g.7.9.4r.q.7k.44.3n.b.1.9.c.aw.75.2.i.9.1k.5.z.3h.v.1q.2.8.w.1g.g.y.i.t.k.4f.r.7a.4k.r.a.1p.j.8.' +
  '1m.24.18.z.39.5e.z.b.10.5.c.17.i.1a.1.5y.2y.b.6.17.4k.m.1o.c.l.2m.1e.h.9.2j.n.w.t.1l.2z.19.10.g.' +
  '1e.y.b.1u.1w.1n.16.h.x.9.23.8.6.1p.y.1.c.2p.10.2e.y.a7.34.15.6d.2t.6.2.ac.1.3a.9v.i.2y.1w.b.h.e.' +
  'i.37.46.1u.15.1.8o.3y.1.9p.j.8j.6c.i.2x.1h.18.59.d.1o.1.1.1j.6l.36.1.k.1q.1u.g.14.4l.1z.i.9v.3u.' +
  '4z.1y.1w.p.33.a.d.2r.55.7m.8.3.25.2z.d.27.1e.20.6.q.v.g.y.2d.1k.2k.v.3e.5b.1h.5b.7.2h.49.1f.2k.1' +
  '5.t.i.1.1.4x.e.b.c.k.30.y.c.b.t.s.3.12.2.c.e.18.c.t.28.8z.1n.4n.3i.1.v.1m.2.17.l.3.3v.2j.4l.3m.4' +
  'p.6.1m.8.27.83.2a.37.1b.3k.3q.2.6a.5v.3a.1j.4c.24.1p.v.1h.4.1.4x.e.3.i.g.z.p.1.40.22.1x.3.d.40.1' +
  's.4q.m.1p.7u.1.1.2f.1s.1j.18.2w.1r.e.c.7z.x.1j.2r.s.n.x.z.1m.29.23.16.1y.2.d.2v.3j.z.9.1m.1f.m.q' +
  '.2o.4a.f.m.6.5r.3j.b.a.d.1l.6u.5k.c.38.a.7.c.s.2.1g.2s.1g.47.c.1.3r.69.40.14.4b.40.b.1.b.10.2f.5' +
  '.2o.n.2i.3d.z.4.17.c.13.3u.1x.3w.2j.1o.4f.1o.x.c.m.16.r.3x.1b.4q.2r.1f.1s.2b.1w.26.5o.1.1s.21.6.' +
  '19.9.s.2k.4.1e.43.36.2k.9.1q.77.e.m.5.28.7q.4w.c.1z.22.2q.6a.1r.1x.2k.x.5.15.2q.1p.5.d.1y.1e.u.4' +
  '.1d.c.4t.5.2.3g.t.i.s.w.2g.b.10.g.e.5.22.45.5.7k.2h.1j.11.9d.3u.13.z.k.10.1d.4.g.n.o.1t.1.10.c.4' +
  'p.3n.i.2p.2j.6u.d.3.33.2.c.2.2c.35.5j.h.s.c.1w.w.i.5.x.1o.n.b.1.2d.x.3c.1m.t.1j.1q.12.m.1.n.3h.1' +
  'f.2.1k.u.i.1w.k.2j.a.z.6x.1.1f.1f.70.d.o.2y.2k.2.4w.2.17.1m.5l.8.17.5.9.c.5.l.29.1i.4.1.6.a.5.6.' +
  'n.47.1h.1.1.w.v.2h.m.2j.2j.1s.5r.83.u.5h.p.6.4b.46.2w.2.37.2z.1.n.9.k.1k.61.2b.v.4.22.2u.4b.1.1v' +
  '.3r.19.45.2.4c.10.d.17.2j.7.3.4s.1j.i.d.2z.1r.3q.1.b.y.2t.2k.r.4.12.c.17.h.1k.59.31.48.65.1z.4l.' +
  '1e.z.37.2e.5.13.1n.27.17.60.5f.1.2j.4t.3s.a.1b.1.g.1c.9.2i.p.6.1.1u.o.54.1u.14.1m.6m.1p.5.1t.24.' +
  '10.2v.1l.t.5.13.w.23.30.g.e.m.3u.p.4.1f.3s.3w.h.2v.2t.3z.2h.c.7.2m.3h.e.1.d.e.10.v.d.1j.f.12.6f.' +
  '3.7.c.5a.2v.f.1n.4c.b.3.2y.3k.3x.2b.10.2k.50.3m.1f.2x.2r.p.d.28.9.5.h.8.2.n.6a.1d.1.1k.j.q.29.2j' +
  '.3k.j.l.13.1q.h.4q.q.13.1c.c.37.m.j.5y.1.n.8.n.b.1g.2k.2m.1e.2j.12.i.1q.7.x.4h.x.2f.5.5l.4c.5m.z' +
  '.55.19.1b.6b.1m.22.k.g.5.26.2s.1g.1h.d.3.17.1o.z.6.k.1a.26.3.t.13.12.20.1.1n.h.9.6d.a.30.b.1z.e.' +
  '55.4.c.4u.y.3.t.1a.1f.g.1x.22.1a.3.n.s.r.n.2s.4.3k.27.a.s.1m.2m.1e.7.1g.p.4x.s.q.1j.18.8.2.1m.f.' +
  'r.3.1f.1q.9.4u.2n.1.1.48.1u.q.1.1p.2b.2o.h.p.at.o.y.51.1o.3.1.v.1g.5.c.1z.3.30.49.11.m.p.40.19.3' +
  'k.8.58.2j.1g.39.s.3.6e.d.k.y.i.1p.6.27.c.e.q.5j.1d.1f.1n.42.2a.2x.1u.2e.4u.p.j.37.22.15.s.i.y.2a' +
  '.1j.o.ec.6.4.q.10.39.1o.2k.36.10.1f.y.5h.1d.3i.d.c.1b.26.2t.m.1j.n.p.4.1.5.3.3.9y.6.o.h.2.30.32.' +
  '2n.18.2k.1.1g.y.1p.x.3d.1k.6c.29.6j.29.1w.1.8.i.r.5.k.1d.13.n.5b.1.2l.q.1y.6i.c2.49.g.1u.e.1.54.' +
  'a.n.16.1r.a.2x.2.2j.3g.d.7.5t.2a.8.3h.k.1w.37.2f.2s.12.98.4j.u.i.6j.o.7u.j.2o.a.26.5.1c.f.7.5.w.' +
  'f.2.e.i.q.9u.31.8.3p.5z.6.b.6u.4e.r.b.13.2k.v.10.5p.1o.1s.24.i.36.54.d.21.62.6.24.b.1e.1p.1a.27.' +
  's.i.31.1.4.s.8.3.o.b.2.f.j.6.1s.4.1m.s.4.r.1m.9.13.ba.13.a.4q.25.23.1d.20.v.a.1z.5i.35.w.1q.p.y.' +
  '6a.4.9.z.1.1q.h.25.4d.p.n.7v.3u.3j.2p.z.d.1k.a.t.k.15.2i.u.2p.a.2.7j.2h.1w.1f.1t.x.i.1l.h.1l.5.1' +
  '2.b.2g.3z.j.17.10.1n.9k.3m.g.f.9.a.45.24.35.29.47.p.m.1i.8.z.f.39.3.d.s.m.3.1.1.2.2v.v.3a.8.4r.2' +
  'e.h.1y.g.7.1o.a.12.2k.8.2f.1.r.4o.1n.z.3t.3.h.3s.g1.6k.14.6g.b.2b.2j.m.6k.38.8.7.1.4e.5.29.6.3.5' +
  '.n.a.8.2l.47.t.t.1i.5n.16.h.5y.u.1m.5x.1m.3i.m.4d.10.t.3y.m.9i.5d.1a.1x.3.2.2.1k.7.29.2g.9.7.w.2' +
  '7.1y.d.g.3q.4.w.3n.t.1m.2m.s.2.3.b.1.6i.23.2j.1x.2n.4i.2a.r.c.1e.1r.17.18.v.5.2g.7.17.5o.7.4n.11' +
  '.3a.1o.1.1.b.17.a.3m.57.u.3e.1e.25.q.1y.r.a.1.7.h.1e.1t.c.5.q.j.8.2g.k.4.2c.3.2.u.n.p.y.r.1y.2x.' +
  'o.2w.4.x.h.1.l.1y.e.t.2.h.2d.4h.18.h.2p.2d.5.5x.3v.f0.1l.l.d.5.1v.1j.21.13.17.3g.2.4b.r.x.11.2g.' +
  '4.1w.i.4a.2g.17.6r.3k.3.1.5.2.3.7.1.1.19.1n.x.2h.3d.c.s.2b.3b.r.12.2.2a.p.u.f.o.36.19.13.1g.4.u.' +
  '13.z.25.h.p.1t.2f.1p.1a.1f.3i.1f.1s.78.y.1d.2.q.b.e.w.r.m.47.j.11.c.i.3m.13.27.fd.1h.1c.17.6.a.5' +
  'k.1p.2.u.8.1o.38.1g.1b.g.a.k.t.19.1r.3e.ap.2x.j.d1.45.x.t.r.d.1.9d.2o.2c.4b.5p.u.j.1t.6.2.33.4.1' +
  'm.1i.7.7.f.5.1b.4.2.2.1a.11.5.6f.3g.8.5b.6.o.2f.h.54.10.1t.27.59.45.1.5.4u.e.1s.1k.6d.8.q.a.1.1a' +
  '.2.1.1.2.1y.ch.t.1.1.s.i.2h.2r.7l.7.s.2c.7n.2i.54.9.23.f.3c.4p.1y.2s.w.3j.25.1m.s.2y.25.13.6.24.' +
  'k.64.17.9.5l.1d.3p.8.23.1g.2j.4.1.1.d.30.38.b.c.5z.2y.z.9.i.k.2w.15.f.1z.1w.15.j.2a.2y.3a.18.2p.' +
  't.w.24.4w.5r.m.ee.1.11.2z.13.4p.7.2.4.61.1.3u.z.3a.1s.2.6h.5v.t.a.1h.2e.2p.4w.24.o.c.1c.7.2.1.2.' +
  '1.1.2.1.1.1.2j.1a.1.6.8.2f.54.4d.29.19.6i.2d.3u.4.z.3.4.1.1.1.1.p.7r.i.e.1y.u.34.k.1.62.3.5.1.69' +
  '.1v.8r.dg.l.2y.z.n.h.6j.1c.13.1n.8.1y.5.2f.8.f.1t.n.2t.1j.1q.1w.1f.76.6b.1.8.m.f.6.2y.j.2m.15.6c' +
  '.1t.4i.3.1j.c.4c.6.41.40.1g.1h.1j.2.2n.27.f.i.4.p.12.10.20.19.38.1.w.1x.4.4.2h.12.g.2a.4i.1w.r.3' +
  '5.f.23.27.4.6.8.m.y.3t.q.1e.23.b.26.10.s.3.5t.d.10.2.r.15.3.1u.b.9.1.2.3.p.10.c.h.c.2.1j.1a.2c.6' +
  '.2z.4.1.1w.2j.33.4b.1r.r.5.4c.i.3.3.1s.1s.5a.4i.21.1p.2i.15.3z.a0.r.3u.q.g.1y.j.7.g.2.7.2.a3.48.' +
  '6.1.1.1.g.2m.l.7.1k.6m.33.2k.1.3l.3z.2n.7t.1f.a.3.3v.2d.d.d.3.27.4.3x.1a.48.n.15.3b.1.14.gx.3.3.' +
  '2e.l.9g.1e.1b.2.3v.c.1b.x.l.1h.z.t.28.1.o.22.3.1g.k.1.1t.3x.v.w.1.19.m.10.9.3.d.3.v.14.k.4x.13.3' +
  'q.5o.1.2u.f.3n.w.1c.1.1.m.r.u.10.3l.33.7j.2d.j.1j.3.h.2j.2d.7f.3.14.c.1k.e.9e.1o.5w.8.1.6.4.a.1f' +
  '.q.f.2f.s.5.7.6.2c.33.1b.1f.1t.o.3.2.33.95.3.7.12.m.22.3.n.f.38.v.r.r.2c.8.3m.1p.1.3.d.h.1.1v.3g' +
  '.3v.3.5g.3x.1f.6.2.3a.20.3y.v.26.7.3z.1m.r.5x.1.7a.52.t.31.3d.1p.1a.2y.3e.u.3.e.2c.3e.3h.1.3w.58' +
  '.q.1v.4.23.o.14.w.2n.61.26.7.5f.8t.6.2u.a.4k.8.1z.1.15.c.18.d.j.7.1m.11.w.10.9.b.6.1p.2w.6x.14.2' +
  '5.15.1w.4d.1.p.36.6.e.5z.27.2c.b.2g.2f.2m.28.17.1n.1b.1h.j.i.d.7.a.28.6i.6.3t.5.21.32.2h.3.v.e.4' +
  '.23.1p.4g.5j.22.2u.r.1.1.1.q.3.8b.1r.h.10.19.cw.b.8.9.6h.d.3s.11.9.32.40.2.1.1.1.2o.37.d1.5a.g.6' +
  '.11.6.u.9.2t.be.2f.1e.z.9.l.4y.6h.j.2h.1i.a9.2x.i.2o.1v.16.f.2b.2y.3w.b.z.3.2b.3s.6e.3k.v.a.1e.e' +
  '.9.32.1a.4p.3.1z.1.2s.f.h.3b.1.11.4.2.u.r.3f.5.9.q.2t.7.6.41.11.26.v.2c.1s.d.3.18.10.1f.n.l.2a.3' +
  'l.w.5p.b.h.r.3l.q.23.4i.i.24.2t.b.39.l.24.1s.1c.1x.54.1b.2g.2.5i.5q.1k.2n.i.cd.2s.z.e.2x.e.72.m.' +
  '11.v.2b.y.4.35.18.10.1v.2.18.h.2.7w.2d.k.2k.a.1h.35.4m.k.1.4b.1j.1j.31.18.5.2w.6.24.5a.s.o.45.19' +
  '.u.1h.2.r.2.5.h.s.5.28.c.t.3.15.5s.3h.4y.a.1p.37.h.3.14.1.d.4t.a.3v.g.1l.77.4m.a.a.f.48.x.1i.1e.' +
  '7.o.2q.6k.4s.29.i.1.2a.1.2.1b.g.h.k.42.2z.3.4.1x.4k.19.28.5w.7.18.6k.e.3.1d.4e.d.4.1.1.8.c.1q.p.' +
  '1l.23.2.8.4.2b.1.21.p.q.2l.27.1.t.3h.p.j.6.f.b.2a.2.4.q.2w.3a.h.14.2.2r.9.q.5.d.c.3p.2.1h.7v.1h.' +
  '1t.1.d.3p.34.2f.2g.2.ac.3.4c.19.a.12.13.2.2c.3.1.17.d.3q.a.r.h.6q.c.2x.6e.4.59.d.2j.1s.1y.o.1j.2' +
  'g.1w.2n.8f.4.4e.5.2.4.1b.39.4m.15.1.34.t.1y.8w.1.d.27.4.2h.1e.2.c.18.12.3.5.1t.b.s.r.1y.2.2f.39.' +
  'p.3s.s.18.h.1v.y.5p.1n.1a.11.28.u.1.3t.3l.29.3j.1l.q.4b.1r.5.2.15.23.2.6.1.1c.45.e.27.u.1.1h.38.' +
  '2x.3t.f.7c.a.29.o.o.12.1s.2k.1p.1.2.1w.w.22.j.k.3g.2z.9.46.12.4.cl.h.7.d.8.2o.f.h.34.h.18.r.19.1' +
  '4.7f.2n.1m.s.l.2a.2l.78.1t.e.8.b.1h.11.6.2y.1m.o.39.2x.2j.2h.h.p.1a.2o.43.a.19.1.u.1n.23.6.8.r.j' +
  '.1m.a.2v.2m.1d.1j.23.3h.2i.2u.1a.ac.1v.a.7.10.6c.4r.m.2d.k.1j.e.a.1x.fi.c.2b.24.1y.2d.3.1g.b.2c.' +
  'o.2o.t.1h.2e.f.f.3i.1c.16.i.11.e.1.1.52.b.1q.29.1x.6j.67.2m.6.6.1.2f.75.2e.j.4a.14.c.14.10.1.1.1' +
  'a.5g.4.2c.3d.6n.m.3j.22.6.15.1.h.a.i.13.17.a.48.25.3p.1o.57.31.1j.5.3c.f.3k.5.9.3f.18.1g.2.5.4.1' +
  '3.s.14.66.1.8.7.3h.36.m.1b.1d.r.2d.2l.v.5d.18.1.1.1.1.1.1.1.1.1.1.1.1.1r.3.k5.76.18.1t.v.2e.6z.7' +
  '1.x.1a.h.1.1a.3m.1.j.s.3p.62.14.1u.1j.4.2v.1a.8.1.3.1s.1j.3d.a.1k.r.5m.1o.37.66.v.1m.33.16.2.w.4' +
  'x.2m.5.2l.1m.1w.1e.6d.r.f2.1b.1w.1m.3z.1s.1x.46.1u.1n.4.27.y.z.b.5h.10.6.3i.11.b.q.o.z.3e.38.7.3' +
  'v.5.1i.r.5x.1q.u.a.12.o.12.1q.4b.3p.4.4b.1s.2.23.7.6.t.46.27.11.30.2j.2m.v.10.4.1q.15.1d.25.4r.2' +
  'i.c.1o.3o.6.2a.5i.a.8.13.10.w.5j.14.84.1.1.19.j.i.12.4k.3j.1o.65.z.n.1.1k.s.3.w.u.1.2s.1n.1b.3.1' +
  'i.p.7s.2b.20.t.n.42.1k.1c.1v.8.1a.2h.2b.60.2j.33.4f.7.3e.l.1l.1y.2.o.q.1j.3g.4s.23.q.2.4n.2b.m.p' +
  '.59.1g.7.t.l.16.1t.4d.4w.k.43.db.h.b.36.1n.d.3w.o.2b.15.2b.1p.2.3.2z.j.i.2n.4.6.3c.y.2x.9.6.h.9.' +
  '1h.d.g.6.2g.4.10.2p.h.2k.18.29.5h.7u.21.34.4h.26.1m.1f.2r.7b.as.30.1l.y.1z.5.2m.f.6a.7q.b.1.83.3' +
  'w.1b.6.1y.v.1t.2.1t.j.y.1c.d.1y.r.b.12.x.6p.3.2i.13.1.i.g.41.3.11.14.99.6v.h.11.21.1u.15.1n.1p.a' +
  'w.3a.2b.o.2o.19.2z.3r.4s.q.4.3i.16.1u.37.19.3i.h.3m.j.1h.13.2.1w.3.20.3.6.4d.n.e.3z.4r.2z.o.26.1' +
  'd.b.a.w.a.n.h.3g.d.5.44.1f.3.c.f.9y.n.1c.19.9.2l.2.c.1.10.46.h.4e.j.5d.1y.4e.v.j.4.8l.u.n.2r.29.' +
  'y.1y.o.8.7.1.2.4q.h.4a.1v.11.1o.1n.2.12.13.21.1p.22.1b.2e.4n.2e.r.h.b2.4.17.uw.yg.5o.d3.2o.1f.1x' +
  '.8.4r.3l.q.h.4q.49.t.7c.3g.c.l8.1p.18.4f.1b.i.2.9.1z.39.6.s.c.1b.3a.3b.22.41.24.10.4.28.2k.i.73.' +
  '4a.4m.x.5q.3o.2c.2k.1c.47.1p.7w.32.32.26.2l.3h.2w.g.2r.b6.5u.1l.2.8.2.p.11.1k.1f.1u.i.6.1x.68.4.' +
  '71.1g.3e.8u.10.x.dm.14.19.10.18.d.6.b.9.7.w.5m.c.q.h.14.1l.11.f.1g.18.6d.3.s.7.k.2l.7.4d.50.1u.1' +
  '3.c.5.18.1l.4.5p.5n.1n.2q.40.14.3v.r.4i.83.1c.m.3.2g.t.7g.4b.g.1k.5m.3c.1m.14.7.2l.1d.1.4g.1x.4.' +
  '3.58.16.c.e.1.2c.17.j.13.2j.2.y.14.r.7y.22.30.m.56.u.d.2w.f.9.3.1d.c.k.2y.7.g.l.4.q.18.1.e.4.7.2' +
  'a.1g.2.u.d.6m.5.34.1.1.o.1.1.1.z.1.1.2t.1y.9p.2e.j.8u.m.3.1e.y.s.k.2c.9.p.7.c.2a.8.4w.2e.2t.28.6' +
  '.4t.bg.2m.f.6s.i.2v.18.h.z.1.1z.3f.2l.16.3.16.1.1.1.2.t.v.2b.9.2.z.43.1k.4.1v.3j.x.o.e.4a.di.5z.' +
  'du.47.8m.2i.19.51.4v.g.1m.1r.70.t.4v.t.50.31.f.2a.1f.2o.b.6.10.w.2w.1c.68.q.1i.2t.u.6j.79.p.18.3' +
  'd.2w.1.9.1.1b.17.5k.2c.48.s.7n.29.54.3k.2b.42.s.42.7a.9.14.f.k.5u.4l.m.28.2l.12.x.k.24.1k.7.1f.1' +
  'n.43.1t.6f.2m.30.5h.7b.r.6.de.10.25.1.n.y.5x.7p.2u.6v.a.1.46.79.6e.1p.45.1.1.e.67.r.16.7y.l.c.1z' +
  '.b.d.14.1y.13.4w.17.1.1.2.68.5.30.2g.18.x.4.n.19.3.6f.20.3c.5e.3y.g.12.w.5a.3o.29.9.1r.6q.1b.3.8' +
  '5.2l.n.fs.1i.37.r.e.5e.13.m.2t.2g.1e.9.17.r.1.1g.7.11.1a.j.a.1k.j.3z.c.25.q.1l.1d.3.y.18.o.2c.1.' +
  '3i.c.d.h.l.17.8.2.2r.1.1o.1.1.1.1.8v.n.30.6u.16.1t.42.2h.14.t.11.u.15.26.a.u.1b.60.1h.5t.7e.9.p.' +
  '1h.6d.i.54.2l.2p.3m.1l.at.5k.7m.7x.5d.1t.4.66.52.15.u.b.2v.55.a0.7.p.4.32.2j.1p.1b.c.1v.63.1o.k.' +
  '8.5g.10.6u.4e.cj.23.22.24.1.2t.1.1n.2k.43.l.v.3.br.1q.2k.1t.1c.a.g.1t.1.4.2.7w.2l.10.23.4.r.9x.1' +
  'u.11.3b.6.1n.32.f.9.1.1s.1u.p.1c.3.4o.23.1m.o.2v.9.37.1m.5.f.3.g.4.b.7.3.9u.2c.2k.2d.2j.67.1h.2d' +
  '.2f.b.7h.2b.bs.97.b.5f.27.i.d.6a.8z.q.5.4.1.2.d.d.5.2m.m.3.16.11.3o.o.74.4y.1v.3u.t.4v.1n.4s.2l.' +
  '5n.j.5m.k.2.2.4a.28.1.2.14.9.4.55.f.1f.17.p.31.j.73.4f.19.3s.bo.3t.hp.u1.4u.2b.3a.1x.4.3l.5s.5e.' +
  '4x.1h.1r.4z.1y.q.1.1k.1m.3.b.iv.p.r.c.3d.7g.4q.e.a.k.1i.1e.z.1a.y.b.1.19.37.2.3b.7.1y.1f.a.2.j.v' +
  '.1w.2.1.13.1.3e.1.o.9n.8b.4t.6.k.l.22.6r.4w.1m.1t.48.3.52.4.1c.4f.3.4.3.1.2.6.24.2e.9w.3h.7x.6t.' +
  't.1w.2w.65.9z.cm.2d.7b.1j.ea.7.1j.2i.br.7f.10.32.2.8c.3c.e.3c.4r.h.v.2z.2o.2u.w.2d.4n.76.3q.5.3j' +
  '.f.1.2a.1d.30.16.g.3m.r.1.1f.2q.9.b8.2i.9y.4c.1.s.ao.f.1d.15.1o.1l.1k.34.e.z.3f.i.2o.5a.gv.1e.4y' +
  '.u.6f.38.4e.2o.3e.7v.l.42.e.h.11.76.n.5.14.10.9e.d.1g.t.1h.3r.r.40.1k.7c.6g.4o.9e.1c.5w.6x.14.p.' +
  '1.8.1q.8g.5x.55.1m.54.5.u.z.be.3v.3i.j.1y.4.23.7t.2.2c.2.12.d.75.fn.r.w.bl.1w.73.9.b0.1g.2d.6b.y' +
  '.3.p.ar.9u.3g.25.6.5p.2q.1a.16.3q.e.9.1b.4y.s.46.f.13.2z.2b.1k.3.q.j.1e.2i.2n.w.3c.1e.4v.11.49.1' +
  'i.ae.7s.32.69.y.3.1s.4x.v.1a.2i.5f.6q.41.1h.7.2m.4m.1b.k.e.2u.5t.3p.4p.5j.4f.11.1.s.2.1.2e.o.r.1' +
  'b.2f.y.2.10.h.5g.2.3b.2o.r.2.t.2.8s.h.81.13.2r.2p.5v.1x.51.5h.2i.ar.17.3x.30.h.29.1c.1b.5d.h.60.' +
  'n.18.37.h.k.2k.23.1n.t.1z.5.fu3q.4f.r.20.ay.x.3l.6.t.5u.6z.e.g.4q.10.3.1n.39.1o.1.17.g.2.19.t.7.' +
  's.1y.16.2r.6c.d.j.w.g.1p.2p.38.3.6f.z.5s.1v.16.3l.15.cu.2y.8.c.z.8.m.1h.8h.2i.r.3e.7.1q.18.46.3.' +
  '2.3x.51.2c.s.b8.c.l.z.f.4a.t.o.f.4e.5s.h.e.rf.1o.4.27.v.5.d4.x.7j.cs.e2.6h.4.1.1.4v.6.2.1v.52.89' +
  '.15.6a.1y.9n.40.3t.2l.9.57.b.5n.15.f.69.7u.1o.2e.i.14.72.8e.16.1g.2y.k.2v.2e.i.1t.1.80.1e.35.2c.' +
  'de.11.o.u6.59.29.1.2e.xy.14.g.2.9a.4k.1u.n.1c.1.6r.8d.k.27.3k.3l.1m.3k.8c.jh.3.4l.5u.8r.2f.1k.8h' +
  '.6h.u.1d.x.1q.80.1.l.1.9.3t.7z.14.f.9.aw.4f.cr.7x.j.2n.j.14.h.2i.8.a0.b.78.5.x.6.7d.7.d4.1w.c.3.' +
  '4t.3b.5g.4x.5p.5.9a.1f.32.1i.2q.h3.8w.3.h.8.p.4t.1.9k.42.4i.1.6.1q.2l.7f.2.1w.1m.l.1s.d.1f.1.m.1' +
  'c.9.14.3g.r.1f.4o.b.3e.2g.1p.t.16.38.av.4.1g.1p.2q.5.1m.af.aj.4c.1e.80.6.9j.b.h.45.1j.o.5f.2l.1j' +
  '.1.1.1.1.1.1.1.1.1.1.1.1.1.l.3n.32.3.1.dn.2m.3.c.9y.h.2r.16.27.83.5g.2h.58.6j.1.1.17.df.8i.b.55.' +
  '70.76.4.1u.6c.3n.5q.16.4f.3y.15.3p.4r.9.1i.w.90.4l.3.11.6z.5k.4o.m.40.2a.m.13.e.w.6.27.1e.1a.1b.' +
  '1a.3e.6t.24.t.8.19.76.1b.24.1r.13.4.6g.p.7i.s.4m.11.d.7k.1b.2q.15.m.5c.2.7l.x.1i.a.i.96.i.2q.1i.' +
  '1g.j.5.6g.4a.2r.17.q.t.2x.1b.2f.3.94.4.2p.j.5y.1e.3o.4g.f7.1q.u.as.2v.1.3b.b7.6l.3o.1u.12.70.9r.' +
  '1l.8.9.2p.50.7d.13.2g.t.hn.v.1t.r.3.3x.b.2h.u.94.1h.12.y.1s.ba.40.5v.3q.r.4i.1c.1e.6g.85.1b.f.3.' +
  '13.1.19.22.m.1w.3.7.1o.c.5.p.13.1u.n.8z.5e.19.8.o.1k.1au.73.20.b.s.5n.2.2j.u.1v.3.1v.5y.19.l.7c.' +
  '4d.y.1.1.4n.2e.38.2.a.5t.1r.3f.1k.z.z.d.cf.ah.34.1a.14.94.2f.1l.e.8e.51.8.3.1nk.9y.5.1y.5h.c0.1.' +
  '8x.62.1i.9k.8w.1.2.b.11.a.86.i.3o.du.3j.r.5n.n.1.5j.6o.1o.9a.f3.qj.1i.bz.16.b.9.6l.1s.1i.63.73.g' +
  'f.ee.sb.bj.2.4t.4.2.2t.2f.bh.6r.a2.2f.n.79.3g.6u.8.s.8.7.3w.d.1t.8z.b.59.5i.9s.d.59.4f.6.6c.11.8' +
  'j.nw.1i.27.ci.6z.1d.3w.6.1n.x.3c.1.5i.y.7s.w.1l.25.4a.10.2.1.j.2.d.y.9r.6.k.1i.1s.b.3.35.1.1j.8w' +
  '.1l.77.a9.32.3.4n.3m.c0.cz.5.1p.l.15.2i.3b.1a.dw.ga.15.bt.b.lg.6c.7v.34.7u.6y.q.l.5l.6.2f.54.3l.' +
  '40.1t.9d.57.ie.6u.7a.fx.9b.8.x.55.21.30.p.6s.4q.6.6.17.15.dx.7.89.11.5.3f.7s.7i.1i.1v.4.9k.jy.69' +
  '.2o.12.l.ga.34.55.y.2z.un.it.e.8.7p.1.14.8f.1v.x.rr.p.gz.bk.io.gx.5.wf.4i.3y.ah.e8.ae.1dj.jg.5v.' +
  'y6';

/** 639 spells. */
const DISORIENT =
  '2r.j.1iw.63e.3y.15v.165.4l.3z.m.vh.pd.fn.gy.1.1.2o.a7.fq.l9.o2.i2.sx.xq.84.cp.g2.2.ci.1l3.19w.e7' +
  '.1.lg.mc.37.1.oa.6l.ga.l4.kw.14q.f.14.9v.5l.ge.nw.3q.6.4y.7j.qk.i3.b1.ur.2j.nf.1r.t.m2.2s.1o.gg.' +
  '3p.5o.3g.rj.n4.2e.q2.f.aq.l5.81.mz.129.ct.9d.iw.uv.m9.36.va.2va.72.n0.1a4.7s.bk.1n.27n.7.vv.4f.2' +
  'b.mr.1ua.ta.30.p9.bz.z.dl.1ax.4u.8v.2j.4t.1mc.6.o5.m4.u.i5.w6.1e.iu.a8.6a.1ho.5a.up.1ea.2r.225.m' +
  '6.40j.rf.qd.1px.t2.3d.p1.2vk.12z.d.1.s.6.58d.co.ua.r.du.1we.2g.1ge.4ox.2w.d6.tn.1ss.268.94.13t.b' +
  '9.bt.m5.2lt.2b.23q.5.4.29i.j0.1pp.b0.97.1r.lz.1za.i2.n2.oy.1k.j.26a.gl.18b.fx.ju.1.1.h.bo.qk.4v.' +
  '5n.11y.bl.3i.ou.5u.my.o2.3f.1n.1ev.4s.99.1r1.dc.n.1f.2n.kt.z0.ps.r4.29.m5.6.cd.d.3.xo.pa.4o.tt.3' +
  '7i.1n7.jw.7c.c7.1wq.2oz.hm.16v.pf.1iy.be.y9.wf.3q.b9.v1.9i.1c0.45y.6r.nt.q.gw.qp.re.ce.41.13l.4s' +
  '.ht.8u.1.4.1.1.1.1.1.1.1.1.1.z8.wb.cj.3m.1w7.2e7.6m.2dp.1mc.3b.wb.1j1.ef.14z.9d.67.ph.ar.60.ew.d' +
  'h.w.87.3.gy.oe.10g.va.5f.xe.5i.xy.1l.10m.6u.h9.ie.ra.pr.z.ce.ah.6k.90.4m.bl.36.3n.2g.20.hb.y.9n.' +
  '8t.ah.9m.3s.gg.1h.16.1x.sf.13m.89.7n.6r.34.vb.4w.92.bg.1q.d9.b8.6.2.j6.2z.2h.lu.2.r8.97.cq.71.6c' +
  '.a5.78.1v.1e.6c.g.39.ni.6e.7w.10.49.k5.5l.es.99.8e.lf.b2.bs.ae.m2.k.1.5l.6u.3f.bg.1.4.1.7.1.4k.4' +
  'a.4n.ei.1.hu.b.bb.5d.9w.24.i.2q.2.8x.1.1p8.e9.1e9.zk.4n.7.71.r3.2.in.gs.6a.b3.11n.m.2a2.o1.gy.br' +
  '.bx.18f.p.1no.1c5.ag.18f.64.8r.1a.14j.1k.4n.wf.4d.1c.2.jp.24.m2.6y.hb.k7.ek.6x.84.79.7x.sm.4a.hb' +
  '.1m6.dj.1tg.1dh.5z.1a.c1.3w.n6.91.a.to.4s5.5a.g.pp.1n.7m.kj.1e.10p.97.2d.ij.r2.1r.bp.7p.29.38.25' +
  '.cb.10t.kp.g3.1b.7a.3g.86.71.6b.gx.f3.d0.1by.co.q4.1fb.3yg.14.5t.rp.1lo.n2.7b.k0.2g.1b9.u7.2c.2i' +
  'a.d8.qz.25.6k.aq.a4.x.rv.1eh.1l2.fl.rb.2w6.9e.6d.sv.21d.24.1a2.z2.1j5.1s1.72.b1.14.1a7.gj.9.1g9.' +
  '75.1v.pa.8o.sc.7u.w.3e.6.87.3y.7o.1.1.5qk.zn.m1.4c5.a.jw.126.jp.am.1pr.4o1.ud.35.2g.7x.ba.1id.b1' +
  '.51l.3o7.46.2as.zk.2ks.10i.91.1hk.46.9f.6e.8h.b1.fk.1tf.21.13.o5.3r.a.gq.2l.xy.cc.nn.1b.oo.4.ud.' +
  '2zy.1e5.1dm.n8.fyfl.3t0.ctz.vp.113.51c.3b.g8.1jj.2o.1k.7gv.vv.28.4dh.1l.y.qu.cr.yu.2i3.rh.c.5ej.' +
  'dx.79u.3xo.kz.1fj.ek.8f4.56x.2mg.f';

/** 774 spells. */
const FEAR =
  '161.2sl.34.6m.1n.jg.37.62.t.9.1j.3c.8g.8i.k3.2v.dm.2u.ht.o4.1d6.ce.1z.ob.60.b0.1uw.1hf.jj.7m.8t.' +
  'qb.ia.ez.t.lo.8.5i.av.bj.17m.ff.6b.2.5.l.e6.1p.k.qd.v.9p.91.2p.js.18.49.2q.3h.3x.8t.du.u.1i.v.3i' +
  '.b.79.9l.7.13.fq.1y.5l.d0.bp.bl.6q.14.2n.9b.1r.37.f7.5y.7o.w3.85.s.rh.3i.2h.2w.9d.1t.7x.1.2u.1z.' +
  '1l.y.5p.c.6i.71.8j.12.ah.x.b5.28.7y.yu.4z.fn.4e.fc.k1.si.ay.x.6t.r1.gy.fc.be.hw.h6.3l.de.79.2v.3' +
  'g.aj.5z.i7.k2.l2.dj.1bt.vq.138.jr.10i.s9.g9.17.8z.of.1f.e1.w5.7e.b.32.z.gb.1da.hc.vl.f.1x.1nq.36' +
  '.hn.1r.yr.2g.p5.ce.5p.2oy.1hg.zd.z.db.of.76.18g.ye.1uj.l.k.17w.jt.17l.2b.2uh.ic.1s.jy.r4.3m8.778' +
  '.14y.2pl.zq.28.fo.1no.1k.10.1.4m.nf.u.q4.e.9h.ct.2l.s.sj.s0.7p.27.3c.xh.2w.e5.dx.8j.h.3r9.p7.78.' +
  'tk.ei.1ha.5d.153.ep.5n.192.1m.dz.zq.qz.20s.ir.18w.1n0.vb.2o.5g.133.6r.3b2.rm.bq.1f.z2.m.103.3w.7' +
  'f.90.er.6h.90.m7.t6.1bv.1hu.1ms.5p.c1.l0.14t.5l.1tx.qf.2x.8g.m8.2m.b7.3h.i0.d5.90.6jv.5n.zk.35.g' +
  'k.1es.gk.bt.12.1ge.mp.4j.4z.m.6l.9s.1iz.4o.dg.3y.kd.w5.pn.z.134.1pn.xe.a.7.5t.fj.8z.1ub.d3.a6.10' +
  '.f5.ct.94.bd.8a.9b.yn.8d.7o.u.7p.lq.5s.7.db.7h.1.ej.65.aa.h1.14.7.6y.80.24l.8s.1i.6c.he.pe.1ia.q' +
  'p.7o.2.vl.19q.az.bz.26m.3j.1i.64.gz.9.5o.k.18.lu.8j.99.f.pr.1.b8.iw.bk.kf.8l.to.kt.2x.uz.hr.b2.6' +
  '4.ld.1v.26.ps.bw.p4.7l.j.87.lj.96.va.io.2y.6b.81.1lv.11.2c.rf.fu.11.2r.1o.9.11.ah.pe.u.ii.he.dl.' +
  'gb.13v.lq.15a.53.bg.54.6u.6t.3p.v.hh.h4.ko.j4.3t.4o.7d.8z.2v.8a.u0.92.y.3y.ee.bo.36.37.i.16k.e7.' +
  'of.1bm.ej.4t.27s.29.52.4t.lq.gf.8q.nw.3p.ar.ba.y.go.bg.1m.xj.jj.da.3q.nw.fj.t.bx.dh.fj.r2.q.1eq.' +
  'nx.25q.1.s1.u.24.24.ye.cd.ec.eh.3m.5n.ox.ka.1b6.4m.ma.9r.4g.cn.in.le.l1.7q.3n.xg.41.6w.am.2.4j.1' +
  'pm.1x.177.e0.1g1.zq.m.8.a7.op.2h3.hs.2.5u.8y.cq.1e.6o.1d.xa.6o.1sb.9f.1lm.29.hc.19j.lx.39.9x.77.' +
  'rg.2l.2x.tz.gp.2c3.6a.7g.3w.c9.23z.5b.8h.2e.p2.7h.ey.a8.1m3.d2.9h.ny.6m.7q.f2.r.34.6t.4c.48.6a.3' +
  '4.wn.ia.76.1a7.2hi.j2.o1.15z.1px.wd.3g.a1.1g.cl.n8.kg.10r.vf.2jx.wi.fu.ug.rx.le.jb.r.7y.ou.ef.h0' +
  '.k5.s8.rk.yi.36.bb.175.4v.2e.a5.1n.1e.bs.1w.z.4u.12f.1.1.12f.c2.ro.1jl.ju.1dt.6y.14j.1w.4.bt.d2.' +
  '17s.14w.v3.rm.50.1w8.1sm.7a.28.9j.2b.1a.1o.sh.gq.1hb.aq.fd.6k.fw.zg.6c.29.sl.ny.4t.1y8.1rz.2o.v0' +
  '.57.8u.tu.i3.3es.166.og.5jk.6m.b7.1.az.hb.h5.1m.i3.1.11a.hm.4w.bn.mx.5y.2m.4h.eo.155.2k.ns.4e.2c' +
  'q.60.1yg.nb.m.g0.1tv.iv.16j.tc.19t.flfb.95r.wl.2a.144.t3.69w.159.49.fj.4ju.gl.va.1f.1bj.31l.5t.2' +
  'db.1a1.467.hb.42.u9.ne.zo.bw.2m.8d.1c.19d.5h.182.9f.1he.1i.49.bj.1tr.yn.56.nz.2zg.bt.4.1ck.6mz.u' +
  '7.1ka.19t.1nc.1if.6p.1i2.9k.jh.ag.e5.ht.fu.e.x.1rc.te.29i.6fi.3v0.30.5e5';

/** 372 spells. */
const SILENCE =
  '6c.um.1qr.1q.gg.25.1uu.10j.6o.jn.fo.sg.1i8.bj.1y8.g.11j.140.1d.tm.bw.271.f1.5u.dx.5c.e5.1w.19.l.' +
  'bc.dr.b1.g.15e.1p.5e.ji.7i.jz.7.aw.13.7u.7o.3.2.9j.64.7n.gf.3a.hp.jg.31.57.6b.4u.2v.kc.bg.fi.3m.' +
  '7n.ge.40.3l.re.9l.3z.60.1r.3v.1kg.2c.27.qi.4.5d.7l.no.13u.y1.zy.8f.12p.7f.7u.136.55.85.80.wl.p.p' +
  'r.1z.xx.k.95.uy.jt.12x.2.2r.i.236.i.uc.xw.1.1.1.3.2g.1d.bv.1b.y.ku.2n.7j.5p.28o.8w.3kj.9f.y6.3or' +
  '.3b.hj.86.157.133.82.bo6.1d9.nf.kn.id.ben.1z0.1ic.fc.ai.vk.31w.fk.bt.sb.4ib.be.2fm.7qy.zl.1h4.2c' +
  'q.9w.p6.5j.gl.31d.17.1sr.125.34s.18h.h.lj.70.u.8.5.4.6a.6j.9d.1i9.50.gs.16.4uh.1rm.ef.pj.ez.3gk.' +
  '14.3fp.4o.2fg.4r.1o.2gm.179.ay.ex.1qp.1by.30k.5c.2o.66.49.dg.zr.s.1ky.8k.r4.204.ea.57.ai.1hc.uk.' +
  'i1.2ty.2py.1tn.118.y8.2n.1g6.d8.8s.eo.2ia.2g4.ha.1md.165.vp.a5.2s.w.2yb.9k.4nv.s9.33g.115.1ef.1z' +
  'r.3o6.be.197.1oc.sq.2zh.14u.2p0.un.8i.zj.t4.39i.ps.14t.30.1ok.8.2h4.162.t8.1ij.15y.1b5.69h.ve.1b' +
  '2.b1.r4.ex.2qh.2dj.g0.1f2.1i4.8i.hv.13.29a.19v.cv.1s.2vr.1k0.g3.31.19j.vf.1n.59.3zc.7a.br.2ms.qu' +
  '.6e.1j3.1.h1.3nz.5iu.1h9.2v1.13o.cq.20n.6sg.1b.3h8.3l5.34.26c.2c.5ld.qc.2ve.a5.23c.14s.29x.20a.6' +
  'z.51.k8.o.1c1.25k.1e1.19r.wc.in.is.ia.1j.2o0.zp.3s.pc.kf.gr.8ku.17n.4kv.86.fus5.15l.eo.2de.4y9.5' +
  'uw.1ph.n1.2b3.16f.3uw.2id.dc.3jd.44t.3yz.dh.432.5uo.6l.de.qy.cj0.17h.14z';

/** 3042 spells. */
const ROOT =
  '35.9.61.4t.6h.1n.242.31.10f.75.r.4d.l.3z.qu.gr.4f.83.1.4u.59.4s.k.4q.y.i.d.xb.1k.7v.2u.ll.b.t.1.' +
  '1.g.bg.fg.b.2j.2t.1.61.1.a.75.b.1.49.21.1.9r.k.j.d2.bq.od.4c.bc.3.1l.1.25.nw.13.1m.lb.be.hi.4t.6' +
  'x.4e.iz.1n.lr.4w.19.hk.g2.7.5v.80.6e.2r.1k.3g.b.1n.7x.3r.jc.ey.9y.tl.18.1al.24.v7.nu.3y.2v.5o.6i' +
  '.jy.b.q.3.24.1.1.15.59.23.3g.56.5a.j.1d.3g.dq.2k.b9.13.6.bd.y.a.4j.1r.dl.2i.5.37.94.3j.d.l.1n.ho' +
  '.81.78.66.1v.q.4i.ct.u.9j.5u.2.g.29.54.m.3a.5p.6n.c.3f.s.3n.22.26.6m.1p.8w.39.3t.3u.6.7.4b.18.l.' +
  '3t.44.a.5l.au.2w.b5.8b.22.14.8y.99.29.k.1l.4b.1h.b.g.1b.2o.aw.5k.14.gk.ca.27.fv.5h.8i.43.5y.70.4' +
  '3.6n.4.32.d.4k.dd.6l.55.2n.66.4u.9n.e.6z.7.7f.11.28.6.gd.20.6j.d2.do.3j.2o.3.8i.66.1c.3e.2i.1a.1' +
  'e.8.1z.1y.l.2b.3c.l.1z.e9.45.75.f4.x.1x.55.70.2p.de.8m.5r.1p.9x.19.eu.13.ln.b.6.8g.12.8u.q.3.2s.' +
  '7.2f.i0.t4.99.9.25.2m.n.h.ad.l.85.t.3i.v.1l.1b.o.8.74.p.1.17.pv.1f.l0.r.30.22.q.1v.5n.h7.1t.3k.1' +
  'b.12.b8.g.r.7z.4j.7d.q4.di.4j.1f.1v.16.27.1a.34.q.31.7.5v.da.29.2g.29.3o.g.70.7t.9g.7.36.4d.1d.1' +
  'u.9.n.7.6.1.1.4p.4h.29.2g.h.19.1u0.38.2n.14.36.2e.1v.hy.2s.f8.75.7z.dp.5x.hq.47.h7.5u.3x.1z.79.3' +
  'f.1c.1h.r.18.6n.my.n2.3k.o.it.a0.9i.7t.86.9w.36.9y.78.w1.af.al.di.bu.90.e.cs.9e.i.31.7t.me.d7.67' +
  '.5b.e9.3i.2i.4a.16w.3y.2p.dd.l2.38.dl.dm.8y.h.s.90.qf.nb.fp.43.5q.2z.m.4s.13.35.bp.ka.es.4.1j.9d' +
  '.3q.5b.w.11g.xp.t.22.bn.2y.d.av.43.u.43.1c.2u.2k.29.82.nh.or.fz.la.98.115.16.50.1bj.h1.1w.16y.3v' +
  '.3g.1.9.4.1x.9i.5.id.5p.2g.a0.4z.6b.2g.13.13n.37.4o.w.i3.py.q.4d.56.h0.1.1d.dn.19b.1d.ak.11.go.b' +
  '.h.3h.4.5p.hx.h0.12.2.45.5c.1w.z6.l.f.3o.9g.eg.16.30.2l.5z.14.23.5.qy.k9.fp.ic.2x.6w.j.gv.7c.4i.' +
  '33.jo.2v.57.48.1q.4h.g1.1l.5x.kc.5b.9r.1n.3k.2n.ic.gj.3j.5r.l0.2v.ns.h.98.bf.6m.7q.6q.23.bl.t.i.' +
  'f.1b.1.23.lh.yi.v7.j.gy.7c.5v.1s.58.2o.7w.7p.74.3d.h.51.19.3d.2n.5.1m.5d.3g.9b.a.34.9j.6.4h.3y.2' +
  'h.6h.4v.16j.79.7h.4n.30.23.9g.n.2b.4c.55.gw.5e.98.44.1x.74.1o.84.30.av.4i.1x.kh.dn.a.66.d.27.2z.' +
  '1i.1u.4.17.pp.8y.4g.5x.9q.1t.2i.2.2r.ec.2.3o.3p.78.94.p.f.9u.1u.3b.bz.7p.4s.5z.p.10.4s.bh.cl.5g.' +
  '12.31.k.9i.6u.8t.2q.c4.b.a.ua.q6.1.g.4o.7u.66.2z.bu.ke.11.8.7.bf.7g.3m.an.c0.3f.2u.2x.37.7x.3w.3' +
  'z.1h.3.q.h.59.42.2q.4d.4l.2z.1f.2b.1t.r.1g.1.8d.do.1.75.8v.3c.21.en.g1.43.5t.6j.2o.4c.2.8p.4r.13' +
  '.24.v.7r.8m.rj.a7.58.58.7v.lh.x.2.8y.o5.1.6.1.6i.o2.h.t.4g.15c.26.dj.45.9r.1.76.6x.3w.7h.42.5n.d' +
  '1.1.k.2.2y.38.8.2f.ep.64.ai.35.57.88.18.7n.4y.76.17.5o.6c.i.56.2h.p.d8.ks.7w.5d.8b.1e.3.ab.17.10' +
  '.3i.g0.60.55.pc.9.l.c7.6p.64.8.3t.18.3j.c7.1.j.84.3b.9.y.b1.5b.3g.f.7n.1j.4g.5q.3.2l.10.fa.1u.2q' +
  '.w.7p.7.1.8j.1g.3v.2.2.7a.6w.t.69.1d.3w.w.1.1.21.p.m.1k.42.4c.j7.a8.2s.7f.d6.14.1.66.15.1q.7w.g5' +
  '.7v.el.66.6a.53.3x.2.1p.9.5p.h2.42.1e.3x.l.1p.20.o.2k.2s.7p.m.4f.s.2q.9f.1r.17.1v.4v.i.8.7i.1.15' +
  '.7v.lc.1p.e8.ah.2x.d4.4o.9.x.1s.4v.6l.bj.3c.6t.2z.g.13.2s.3s.2e.1q.3b.p.1c.gx.6h.1h.q.1g.1.o.b0.' +
  '29.57.l.d5.4r.2l.25.8d.47.1d.3h.3p.53.4t.fi.20.w.51.5e.1m.eb.lq.ap.4f.28.1w.pl.b.la.mq.7j.4.9y.n' +
  'y.5l.1k.6p.1.1i.6c.5p.kb.3h.ch.lr.kw.6z.b.4b.57.b8.ic.3b.d2.cl.2o.4o.b.au.1r.1f.3q.43.1x.58.ah.5' +
  'm.7l.2a.116.b.6o.2.3r.9b.53.2.5.54.71.5.87.cx.3z.1r.48.2m.2r.4b.102.5k.sa.7s.s3.8f.ec.3n.8.2g.9.' +
  'c7.4l.3b.1b.j3.14.10.au.20.5x.17.tu.5o.6o.50.1e.9f.51.2i.i.8n.8.1.13.43.60.et.2p.2r.1h.8i.12.44.' +
  '16.9n.av.l2.5a.7f.89.3j.m.54.2.4f.w.4n.95.1x.2.4v.87.22.4g.22.p.7z.12.5m.h.8n.5.2.gb.7p.26.3s.ca' +
  '.gk.4p.20.35.19.h3.3o.g.76.6k.4.1t.1.2g.1b.15.n.5e.2.1c.f.l.h.7.k.2t.2.3q.47.b.t.2i.6.bw.2r.d9.6' +
  'u.bp.54.5m.4.1.3.8.1j.1z.2.b4.16.o.2m.d.5d.d9.1m.1.2h.3a.mz.37.26.3l.al.5o.64.2w.7k.b.2z.5i.e.a.' +
  'w.7a.5n.5y.2k.8j.md.2t.5x.4c.ay.2f.vp.8v.4h.bg.6z.2v.7h.ai.j.7n.3l.by.1p.1k.y.1.8k.7p.2w.j.g5.28' +
  '.5.r.5d.v.4s.a4.c3.19.4.2p.5o.1w.im.ec.pc.5o.5t.tw.jv.6f.45.6o.2.9.2i.z.3e.gq.5l.l.cl.3i.8j.1t.4' +
  'o.2e.1s.2x.75.y.6.3m.ew.c.6m.m.13.g.2k.16.co.1m.2a.79.df.1e.2k.9.2s.4k.7d.2a.41.v.bc.f4.q.3g.13.' +
  'vk.1a.c1.6j.5x.p0.q4.26.c.e2.7x.e3.38.3.8.gc.e6.14.2.1p.2.2.34.5h.b9.5k.69.1.2g.55.9y.1o.aq.1.9.' +
  '6v.oj.2u.2u.2n.h.71.25.6m.11.d.10.6f.2d.u.1m.33.v.d.62.cr.d.6.26.4r.9b.2.38.bx.32.6c.10.eo.1bs.2' +
  '8.5h.gx.2d.k5.2h.2b.xc.9.10.4o.9t.3j.6.6.25.7.4.9l.a.1.3.3.2t.t.74.12.9z.10e.4.e4.zq.5w.42.3d.2.' +
  '6y.2n.3k.7p.10.5s.c9.e8.9e.19.e.3v.2r.6.27.10.4f.32.22.2o.o7.a.4q.6x.19.1.a.5.3i.dd.c5.2h.dd.q8.' +
  '22.7e.3m.2r.4d.o.2a.1k.q.a.5.6w.q.4a.j.8p.2.1l.3o.5j.5i.8l.1o.jn.8s.9p.49.10.45.4o.2.6b.2h.7w.6p' +
  '.4.c5.27.4n.b0.5h.3n.2.2a.23.7s.ao.2x.49.9d.ek.2b.5p.4g.31.1f.26.3t.i.c.4y.4a.45.96.2n.f7.b8.4l.' +
  '1j.1l.1.w.4a.l0.d0.8z.98.20.5u.ac.ep.6p.94.3k.28.3s.j.61.4w.64.1m.l.2r.3y.u.3o.2p.9k.1q.1v.1h.1w' +
  '.7j.41.4.4k.86.4l.2.h.6e.1x.1s.g.1j.22.22.2t.1f.9.bx.l3.7t.1a.4w.25.11.1q.5p.gt.36.2e.1.81.3t.2x' +
  '.f9.4t.9i.dk.m6.qm.c5.6g.1c.p6.j.h.16.n0.1f.f.32.3v.1y.9v.1y.67.c2.3t.1u.6.1q.bz.11.1.c.92.3o.h1' +
  '.i.2.1n.1.39.72.6i.i.ft.2v.2a.4n.3.u.3j.2j.d0.4c.2.1o.be.3r.2m.6v.29.t.7.jo.2.33.3w.1.6a.dj.61.f' +
  '.1q.hp.w.2y.ex.2k.y.6.s.1.1.1.1.3y.1o.1f.s.1d.2.7u.1p.u.2h.x.50.5j.w.2n.24.3g.1q.4.3q.3e.9h.b1.3' +
  'u.1p.31.7h.9z.dr.3r.1h.1b.q.22.4.6u.14.5f.sr.fz.iy.t.1j.6.16.c8.12.9g.5e.a.df.lu.2q.n.av.5m.e.1.' +
  '3z.3u.6u.24.7.e.8.6z.6.16.21.38.3.17.9.1.12.1.1p.2.4m.2.32.1w.1.3n.2t.6w.4j.p.1.16.1g.2.3b.2.50.' +
  'c.3v.k.h.1.2.1.5v.q.2z.4r.9.6p.1i.23.4.1k.c.5s.1.e.1s.9p.z.5o.1h.65.ch.f.n.3.89.7.f.18.14.4x.a1.' +
  'k.tr.ts.bm.m.3y.88.2k.w.1y.k.1t.12.7k.26.2b.7x.1.n.2r.1.b2.49.2t.b3.8q.3j.5y.9r.14.6.5.6g.1e.4b.' +
  't.m.i.3c.48.6n.y.e.a7.8h.2y.d.2.1h.15.3v.qw.3.m.3n.a0.sx.4l.d.6.k.t.a.1d.7d.1q.d6.1w.7.54.6u.8l.' +
  'e.2u.5z.18.3f.4q.8s.3d.x.i.1v.5.a.9n.g2.1k.dz.3u.4v.fy.3b.ba.g.1x.7.6i.m.2.2.1.7.g.1n.3t.9.h.h.7' +
  '.d.p.s.19.y.2.a.2.4.4.4.2.i.4.3.5.2.1b.1.1.43.x.81.n.h.7s.7.f.5.1a.7.6.3.4.2.1.i.1g.k.f.8.s.19.2' +
  '.f.2a.k.1m.p.7.5g.1w.fo.id.i.48.g.47.3y.35.1.1.1.2.1a.3.5s.3s.3k.4d.f.aa.16d.d.89.v.42.1e.h.k.i.' +
  'b.z.1i.e.10.1i.4.a.4b.1n.5.7p.1o.1.29.4.85.95.54.cs.90.n.11.3.29.k.2.1.j.1.1.g.1.1.1u.1.1.58.1.1' +
  '.1w.1.1.v.1.1.3e.1.1.i.1.1.38.k.30.p.1.1.3r.23.b.2k.1.1.1q.1.1.o.1.1.2o.1.1.11.1.1.13.6v.2u.e6.2' +
  'e.7z.2.a.aj.2.5.7y.p.k.1.1.1.1.1.3.2.6.1.3.2.2.1.3.1.4.1.1.1.2.1.2.1.1.1.1.1.3.1.3.1.2.1.2.1.2.1' +
  '.y.2.2.1.1.1.1.1.1.1.1.1.5h.iz.1.1.1.1.1.1.1.1.1.1.1.21.l.1.1.1.1.1.1.1.1.1.1.1.v.2e.1.95.1.2.1.' +
  '1.1.1.1.1.2.1.2.1.1.2.1.1.1.1.1.1.1.1.1.1.1.1.1.1.2.1.1.1d.f4.86.36.2y.85.i.7j.2.ah.45.2.r.1q.z.' +
  '5.2b.1.1.1z.1.2.2e.1.1.h.7.1.1.1c.1.1.6n.1o.w.1.1.h.4.2.2j.47.1.1.1c.22.1.1.9.4.1.h.1.1.1i.1.1.1' +
  'o.1.1.l.1.1.q.w.5x.10.x.1f.7s.iy.1.dc.84.1.1.2g.2m.4.1.17.g.39.1x.2u.q.1.1.48.2.1.30.1.1.25.1.1.' +
  '24.1.1.36.1.1.k.13.1.1u.6.b.1.1.18.3k.4.1.2b.7g.1.1.1.1.87.8s.1.1.4g.2d.1.1.y.t.57.7.63.1.1.b.5r' +
  '.5a.4r.4.14.1a.2g.1.7.c.t.a.d.20.h.a0.1.1.9.3.1.11.1v.e.34.20.79.2.1.2.1.z.3a.1.1.2.1.1e.2k.27.1' +
  '.1.1.1.7.i2.4m.47.2.1.1.1.4z.6.9.2.1.49.1w.l.i.7o.3d.3y.1q.4.1g.2o.c.6n.28.3f.17.1.1.6p.1.1.y.28' +
  '.1.2.3d.o.1.3.1e.2h.1.1.88.1.1.1x.1.1.54.1g.1.1.12.35.2b.1.1.8f.8.8v.g.3.1.7r.16.4w.17x.ii.51.63' +
  '.7v.35.5r.4.t.hb.f.3.2.1o.1f.1b.h.1.1.p.12.1.1.3n.an.1y.3z.4c.3.4.1r.76.x.2x.6m.2.2.3.3.4l.85.1w' +
  '.2k.3.a5.86.8.25.a.68.p.6a.51.os.5e.3v.a1.d9.6z.3b.8f.2d.7d.9z.2j.4p.1.1.1.2.1.2.2.1.1.1.1.1.1.1' +
  '.1.1.2.3.1.2.1.1.1.2.1.1.1.1.1.1.1.1.1.1.1.1.1.3.1.1.1.2.1.1.1.1.1.1.1.1.1.1.2.2.1.1.1.1.1.2.1.1' +
  '.1.1.2.3.1.1.1.1.1.3.2n.14.s.5s.3q.b4.43.dp.af.av.3e.d.1.8.r.2.15.b.4.8.1i.74.s.2r.26.a1.ds.va.2' +
  'j.7w.ef.92.8.u.3r.a.g2.a7.5h.dd.m.d.8.y.1.ee.1j.3i.16.o.1y.rr.28.8h.3l.2j.4i.1s.ex.6e.3k.1s.94.w' +
  '.1n.6a.d3.ch.1r.6w.7g.k.4q.t.17.6p.6k.h.lx.y.5v.x.la.or.5.55.f8.2z.n.3d.b8.fr.9l.5.5.6b.6k.q.nn.' +
  '6l.r9.56.ns.9.57.gi.d.3.vp.1t.gu.8o.82.5t.39.g.3j.1x.59.z.5.2.3.2.1.2.x.2g.2p.df.3r.ki.ac.2p.8e.' +
  '1q.zl.f.4k.g.7i.2l.5j.2m.1o.6b.h.44.1.1.1.1.1.1.1.c1.c0.94.l4.1.7c.1.1.e.c.im.ftwx.4.hu.1t.4q.e.' +
  '2n.13.12g.28.66.gi.cm.6z.28.97.1h.w.iw.5h.op.wm.cs.ds.4b.zc.oc.8.ba.6.2.2.x.1q.2.3d.fn.6g.am.g7.' +
  '83.1s.q2.7.1j.d.33.3p.136.10.1ay.ib.3p.r.k6.n9.66.v.hp.45.74.1e.fk.69.52.h.29.1n.lz.4r.1i.bs.mz.' +
  'f0.9p.b4.6k.fb.69.1c.16.9z.66.1b.3j.54.5k.5p.l6.3p.1.29.gp.n.3p.33.4c.1ro.hq.aj.3r.b6.6s.1g.2n.1' +
  'r.7r.2.10.gw.ue.1s.vd.4.p.eq.25.r.2e.e7.3.46.2d.b.7c.34.5c.3r.2.2d.dq.1t.cr.3r.ei.3l.2x.e6.c.2r.' +
  '9p.e.4b.5p.bp.55.jg.6w.48.5f.r.3r.a8.bx.t8.6.8.7.b.a.4x.k1.5.3f.1o.9m.a7.c1.9u.3f.3f.l.ac.1m.g.3' +
  'r.4r.g.54.17x.2h.i.2x.6z.al.2f9.7.4m.2f.16.hb.35.3f.5n.3t.j1.dx.1n.215.c5.qn.ue.1sp.54.p6.2i.bm.' +
  '1d.1f.ft.4l.2s.3x.13k.z.9i.10.1.1.1.1.1.p9.43.6n.4c.c1.aj.1.5.dw.6i.49.i3.4y.8m.ya.ma.y.1t.5.2.e' +
  '.2g.aw.6b.b.11.75.h.v.1u.1c.6z.l.17.45.s.9m.3.29.2l.1t.1d.1h.2.5f.5n.6r.59.8h.jv.a2.bn.xv.2k.16.' +
  '45.3w.5h.aq.i.3.132.bk.39.2i.1mr.od.qn.yu.x.6m.7y.ay.m.10w.1zk.vg.lz.27q.3vi';

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

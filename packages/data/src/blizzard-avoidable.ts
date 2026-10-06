/**
 * Spells Blizzard's own data flags as avoidable.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-avoidable.mjs`.
 * Built from SpellMisc.db2, retail build 12.1.0.69933, via wago.tools.
 *
 * `SpellMisc.Attributes_15` bit 22. Nothing documents it; it is read as the
 * flag behind the in-game damage meter's "Avoidable Damage Taken" because it
 * matches the hand-kept list in `avoidable.ts` on 78% of its ids and only 9%
 * of the other enemy damage seen in the same logs. Until that is checked
 * against the meter in game, this is a second opinion beside the list, not a
 * replacement for it.
 *
 * Flagged, every one also on the hand-kept list:
 *
 *   1294836  Defiled Detonation — a death explosion
 *    474234  Burning Steps — the fire trail behind Demonic Rage
 *   1215985  Fel Beam — a beam
 *
 * Not flagged:
 *
 *    383925  Chillstorm — pulses the whole party, dropped from the list for it
 *    397077  Chillstorm — the second id of the same pulse
 *       133  Fireball — a player spell
 *
 * 766 spells in all. Only ids are stored.
 *
 * A spell newer than this build reads as unflagged: unlike a button, an
 * unknown spell is not avoidable until the data says so.
 */

const FLAGGED =
  '3a5v.p4.2h.41t.1tqv.13y.e10.17r.3p.7p.f.oz.ld.11o.lh.81.5d.i.b.ah.11.3.ua.hm.10av.1.2i2.1k.3h.32' +
  '.mg.1uk.bd.16.2y.8i0.66n.11a.33.9h.f4.101.3u.5i.e.25.r8.v.f5.2to.39.16.b.b.f.27.3.8v.30.6x.40.26' +
  '.kq.8q.131.4q3.5ey.jo.f.8.1.7f.en.9z.4.ao.1m0.g9.9p.ep.2r.2pn.1xe.kt.ef.iu.6f.1t5.27.4u.n.3r.13.' +
  'b.1h3.me.3.12r.h6y.2j.5t0.1l.19.10d.u.4h.4x.2l.bw.12s.l1.1.3k.89.2.395.f.65.ua.80.1e.1q.y.bb.f6.' +
  '32z.3x.1pb.7lv.tn.th.d.15.6v.4vo.bc.gi.r.47.f2.7y.5l.1cw.1d.dn.6i.9j.75.6v.2j.3u.26.29.2p.2p.p.1' +
  'wc.4i.17.24.4.e.53.ov.ax.13y.gg.2o.38.50.3d.m.7h.5.23.2q.g.1b.56.4u.2.4.3s.7y.4f.2g.1u.47.6.2i.2' +
  '7.n.3.n.2.1.2.1r5b.3t39.1.a9x6.2n.6i.f.14.a.ch.7b.21.2f.1.6.2v.2i.13.1v.fz.3z.99.3s.9.13.10.k.2d' +
  '.5b.2c.k.9.2.1.4.1.2.7w.3u.1v.1e.4o.2r.60.a8.1.7p.17.ff.17.2g.39.1bb.f0.57.1s.4k.21.2v.1.1e.3v.2' +
  'v.1k.1y.v.71.5e.ba.39.37.1u.5i.89.dy.6g.18.7e.5k.aq.b.62.54.br.a.2.6o.18.36.1r.2j.15.5x.1l.4b.53' +
  '.1a.16.108.m3.z.jg.2n.74.8i.d3.7l.6.3.ie.5a.s.5d.95.4a.1h.v.5j.21.da.v.2c.3k.2c.7o.3w.1.2d.4.6.3' +
  'd.x.bg.l.s.x.1n.by.3o.1i.9.2z.d.4.1.2z.1q.1j.ae.4z.l7.3r.9.2o.4.as.d8.4t.6h.q2.60.5y.fq.1g.4s.6r' +
  '.gx.db.33.1.i.3l.vr.3k.1z.6s.2z.1.3o.w.14.2i.v.15.15.1.2k.1s.gj.7p.53.49.1.l7.ei.94.1v.2b.5.2v.9' +
  'n.1h.22.9g.1f.2a.if.7.4e.5k.4c.1.74.4j.m.m.7m.n.dd.h.24.34.9.5p.9a.1g.w.6r.2g.w.2.7b.2r.29.12.7f' +
  '.22.90.61.3q.1w.2n.1o.at.4.27.14.3e.28.1h.1f.4f.1g.1x.cn.h.2.i.11.4.4e.57.6l.3f.q.3.5l.15.k.1o.6' +
  '8.1y.8l.1o.6h.t.1o.cr.1d.i.1a.32.3z.u.36.x.h.as.2y.2b.q.b.1.3y.w.7u.1w.3.4l.34.1p.2n.4r.o.2m.4l.' +
  '2a.ae.19.dx.77.i.1t.19.1d.a.r.12.j.50.23.2.2i.r.t.1x.16.l.t.34.6.o.15.1r.4m.av.32.e3.6.1l.2y.1a.' +
  '17.5y.95.e.2.1q.73.8a.14p.5r.17.y.6.6b.11.6w.4j.jy.4n.c3.7v.c0.d.7k.5.a8.31.85.2i.4.5x.1t.2n8.3.' +
  'cc.9.h3.122.j.gj.3j.52.15.s7.ci.3l.1.5t.22.5s.b.p.8y.2b.b.5r.1c.1v.4k.d.8y.1v.30.3x.3.e.28.1v.h.' +
  '1h.1t.8g.1.6q.27.2u.1u.2f.4b.7.1x.h7.2b.4k.6q.47.gx.k.d.2o.1x.2h.eq.11.ar.bw.ew.dv.j.aq.54.20.fm' +
  '.g2.4l.17.o.34.29.3c.7s.58.52.4z.17.92.5v.1b.3p.9h.98.bc.6f.a.1y.7.14.i.3.1n.2.s.c.h4.2p.4a.39.4' +
  'y.86.3i.6t.1e.1.4.1v.2c.eq.1.1.15.2.3b.2m.5i.lr.5d.1t.1t.u.1p.2n.fb.2p.13.6.1c.2u.n.bq.by.38.1.m' +
  '.45.u7.co.11.bl.1f.2.fo.72.v0.7.6.63.j.5r.4a.3l.2.2v.3.9y.24.57.k.dj.9.4f.1.an.ht.7x.c6.2v.u.3.1' +
  '.gz.cu.b.6m.k.5.ns.ek.5g.96.f.n3.ew.a.mw.1mz.2fb.g';

let table: Set<number> | null = null;

function decode(): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of FLAGGED.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/** Whether Blizzard's data flags this spell as avoidable. */
export function isBlizzardAvoidable(spellId: number): boolean {
  table ??= decode();
  return table.has(spellId);
}

/** How many spells carry the flag. Exported for the test, which asserts it is not empty. */
export function blizzardAvoidableCount(): number {
  table ??= decode();
  return table.size;
}

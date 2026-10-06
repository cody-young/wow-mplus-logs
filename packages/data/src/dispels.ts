/**
 * Which spells are dispels, and which auras are enrages.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-effects.mjs`.
 * Built from SpellEffect.db2 and SpellCategories.db2, retail build 12.1.0.69933,
 * via wago.tools.
 *
 * The log names every dispel outright — SPELL_DISPEL and SPELL_STOLEN carry
 * the dispel, the aura it removed, and whether that aura was a BUFF or a
 * DEBUFF — so what these tables add is not detection but judgement, twice.
 *
 * DISPELS is every spell carrying SPELL_EFFECT_DISPEL (38) or
 * STEAL_BENEFICIAL_BUFF (126). It is needed because the log uses SPELL_DISPEL
 * for more than dispels: Cat Form, Disengage, Tiger's Lust and Demonic Circle
 * all log it when they shrug off a root, and none of them carries the effect.
 * On eight real evenings those were a fifth of every "dispel" a party member
 * cast on their own party.
 *
 * ENRAGES is every aura whose dispel type is Enrage (9), which is the line
 * between a soothe and a purge. It has to be the aura rather than the button:
 * Tranquilizing Shot removes magic and enrage alike, and only what it took
 * says which it was.
 *
 * 268 dispels and 717 enrages. Only ids are stored: no names, no
 * descriptions, no art.
 */

const DISPELS =
  'aa.2x.1g.1.1qm.3i.iz.1.py.ct.qf.8b.jj.4o.nw.q9.u6.k4.2c.l.4.2jl.5.3b.n9.hr.kn.1t.ab.2w.59.9p.1hy' +
  '.d.88.gx.54.5f.7z.oe.t4.ay.cv.4j.sg.jq.1g.o5.pw.h.e3.gl.i2.2a.1.fx.6t.4o.6n.18x.1y.p.5c.sp.5u.21' +
  'f.1u.16q.ct.ev.1az.260.34j.2ax.vd.1x.23.2v4.r.1ni.2uy.118.j2.1kv.e6.1.1n.12y.1a5.64v.2l5.1y3.46h' +
  '.12h.2uq.7r0.672.2p6.5i.y.3w.7kw.m4.2pz.266.2np.2a6.6t.ceu.3y9.7f2.vp.2.jf.gu.m7.q.e.4o.1z.2y.xb' +
  '.1d1.30z.1qq.af9.2i.1.2.2.2r.2bc.1v.l.2iv.1ek.9m.6n.1rh.11t.2nz.6o.4b.k.rm.a.38s.13.7p.1ws.4dm.4' +
  'ga.f9.1kx.5v.5s.u5.cp.22o.n7.s4.2y0.er.6uu.9.q5.3k8.md.16g.14.27r.23v.34h.1.4vo.7xk.2zw.2pi.1fe.' +
  '9y.t6.2zf.16o.1yi.3fo.c.z.h.1aq.7qv.6xn.4m6.bx.16i.32m.1.1.1.1.1.1.1.73o.84.2lc.1ao.1.1.1ho.1qu.' +
  '1xg.24m.4k4.16.vh.a8.1pb.c5.9b.1n.24e.13t.kr.bo.77.9j.1co.lp.oy.b4.3pv.in.405.2.51l.vm.8vc.ll.12' +
  '4.4ao.2.q.1.3ch.3bk.4uz.si.1li.72m.1pp.5.1ck.z6.39.kt.4uk.rt.c1.ga70.37p.ds7.1cz.6xz.5b4.1.b5.kx' +
  'x.r3';

const ENRAGES =
  '376.36j.96.4zi.i7.tv.1bg.2.qe.a1.20o.jg.3l.2d.11f.11k.a.1sg.qx.vt.tb.af.m7.yk.c2.7q.8d.216.17.93' +
  '.1z.3c.du.a7.f4.dx.el.i5.32.2b.yy.14.ay.49.ac.2vr.kj.4.1f.e5.93.12n.60.eu.9j.fi.5b.1b.48.9.1v.mw' +
  '.rn.1z.1c.8i.e0.4x.ww.2b.14.qs.xl.ej.6d.3.a.3d.6v.2u.71.q3.1de.28.27l.ij.d6.10c.e7.10n.1d8.1o.2x' +
  'f.2u.ar.95.1a.ag.158.65.d9.ig.22.8l.jm.et.1u.79.k6.32h.2jx.193.7a9.1.sg.nr.31c.yk.1bs.10z.5i.2ro' +
  '.bs.5t.y0.2n.of.8e.a8.v6.cw.2y5.m.2b.49.3t.er.3s.l6.3i.5v.4z.38.14.139.3o.1f.69.h.fl.5r.nu.8y.6.' +
  'qc.17c.1r5.f1.o.l.3l.19g.252.177.uh.25m.3u.7u.1sh.fh.1gz.m2.bg.1i0.30.em.c7.60.a.bg.ja.so.qm.x.3' +
  'b.sf.7h.1fh.168.a2.li.1v.dj.o.ai.8b.2ec.2vw.bp.cp.js.d9.l9.41.3i.3f.4d.7s.p.4m.52.l0.15u.1j5.o9.' +
  'nn.t7.cx.4c.8w.3.19f.1wz.o.fh.wc.8j2.jk.3nq.h5.9e.55.2sc.1z4.g0.1cm.1cu.rs.m0.1ml.k.1z6.12q.kj.1' +
  '7x.182.1jj.10b.3gf.62t.1j0.2j6.3fk.f8.79.wn.60.2b.1e.3m.2.4e.fo.mk.6.3.7.m.5.i9.34.7g.i.ma.jy.3z' +
  '.1k.uf.od.s9.6m.8q.3t.91.36.1m.26i.oj.8w.tt.r6.m.ef.eu.5l.56.1t.dz.b7.72.1l.7r.89.so.4u.4l.4l.3v' +
  '.2a.r.3e.6a.x3.2f0.ai.564.3y0.1gf.6e.jp.e.ly.v9.a5.fk.bq.17b.x.88.ow.1a.py.2kg.12d.33.cp.19b.k4.' +
  'mk.1z.ra.7i.7k.4m.2b.3p.ui.c4.dh.6m.jd.17v.f.mr.1a.j7.ed.go.90.b0.9o.16.il.b.v.ug.w2.4j.b0.jl.p7' +
  '.ls.ci.j9.bg.6e.jw.4j.ib.te.e.i3.11.f1.96.4n.1w4.3u.zu.za.t.4j.bm.ch.3w.mv.38p.7z.8k.ff.9q.52.1z' +
  'r.2e5.ab.r8.a0.a5.9r.93.fh.36.6m.fh.9e.du.2u.mc.2s.u9.150.ly.2r.fz.12m.47.2di.1p.y.ka.f7.i.as.12' +
  '0.8p.fq.34.ro.71.40.qg.ct.9b.8h.12h.5.35.fl.3.pr.14.1qa.zk.f.dt.he.3m.25.5k.2.ie.r7.2c.xo.fz.13.' +
  '2v.jz.1l.3.kl.in.rj.75.15l.fj.3n.2b.7e.1q.2l.43.ak.g.3q.a.40.36.rg.5j.hf.13.6.k0.b1.g2.p.if.sr.c' +
  '.9i.s.ax.dm.k2.in.v8.s0.le.uo.6.o.1i3.21s.o0.2.8.bk.nt.1jq.1ff.7e.7a.j0.11.dr.1w.d4.v8.1zo.se.6f' +
  '.ta.97.g7.hu.29.89.i5.26y.q5.125.1ds.3th.2s.pq.3v.1j.6l.o8.16q.bm.qa.4e.q6.37.11u.4l.67.f.84.4o.' +
  '7e.27.3r.3y.3f.61.38.nc.7b.20.7f.cq.b2.mb.oh.1h.i5.7.by.63.q.fm.7j.17.20.2z.2y.19.3x.a.63.ua.3g.' +
  'gj.5i.u.371.22o.1q.uh.3au.qx.50.j2.40.a8.cj.h.fubm.9y.4h.z4.3o.u.or.dg.ax.31.9.rt.1.36.v7.z3.id.' +
  'nt.7n.mm.ip.2gq.1d.2s6.ce.7y.4t.w3.19r.7p.1ri.p3.7r.5w.12z.9z.17h.7.d7.g.1x.9j.1i0.15u.1a.o3.xl.' +
  '183.47.16r.a3.6m.1kd.jd.x.37.q3.bd.pg.6w.5p.an.p5.41.4c.th.re.17g.zx.8j.r0.4k.1t.l2.5a.hl.2ek.14' +
  '0.4ni.6ft.1ad.1np.7e.c4.v1.14.1r2.6i.en.2p.ey.9k.79.10r.c4.y2.yg.g.143.4g.pu.2q2.ls.c.qp.1qm.3wg';

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let dispels: Set<number> | null = null;
let enrages: Set<number> | null = null;

function decode(text: string): Set<number> {
  const built = new Set<number>();
  let id = 0;
  for (const delta of text.split('.')) {
    id += parseInt(delta, 36);
    built.add(id);
  }
  return built;
}

/**
 * Whether this spell removes auras by dispelling them.
 *
 * False for a root-breaker that the log reports as SPELL_DISPEL, and for every
 * id the table has never heard of — so a dispel added in a patch newer than
 * this file goes uncounted rather than a shapeshift being counted as one.
 */
export function isDispel(spellId: number): boolean {
  dispels ??= decode(DISPELS);
  return dispels.has(spellId);
}

/**
 * Whether this aura is an enrage, so that removing it was a soothe.
 *
 * Asked of the aura that came off, never of the dispel that took it.
 */
export function isEnrage(auraId: number): boolean {
  enrages ??= decode(ENRAGES);
  return enrages.has(auraId);
}

/** How many spells each table knows. Exported for the test, which asserts neither is empty. */
export function dispelCount(): number {
  dispels ??= decode(DISPELS);
  return dispels.size;
}

export function enrageCount(): number {
  enrages ??= decode(ENRAGES);
  return enrages.size;
}

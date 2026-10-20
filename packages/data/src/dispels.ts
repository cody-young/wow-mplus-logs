/**
 * Which spells are dispels, and which auras are enrages or bleeds.
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
 * BLEEDS is every aura whose dispel type is Bleed (11). Only a few buttons
 * take one off at all, Cauterizing Flame chief among them.
 *
 * 268 dispels, 717 enrages and 880 bleeds. Only ids are stored: no names, no
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

const BLEEDS =
  'jj.1x.8j.kn.3d.xg.1w2.1.2hg.148.1bj.25.z4.3h.2.85.9p.v.5x.f3.t.iw.ax.3b.8a.a.3.2v.hw.9r.fv.3.s.2' +
  'm.2.17l.1oi.10b.q0.3v.1.2hj.1.2a.zf.id.4.5.8z.t.9q.9u.b6.a9.f6.1r.oi.qs.1b.y8.4x.ji.8l.1f.5r.r.4' +
  's.4w.q.23.bp.4v.7n.10.2b.8j.bd.t.9.12.9q.h.4n.mp.ot.nc.cv.2.79.c3.7.4.3y.j1.6.38h.3n.p.gi.m6.t7.' +
  '3y.b8.va.aa.2u.cc.52.2v.ul.5.f1.1.q.1u9.m6.1m.8p.44.t.g.60.h.6.2.4.1.22.6.99.9.3p.1.1.4j.1t2.2f.' +
  't6.p6.84.a7.ad.go.h2.ic.1hf.23n.294.8r.6b.f2.g1.h.1y.5x.qf.u4.h.g9.ao.1.5j.n.rk.el.1.3d.tj.d.s9.' +
  'nv.lh.1j0.14o.9t.om.yq.18d.hu.2g.1a3.yc.lv.pp.mq.2ae.nv.30h.4oi.cg.164.l.ri.329.92.ay.3v.f8.1bn.' +
  '12b.l2.2z.bm.zh.vy.10.47.ih.b8.4c.k8.jm.l9.138.7.263.l6.2r.ko.1k1.l4.1.1.3c.2v9.46.1.14.f9.be.4a' +
  '.15y.d1.3tt.7e.vi.kc.g0.ho.l.192.me.5b.34.5y.fv.1g7.34.yy.c2.u.91.vz.oh.od.cl.1.jb.1qi.4o.h3.ft.' +
  'u3.g.ha.6g.be.8.ft.f7.b1.5e.cf.7y.b4.31.u1.2d.3s7.5.cx.1f.uq.21.46.11w.4f.4d.9c.4u.6d.19.2j.ph.j' +
  'm.iy.2cv.n7.bj.8b.rs.z.n4.iz.3g.1r.3d.14f.gz.zo.11k.2ao.m1.d1.1ql.ll.3.d7.1.au.ei.4b.1a3.1cv.fj.' +
  'j2.la.1s.v.15s.2t.l.11.4p.dv.hq.id.4s.9h.x6.f8.9d.b.k1.3.5.h0.ct.am.dd.sm.1.60.201.6.ni.3u.ia.2g' +
  '.rk.4w7.zc.1ev.2i.k.et.3c.71.4z.kc.ck.2v.ut.1ba.za.8i.33i.1l0.3o.l8.87.92.et.4h.de.6l.4i.6n.4l.y' +
  '.1f.4.1v.3q.28.86.bv.2w.1w.fz.28.eq.1i.dn.32.x.9.af.52.37.4.14.vp.6h.s.bi.3c.cz.rt.5.1o.9m.cv.1j' +
  '.2j.1v.8d.bj.2f.4c.14.7m.fz.n.p4.17l.e4.1j.5a.9.5.40.do.mr.23.b4.wb.5g.7g.9.50.kt.4t.ok.r1.5t.6g' +
  '.5s.1g.n.g7.qm.w1.z.h7.lf.kd.r3.6w.w.1.8.1o7.ay.1em.1m.39.7h.4.n6.d7.23s.y.1.f.2jr.nk.22x.26d.4z' +
  '.j4.3zw.ed.285.26g.7r.cw.b4.1fe.he.q4.og.3w.1h.116.7h.rh.gy.kn.o8.1.2.d.z1.164.u3.d.u.g0.1b.9j.1' +
  '5x.x7.1w.36.17.b4.6r.c3.20.j0.c4.16b.52.pj.4j.zb.q.7c.9c.g9.1l.t0.9y.u.ar.14w.1b.34.bz.48.ep.ff.' +
  'xy.108.8n.9h.3cm.b2.cl.bj.kx.95.sl.4v.58.ea.9b.8.80.4t.2q.11v.ay.5x.g5.1f.4.5e.47.g5.tj.s3.1.15t' +
  '.f1.5i.5k.gx.gl.14.5p.ir.6y.1e.jn.bo.pe.ka.kw.50.4m.44.26.q3.14q.5z.d9.uo.9n.as.80.2q.nb.227.18.' +
  '28n.cz.i.cj.3j.5g.7u.ek.wh.do.24.4i.ad.zm.at.6z.7c.g.q.4o.5.17.a9.e6.1.2o.9.1y.3.2.bt.r4.5o.15.1' +
  '.8k.75.12b.hm.y.15.ag.7k.2rd.21k.21.zt.r.2.2.6z.1gf.5d.2x8.9c.5d.1y.68.y.5y.35.64.1ez.3i.14.1a.1' +
  'bc.2.1cn.h3.2yq.61.ks.hm.9p.c.1v.ti.k9.8f.6.1v.ei.c7.e.2ts.5c.2j6.2f.2vv.c6.bz.1r.h0.2g.ix.am.k.' +
  'du.1ga.6g.vz.2z.7g.1eg.4.16y.lb.8d.22.60.rt.1x.180.5l.by.2i.6p.4b.be.37.37.2z.2h.l4.7k.29.5.7.6l' +
  '.2.3a.j.6g.13r.1r.159.1t.5b.2.39.1no.xl.n9.39.p8.d.68.2.zi.dv.v8.6c.5m.5s.6.c.1d.1f.ba.8l.pw.63.' +
  '1g.ez.fh.ig.16q.ez.fuas.md.19r.4n.z.df.31.7t.l9.4i.y9.1ff.2h.18i.z6.1z4.au.il.5mb.h8.12y.9b.7s.5' +
  'e.a3.8k.2.q3.62.ms.98.tx.hj.10h.1ay.co.169.o.14d.1t6.g.2q.ok.fv.n.a.fs.kg.180.8j.fp.2y7.x.1c4.1i' +
  '4.1fh.4o.132.1s5.im.cz.12i.bn.2.5er.1ly.wa.210.1nw.88.19w.nf.bm.2pp.3b.aw.8m.x4.no.3t.tm.45.gx.q' +
  'c.w9.mf.7z.e2.13.2ld.76.1cg.1rf.hu.tv';

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let dispels: Set<number> | null = null;
let enrages: Set<number> | null = null;
let bleeds: Set<number> | null = null;

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

/**
 * Whether this aura is a bleed.
 *
 * Asked of the aura that came off, like `isEnrage`.
 */
export function isBleed(auraId: number): boolean {
  bleeds ??= decode(BLEEDS);
  return bleeds.has(auraId);
}

/** How many spells each table knows. Exported for the test, which asserts none is empty. */
export function dispelCount(): number {
  dispels ??= decode(DISPELS);
  return dispels.size;
}

export function enrageCount(): number {
  enrages ??= decode(ENRAGES);
  return enrages.size;
}

export function bleedCount(): number {
  bleeds ??= decode(BLEEDS);
  return bleeds.size;
}

/**
 * Spells that do something about damage, derived from Blizzard's own data.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-effects.mjs`.
 * Built from SpellEffect.db2, retail build 12.1.0.69933, via wago.tools.
 *
 * The game has no flag that says "this is a defensive". What it has is the aura
 * each spell effect applies, and ten of those mean survival. Membership here is
 * therefore a fact about what a spell does, not an opinion about whether it
 * matters — which is the point, because the opinion is what goes stale.
 *
 *    69 SCHOOL_ABSORB                absorb     Power Word: Shield
 *    87 MOD_DAMAGE_PERCENT_TAKEN     reduction  Shield Wall, −40
 *    39 SCHOOL_IMMUNITY              immunity   Divine Shield
 *    40 DAMAGE_IMMUNITY              immunity   Netherwalk
 *    47 MOD_PARRY_PERCENT            avoidance  Demon Spikes, +8
 *    49 MOD_DODGE_PERCENT            avoidance  Evasion, +200
 *    34 MOD_INCREASE_HEALTH          health     Rallying Cry
 *   133 MOD_INCREASE_HEALTH_PERCENT  health     Last Stand, +30
 *   118 MOD_HEALING_PCT              healing    Vampiric Blood, +30
 *    81 SPLIT_DAMAGE_PCT             shared     Blessing of Sacrifice, 30
 *
 * Only spell ids are stored. No names, no descriptions, no art: the log already
 * carries the name of every aura it reports, and numbers are the only part of
 * this that is ours to keep.
 */

/** What a spell does about damage. A spell can do several. */
export const Defense = {
  ABSORB: 1,
  REDUCTION: 2,
  IMMUNITY: 4,
  AVOIDANCE: 8,
  HEALTH: 16,
  HEALING: 32,
  SHARED: 64,
} as const;

export type DefenseKind = (typeof Defense)[keyof typeof Defense];

/** 1702 spells. */
const ABSORB =
  'h.k3.dq.1l2.ld.k.27j.85.6.3.3.9.4p.o.a5.10.1i8.fs.6y.mg.j.5m.a.4y.3v.1u.eh.ip.1e7.3.12j.jo.35.83' +
  '.1.1.1.2.1.23.1k5.r3.25.9.yq.6f.6e.u9.dh.19u.2x.1.3.k0.tj.1.1.1.2.2.1v.19.10.2j.kc.1.1.e.9.1.1.7' +
  'k.gm.o.1z.3.4o.19.kh.ey.3.2.1.2.ld.5p.8e.8t.fc.2q.6l.94.2e.8m.1ca.30.bx.9a.gn.2.2r.5y.37.su.9m.s' +
  'f.1z.t7.1m.18.ib.3.gr.xu.61.38.1g2.s.17c.qi.p2.jv.5.31.n.1.2hc.6g.1.2.1.1.gl.e3.88.l.1jy.dp.145.' +
  '2q.6e.gq.1l4.1b.1p.43.gv.9t.23.gy.1e.1.58.7c.rz.2.4s.g.69.bk.1yy.jy.r9.25.cm.6x.12.5e.1h.65.1.2t' +
  '.fr.q9.10j.wt.3z.wc.1s.uv.q0.l3.ba.2v.1dc.5.22.s5.3g.5h.eo.rh.ce.mn.n9.1dq.5v.o3.4b.h7.c.8x.13q.' +
  'dy.2f1.6z.17.3x.g.2x.k8.5.5s.396.cj.fj.3z.wf.ts.30.23.1h8.30.9y.1e.28s.kg.1gr.11.62.iv.f.4h.2e.3' +
  'w.114.62.nv.1a0.34.152.10s.5c.9e.11.1b.84.r.bk.126.83.ki.2k.m6.db.mb.98.8r.p5.pp.1d.fk.33.wr.10g' +
  '.13j.6b.fk.i0.ol.sr.75.1i.12x.41.a2.yt.k2.1ot.e.6.2s.4.5o.1q.91.119.1m2.je.1ba.3o.at.2s.1q.t2.6.' +
  'z0.98.qx.pa.91.17w.co.41.rv.92.1xc.9e.61.p8.ef.c.5g.ay.h5.6x.my.9t.to.f2.9z.nk.o8.d.l.4h.18t.xq.' +
  'de.2u.9d.du.7.l.cb.93.2k.7q.5r.5x.125.3o.ok.12m.6c.19i.5.5a.2n.f7.e6.28.31.2s.38.bm.5s.4s.30.d2.' +
  'bw.9s.33.cq.e.58.13m.62.2v.hs.7c.g.16f.59.n2.8e.br.6o.13.11z.r.9.gu.40.7d.n0.9b.5o.7z.2m.fh.jj.b' +
  'r.r8.x.11.9n.42.47.1w.a2.1l.g.2m.bv.4f.9h.8b.34.83.4i.m.4y.1.gu.7v.a8.51.1r.v8.1n.3l.a.8.1c.4m.4' +
  '.28.10.49.ih.7z.9n.bt.5c.12.gp.73.e.17.x.u1.di.gu.ed.jk.3y.cq.a.1b.4a.24.8u.56.2j.1g.7.9s.32.wg.' +
  '1.11b.ed.5e.8i.9o.4j.6x.1g.iy.2n.b0.9.ay.5c.8a.2.69.24.1q6.1j.79.3.2g.g.g7.9t.4h.12y.1d.1.1.1.1.' +
  '3h.e2.20.ci.50.3n.ms.36.v.28.41.k.18u.1t.2.2.5e.2.34.3x.1.1.l8.b7.2a.fm.jx.3x.3s.6.2.3t.51.1se.8' +
  '.11h.1.1q.j6.f.py.22.12t.1i.24.9.3.2.7p.5x.1l4.2e.d.hv.s.86.d.oi.59.6i.6v.5x.16.tw.1.1.1.3g.hw.1' +
  '7.1dk.63.6.6a.k.a.9d.52.9l.5p.cs.1c.7q.7r.bv.bz.1y.16.b6.lq.4u.li.1g.ht.e.2.1.27.iu.a9.97.cn.6k.' +
  '18i.7y.7.1i.4h.ar.bk.1p.77.z.26.5k.gy.e6.9n.97.g.7w.19.5u.tb.58.2i.r8.i.bj.1h.4.38.b.1i.2m.20.g8' +
  '.8c.3n.7d.q.7b.9i.e.2m.2o.ah.vk.8.bi.v.7f.e7.27.1l.e.9.q.1s.9v.mr.6g.10.1z.fs.6b.2c.10c.df.f5.r6' +
  '.5.16.g0.22.5g.q8.1.dy.6k.9.k.1.4p.5k.m8.9c.2t.2m.1k.2e.31.2a.26.cp.rv.2b.1r.1y.5x.3l.ik.4a.2h.4' +
  'n.h.t.4i.d0.jc.7l.48.16.3h.4s.11i.ge.2o.5f.96.1tc.2z.b.2l.b.m.4g.1d.f.6z.8.2g.3l.7.p.23.g.fg.df.' +
  '3q.p.7m.ov.a5.gq.cm.1.2t.4.d.e.1.9.bj.33.3o.3.3c.5a.j5.5j.1.ah.1o.s.f8.11.2y.3.9m.fb.u.44.2q.e1.' +
  '4c.2p.9p.fd.l0.9x.2h.6v.do.j1.x9.1fl.22.9k.4b.2d.lu.1n.ec.j.9f.c1.62.e1.ip.nv.69.1.4.hx.5q.5o.2n' +
  '.4.48.t4.2c.9t.a6.2l.5b.a4.41.b.21.3i.3z.35.2s.24.8m.a.3t.4i.2m.9q.k.3d.2n.u.6o.6k.3s.h.8b.ao.c6' +
  '.2c.4p.2j.5d.33.ae.dx.h3.5m.4.4b.f.58.59.2.18s.90.e.df.cb.88.9f.8h.20.i.8w.db.4q.11.8r.4k.d9.9.7' +
  'm.nx.3.1.1o.1a.26.1p.b6.er.2f.i5.37.6z.4b.3.5s.4r.1a.4m.5.3c.3i.30.kq.q.5c.hu.2e.h.e0.3e.jo.if.c' +
  'l.4c.1f.6t.g2.d.ai.1.1t.90.4c.7t.4d.fp.2j.4.hz.a3.5a.83.2g.9l.22.i.4f.kh.1.2.6.n.2g.bi.3z.100.fa' +
  '.u.m2.9.fg.1d.58.2p.96.4n.2e.1.2k.1c.1s.bw.1j.i.13.a6.1h.7z.l.f.9a.2m.1.2o.eb.bn.5j.8z.1b.1.8l.4' +
  '6.6.17.12.25.6q.54.4r.8c.b.2q.89.5p.2c.5c.39.rf.8o.82.26.2.w1.kq.d2.4u.ad.2z.1.z.t.n8.at.5m.5l.5' +
  '.1h.7k.1.1.5j.92.k.1s.8q.8k.6j.56.1u.1.3.2o.4m.iw.20.5u.5c.e.o.2g.9h.4m.2b.1a.1v.8c.20.2j.9d.97.' +
  'qh.7r.x.2t.1s.43.67.1e.b.d.6f.27.4g.cx.4a.39.3u.17.1v.108.9.e6.e.2l.2l.lt.6q.18.9c.6s.ag.2o.v.1.' +
  'p2.vk.124.v.cz.1i.v.43.6o.v.1p.4p.yv.3t.48.2o.18.1l.78.5e.5q.gj.60.3d.15.17.f.2h.7.23.3g.gs.5z.4' +
  'g.11.5q.37.2s.z.7t.31.4c.2n.1o.4k.5.i.1.1.1x.g2.70.h4.2.1l.3v.w.4g.5e.1g.j.1v.29.10.7.1k.48.26.6' +
  'e.8.s.4f.l.1c.3c.i.2a.w.6r.lx.gi.12.4k.9v.9u.6z.36.5.2f.1g.7q.67.1f.1y.27.87.1a.6d.54.6.2v.4c.1x' +
  '.4k.1.1.t.1.1.26.4.kn.1.1.21.56.70.103.3r.2b.j.h.86.dj.79.15.1.1e.40.h9.px.8k.14.g.1d.3r.k6.h5.5' +
  'a.56.10.9d.3e.3v.5u.29.58.14.9n.6p.aw.6.53.h3.5h.5g.in.6j.43.e1.1d.h.2y.3.85.1w.3o.au.3t.a5.4r.1' +
  'j.4j.1f.1.57.p4.ep.5z.1l.1l.a.7c.1.71.1.1.48.1o.1qw.47.1u.3h.jj.22.9t.5.an.2a.74.4u.o.4.7.61.3b.' +
  'cn.2i.gs.bq.4a.8r.gx.bg.12.1k.5b.14.8a.m.3l.2w.2a.5o.x.14.10.9m.35.kc.y.3m.ay.8g.18.23.o.5b.25.g' +
  'a.2.hl.6x.9e.ko.10.3.157.nn.ak.cn.28.2f.4l.9.7o.4c.cb.36.5v.2b.4a.7n.rh.ud.1k7.l.z.gq.or.ru.gg.d' +
  'j.1.1.1.1.2.eb.13.5v.36.17.69.41.qs.5n.1c.5t.x.u.6x.14o.4h.6v.21.6k.4c.ah.4h.2l.76.9m.q2.i.5w.f4' +
  '.4t.11.68.7l.l.3.m.6.c.3m.3d.1.4l.2v.2f.3m.2r.1d.9k.6n.76.31.tf.23.d8.2t.8s.8j.49.4k.3s.55.1x.eo' +
  '.e.29.r.f4.1y.bj.2m.5r.20.in.5.4.18m.ca.em.27.5r.2a.s.9u.7q.3r.52.36.5.g8.9y.9b.2w.m4.w7.ae.3t.m' +
  'e.1p1.lt.1b.1na.ot.6g.2g.87.a.1o.fu6k.kj.4x.a9.6f.cd.jh.76.2h.ey.1p.kq.92.ut.2.308.cl.44.b.2.3q.' +
  'rg.cz.3z.1j.t0.ap.4r.30.1m.hv.1o.12o.op.3i.8z.1c.4i.bs.je.an.b0.a.h.ck.az.la.99.7.98.b6.3z.b9.gn' +
  '.70.1m.33.m.2.2g.5d.8p.26.4q.8b.br.38.8h.4z.ax.2q.96.k3.4c.3y.10.6s.bi.45.3t.t.b.4m.2m.11l.c3.zi' +
  '.1q.88.sx.1e.5.2n.3o.ct.6q.fo.9x.s.95.fo.6.re.4w.3l.z.bx.6e.c.e.83.8r.127.2o.i.gn.5s.6.3a.3.fj.4' +
  'n.2b.2d.4n.1x.136.3d.5n.1f.ru.ga.ng.5v.3e.a0.37.s.cv.yd.h5.3k.a2.2o.bl.8f.9j.f6.cc.25.77.9.3k.73' +
  '.1y.15.58.74.4d.18x.yi.mj.f2.3.30.bj.dy.8l.gb.2ui.6z.42.9y.rr.bp.1s3.7n.b2.2a8.9.d9.3k.3t.rs.4n.' +
  'cm.bq.273.4.4e.io.3t.ax.ba.gm.ix.d2.9.en.7r.34.1b.x.6d.by.er.db.8m.3u.4t.1w.3x.ay.47.t.dv.9s.j.a' +
  'j.9y.1.hl.4v.pm.qb.j8.l1.196.h0.7q.da.g.3u.87.4.k.4j.ow.n8.2.ns.1jv';

/** 4117 spells. */
const REDUCTION =
  '1z.6.y.9u.x.2g.6k.1.1c.2v.1c.4c.8o.d8.zl.5.c.2k.14.v.9.3.3r.11q.9l.3s.22.8z.tj.1d.i.50.j.1.6b.du' +
  '.5j.21.2e.m.d.o.w.gj.r.hq.2b.1.m2.5j.2.c4.9d.mr.3.v.7d.1.b.52.5o.nh.2l.x.5r.b1.1.e.1.6.ej.e6.em.' +
  'u.h.2e.3y.i.1.11.2t.6.az.64.27.2.1d.bk.b7.1n.eg.g8.3q.6i.4.26.1.lb.1p.9.s.4.9.4.1n.1.3y.75.q.2p.' +
  'ao.30.gv.1.1.1.1.c0.2r.2x.2p.2y.y.k.4f.2.1q.30.2s.4k.gx.ae.2y.5c.3g.3.1.2.1.2.dh.34.7w.9v.v8.3.c' +
  'd.9x.bl.1.2.1.1.83.1s.9.74.ir.f.1.w.1j.2e.49.e.2.y.l.ak.22.5.7z.1k.7j.4t.7.3b.1f.24.9.1w.4z.ci.1' +
  '2.3v.54.a.48.af.al.4f.5u.2.1.1.1.1.1.9z.3.9.7.26.i.18.u.k.6p.12.1a.2m.3.3.1g.8q.61.2y.6e.q.m.g.2' +
  'd.27.4.1.u.1r.1i.1s.4.2j.16.2b.4h.9x.2.2x.1l.15.24.1r.4h.1p.c.h.8.1f.1.1.1.1.1.1.36.1.8.1.1.1.1.' +
  '1.1.1.8.1.43.9.93.1.2.p.2y.c.4c.27.1m.ua.34.b.1a.7.4k.1.33.4z.4t.1l.1.11.1i.y.1.4z.16.1.p.54.2.2' +
  '.2.1h.7.9.e.1w.3.e.3.4.e.2.l.3.a.20.6p.5g.34.5y.fv.1i.21.2v.r.2t.2s.1u.55.2a.u.35.2r.l.52.h3.w.1' +
  'o.gu.i.13.1d.4l.4o.6.4.2n.1.29.uv.ih.d.cc.2d.ad.bv.19.5o.k.2n.3b.3m.2.20.e.t.a.v.7.3o.4e.1.50.28' +
  '.1q.b.i.93.4t.a4.5o.6l.47.1.12.3j.11.r.2k.27.m.3.2.24.2e.7k.p.g.31.2.29.21.1.c.39.c1.2z.4h.g.3f.' +
  '4m.fx.a1.7q.ac.2a.7.gz.1.6.19.dk.7d.22.4q.p.ae.4j.42.m.7i.18.s.18.3j.g.1e.1a.6.5h.4r.f.j.5y.gk.5' +
  'f.o.2.s.4h.b.19.2w.2g.45.1s.a3.3z.23.7.3v.19.h.12.2r.1i.n.2q.1x.e.7l.3o.24.46.1k.22.3a.1p.4w.1b.' +
  '2a.3e.6d.1r.18.1a.1v.3b.b.1x.9.4i.f.31.r.1a.2w.1o.7c.1m.99.q.9.1h.1a.6.6i.11.3s.7o.i.4y.lb.2f.f.' +
  '1s.8a.gj.6.2z.2b.4f.c8.1n.1u.5u.61.1d.60.6p.97.7i.1.ak.5r.5w.26.2q.c.3b.16.zv.i.8m.bc.89.3b.1.1.' +
  '1.1.1.1.1.1.1.1.4z.6.f2.19.1k.s.2s.1e.4.8h.10.19.1.1y.w.s.v.1.k.2p.2c.7d.2q.7d.12.5q.y.x.28.u.20' +
  '.3g.3x.5.3w.h.o3.13.87.8.4i.4s.3g.t.n.2.1x.m.1.5o.3.1l.43.1.1.1.1.f1.1h.2b.21.2u.3.5k.9v.dz.6h.5' +
  '.7a.1j.i.n.1h.24.da.9.8i.4o.58.g.1j.7.1x.3v.1g.1.2j.2.f.13.6c.19.fo.9w.i.4s.1.49.19.31.8z.27.3l.' +
  'a4.k.o.25.73.24.65.4.7q.bt.97.9x.1j.kp.6o.1a.b8.3z.9x.4u.9s.m.1.7w.lw.4k.6.73.4y.5.z.4n.1x.1.k.p' +
  '.3g.123.ax.1.gs.3d.19.4f.78.1b.5u.46.7s.2t.v.i.b.1.1.1.1.6.6k.w.7m.4z.2w.10.7s.9g.5.3r.14.3t.18.' +
  '2o.3l.2.4.1j.8.6.28.7u.1p.6f.2.2c.2h.1o.1.14.1p.de.60.5t.u.8t.54.13.4p.1d.4p.28.44.2b.2v.a3.6o.3' +
  '6.e.13.2.25.km.4j.aa.8.2.3i.n.9g.1i.1j.d.3r.47.3z.1n.1f.2p.p.c.d.b.o.3s.9a.s.5p.2g.3r.9k.53.4q.e' +
  'q.39.g.92.hj.1.36.1.8s.9i.57.qd.2r.4b.o1.67.v.4x.2d.1v.6r.38.2p.1z.33.26.95.y.4.3u.5.7p.4p.1.1o.' +
  'ar.g.2y.1g.1v.13.2d.l.z.j.x.ns.c1.7s.2d.1n.1x.7.27.z.13.a.2m.l.4u.1a.3m.cf.s.2q.8d.8.2k.4u.16.20' +
  '.9r.3y.e6.2i.2e.1.5t.b.1.1.1t.5n.y.7.2m.8p.6p.64.56.5w.v.1p.3l.2e.1q.y.fh.3r.1v.2.e.z.cu.af.fn.2' +
  'h.3c.1.1.89.3l.x.1z.k.1x.3i.j.1y.1e.3.1t.1v.21.20.1.2c.h.27.7.1l.8a.1x.3j.5.g.3b.17.2.1y.42.27.2' +
  'o.8.14.1.v.4k.2z.8e.2t.5i.i.a.1e.4x.2m.ee.5q.av.6i.2b.16.8.4u.1d.5.15.2b.i.dd.bi.8c.1.8c.7.6x.2q' +
  '.6e.2s.10.3.5m.4.18.1j.6.1k.6r.5p.83.m.1x.n.l.6w.2e.61.i.2u.55.o.1u.4g.a.2f.c.6.f2.65.s.4u.5b.5f' +
  '.4o.w.49.1l.x.7y.32.9j.1c.2l.1v.2a.2c.12.i.4i.1.31.1o.1a.2c.s.13.3j.76.22.gi.32.22.17.p.1p.3.2.3' +
  '.32.b.5s.1y.1k.j.8.c.j.1b.c.e.u.84.cc.2c.28.v.2g.11.1q.7n.48.22.6c.4p.5q.1.4s.9h.1t.12.2n.26.6.1' +
  'r.f.8.4b.1x.1.22.7i.d.80.1m.6a.2t.3g.c5.x.2k.27.16.2n.4d.dm.2.7l.3k.68.6n.46.4s.ec.7.4.a.49.15.5' +
  'u.1.3k.f.2t.64.15.6j.1p.4i.p.be.7x.2o.3e.u.ax.2b.9o.1d.g2.46.y.1.6.70.7h.8a.v.67.ay.45.54.1g.21.' +
  '3f.42.o7.fv.3.1a.2r.40.30.h.o.5.23.4r.c.1w.z.c1.2o.20.5z.1i.6.25.4v.2g.19.be.2w.1u.cz.1l.4t.b.22' +
  '.a.5.8v.q.1.1.i.9h.9z.2h.6r.z.2y.4r.bi.a1.2x.da.1q.gy.29.17.l.1w.3.1d.1.1c.2.1.2z.1d.2g.r.1i.49.' +
  'l.1y.5i.77.1b.2y.bi.v.n.3z.77.1n.9j.39.2s.5u.f.b7.5l.10.1.1.28.2b.1l.z.14.1p.3.s.67.8e.1w.5f.6u.' +
  '85.30.3w.fm.12.9t.9.8l.a.1x.1.7.11.1.1m.4z.86.69.47.6o.h8.4.2a.5v.l.2.22.g.4a.5z.2b.6f.q.1e.4g.h' +
  '.78.d.3t.o.7.1m.40.1i.1.20.14.1x.2l.19.13.4y.6h.24.2c.d.3h.v.2g.1y.1q.2.4.16.p.1.2j.8c.h.w.o.8.h' +
  '.i.3.a6.n.2h.1l.cd.53.4k.3.80.54.t.6y.9e.a8.dd.1b.4g.5z.9s.fe.1f.1h.h.z.6f.10.5k.5.d.b.1u.g.5a.1' +
  '.1.12.1k.q.6.5e.1t.t.1n.e.26.x.r.41.1q.w.3k.4q.4l.24.5s.6.u.8p.o.c.3b.2.58.1x.3.2p.2v.41.3q.o9.6' +
  '.7v.5z.21.bf.6a.s.2.r.2p.37.t.72.ep.c.2f.2y.18.5g.3b.1o.4d.5s.5t.ca.45.cn.10.2f.2h.aj.2.4u.3o.dq' +
  '.7.1o.3s.3e.58.2o.4z.1k.8p.eb.1.bg.96.a.1f.87.61.1o.43.1g.3u.2q.21.9.16.p.dr.4.p.a.3c.32.1t.p.7j' +
  '.78.8j.3l.1w.34.7.8w.o.y.h.e.30.50.e.7d.x.dd.2k.3a.d.6u.41.8b.1b.r.a.1s.6.95.6m.5z.1h.1.1.1.1.1.' +
  '32.59.22.3x.1s.3m.13.30.15.j.88.2u.2i.1v.4.2l.6c.1u.1j.3.6s.5q.j.24.2t.3.81.h.40.3k.28.39.1b.35.' +
  'b.1m.3s.8.2v.v.5t.57.bp.3g.6.bc.dn.6y.5.4w.cn.22.2.1f.1o.u.r.1o.4w.3h.v.6.s.x.2u.3q.4.fn.78.8b.r' +
  '.2i.5q.z.1t.9v.e.d.6w.m.99.28.1m.f.7h.x.ev.74.v.2y.2.1e.25.14.1.2g.4f.3l.1n.2n.18.37.5p.87.9n.6.' +
  'an.51.w.2q.l.o.3l.5.3i.r.4j.2d.31.1.67.1i.6z.1.g.33.4.59.y.c8.c.17.63.1.15.m.2h.7e.6u.49.du.1d.8' +
  '.2p.s.6d.65.1.s.7.16.y.z.2w.4.et.1q.11.3m.d0.cr.97.37.32.13.z.k.2i.13.18.20.k.2.1.1.p.ab.10.7c.l' +
  'n.70.30.5a.3.38.5n.5q.dq.35.c.3y.5a.g.6j.4.2e.3h.6c.gi.28.2b.6f.2w.25.2e.72.1.1.1.1.1a.4c.n.4i.t' +
  '.4.42.1n.88.8i.8.16.k.6w.5q.1y.1y.14.1x.2.1l.2l.1.h.1.1.r.o.m.1e.b8.20.fw.lm.1f.4.bq.2h.1b.15.4.' +
  'dc.8y.6k.f.1i.7d.8i.q.53.5h.8e.1q.1.4p.1.8t.3t.4k.35.4d.2r.2f.7.28.1x.a.3p.g.2.z.s.h.1a.8r.ky.bj' +
  '.6w.2.4j.1k.5.5.en.4v.62.4o.20.v.30.x.3i.8e.27.1j.2i.6.1n.bd.7k.9j.46.3t.2t.1x.v.j.9d.mh.55.1c.3' +
  'x.6n.3k.i.2l.1.1a.7u.11.5l.l.5c.1m.2.g.2v.l.6.l.16.o.2w.3t.3x.x.1q.3n.1h.49.7.16.76.m.16.33.29.c' +
  '.v.4g.3g.70.32.p.45.25.ac.4n.3d.3l.j.3.4q.1v.gc.cn.4w.4.44.7k.2h.v.p.7n.9g.7.2p.3z.5c.6j.19.1d.6' +
  'd.2b.3d.c.1p.c.1p.65.b.5x.e.1p.4n.3.41.7.3b.8e.n.7.az.6s.9.n.4b.1k.1i.1.1.1.74.8s.ac.1.3.3.4.1.3' +
  '.1.u.i.4p.d.4.1m.1z.6.2y.4g.8u.1v.d.q.cq.6.5v.f.36.v.3m.2i.j.u.5k.u.43.2o.24.7.9.h.g.3e.1y.1u.5k' +
  '.3d.r.6i.3m.1f.5a.3m.k.c2.1v.f.39.1c.f6.1b.1f.16.8m.v.1.1.60.a.3d.m.1a.16.c.y.1n.1u.1u.bm.36.1l.' +
  '2.q.n.7x.6y.3t.3.3o.2p.3v.1.1s.24.1n.m.2.1.1.1f.6.c.2c.5.a9.74.6.8.7.3.3.q.1.t.24.52.k.36.16.1j.' +
  'd.3n.25.n.7t.3o.9x.t.i8.1l.5.13.1.1.2.al.bd.2e.26.31.2n.q.i.27.6.ay.1v.4b.13.jg.51.1b.3e.17.8r.2' +
  '.x.4.c.f.2g.1q.1e.5f.17.2r.5b.1f.32.75.5j.2n.29.4b.3v.q.s.i.12.12.ai.15.64.1l.1x.27.4a.1.7m.15.2' +
  'g.b0.2.n.1z.5u.6t.26.3y.2b.n.1b.b.1a.ar.o.6d.6.1r.60.1.j8.1.1.1.29.a.2.13.4.2n.2.z.2i.1h.r.5.1l.' +
  '1d.9.1.t.4.a.6.2c.m.1l.5h.5a.w.at.3m.1v.3k.k.d.6c.1r.62.j.3k.a.1.hz.1.a.b.ay.d.1i.2.4.5b.3.5c.1.' +
  '79.hi.4.2.1.6v.10.7.7r.2r.2x.2f.2m.f.7r.q.4r.12.4h.d.2.1.1.1.1.2g.hl.14.53.39.1m.10.5.gj.16.2i.1' +
  '2.8e.3r.6w.54.l.ay.ah.1q.3v.1z.1t.7n.90.2e.1c.8.1o.z.3.2.1.1.x.4z.t.30.5j.k.4g.2c.4v.3d.7n.2q.77' +
  '.2j.g.5.4d.1.2y.g.18.13.1l.9.gs.3l.3y.4b.c7.3v.2.6.1s.26.3g.1.4p.21.6p.1u.19.dg.5q.f.bd.3o.z.1.5' +
  '.1.1.z.4u.9.2p.bf.6.8.1f.14.2v.7z.4x.5u.b.24.25.7o.x.1w.2i.j.4.1.5.a.3m.5i.2q.o.3m.u.3b.7k.9c.4d' +
  '.24.3u.5y.24.2e.37.h.3.he.6y.1.1.1p.1.e.3.2.2.a.7.10.4t.21.1.1.1x.6j.3z.3d.9d.2p.gv.ev.2.1r.28.1' +
  '.4e.s.6x.20.1t.1.1.1k.c.8e.1d.1e.1e.27.b.3u.4s.ae.1k.1.1r.4n.4b.1.2j.2.8.2.1.2a.v.1.1l.6v.2g.1y.' +
  '1.11.as.lj.i6.7h.1o.1a.7w.5i.ec.17.10.3a.2t.1.52.gp.1f.48.7e.8.2u.21.2o.hz.l.17.5g.2.1w.21.7t.6n' +
  '.16.51.5g.5l.r.1z.42.g.95.o.1f.3l.21.d9.3c.1n.5b.3l.3s.3f.df.3m.1.2.64.1f.42.3c.4d.6s.32.4n.2n.2' +
  'h.3i.m.a.2i.40.p.6d.6.ho.m5.1x.8z.2i.v.2j.4d.5k.1n.yv.1h.18.u.1c.1u.x.a.c.1e.2e.i.21.8p.2i.2m.9i' +
  '.3g.62.35.28.t.1q.2i.79.2p.64.e.c.3h.7.14.1s.2v.4a.i.2j.3.4e.5.32.4t.1v.1m.1x.27.e.2b.5v.2j.24.u' +
  '.u.64.ap.64.37.3.1g.2p.11.u.f.18.y.6r.e5.8.1y.7e.2j.i.2y.4w.t.f.1m.13.b9.3.14.42.1.2m.2e.1z.6l.e' +
  '.1b.10.2i.4.1.15.26.40.bq.1c.q.43.b.15.1p.1y.2v.5i.v.2s.p.1.46.1a.3z.31.1u.a4.d.1v.6s.v.3f.3e.13' +
  '.m.e.3r.35.8.39.bu.g.5c.1z.1g.11.1l.92.37.17.3c.9.3u.1m.3d.1b.6.3g.1l.1m.1l.2.7b.1x.1x.2.2c.e.1z' +
  '.4k.3c.t.5c.1.3.1a.1l.4b.3.2h.57.39.8a.2v.12.24.y.5.p.b.1o.3e.1u.s.19.1.1a.5.e.7l.y.5.3k.2m.2o.5' +
  'g.2o.4.9.5.2.k.7q.1d.22.e.ar.1x.2q.3.o.s.1o.26.1t.2v.2q.1n.y.3r.5.3s.f.74.2a.58.11.5l.4k.w.1w.1b' +
  '.74.69.1z.2d.3t.f.m.1e.p.4h.1u.g.1f.4.12.4a.8.3i.5d.4b.3h.3r.9k.ep.q.5r.3s.4e.2v.9o.if.4s.6x.t.h' +
  'z.3.z.23.55.1.h.3.2.97.2h.1x.h.4t.1a.2g.52.3g.22.ra.18.5q.e.q.6.3q.1p.5s.n.28.3i.5w.6k.f.3x.3s.5' +
  'a.4l.3d.2a.3.d3.h.63.7.h.22.s.1v.1b.s.5.1t.64.7f.t.6a.77.49.28.61.4k.n.k.1l.1v.h.b7.6.1.26.d.1e.' +
  '1.3.4.b6.1.3l.4r.14.1z.c.5.5.6.3.2x.12.r.2.j.3y.7d.1q.a.3d.1.25.4m.1x.13.17.5.y.z.3.y.p.4i.4d.25' +
  '.17.6o.3e.27.47.f4.1.4j.87.59.36.6.4.1b.r.1i.2a.1n.5p.c.a8.m.2w.f.44.b.1.6e.6t.22.9b.22.2g.1x.5k' +
  '.6.1l.7y.g.1t.48.52.1y.3.1y.3s.2r.1a.9q.17.1z.d.1.47.c.d.p.50.8.52.44.s.1c.42.3.6q.a3.4q.o.36.d.' +
  '1z.4k.ae.4e.1.6k.14.63.26.j.88.1j.3.1.38.16.1m.3f.3l.1j.3.76.2w.n.b5.7e.3.p.1.s.42.3s.4i.2i.td.2' +
  '.7.2j.29.5c.5w.21.43.1z.4r.27.t.3j.6.1s.19.4w.3o.7.1h.bz.1b.1v.c.ad.3c.7u.w.l.6p.2y.h.d.1.i8.31.' +
  '17.j5.2w.b5.1h.50.3b.9q.6p.1k.2m.q.dq.q.y.299.3s.14.f.28.p.14.6.ul.5g.22.1x.dj.5c.1f.2d.2p.4w.69' +
  '.81.18.4b.v.6.1s.1r.b.z.14.4z.6r.d0.m.1g.w.t.4g.d4.3z.5n.c.8d.1l.t.r.3y.l.m.5a.j.11.c.30.6n.20.k' +
  '.l.3c.4a.1.6.34.64.1a.1.1i.d.7g.23.2a.cn.2g.h.18.1.7g.23.n.a.dq.36.55.3l.4.2b.nh.2j.21.t.7x.p.69' +
  '.31.17.16.2a.89.68.6j.6i.7k.c.h.bj.3l.4h.7e.j.h.21.12.g.x.1c.e.1d.21.n.1j.1.1.r.6.r.d.1m.5a.h.m.' +
  '39.1q.2e.2i.z.2x.31.1f.1.1.1.1.2.2e.1t.ai.92.1.1.74.32.1m.1j.t.24.qb.an.e.14.4w.39.l.cs.6.2e.7k.' +
  'v.5.k.8.1k.2x.bp.33.mt.6e.6j.ca.1k.2m.y.1k.67.9g.6o.2a.1h.i.a.d7.19.2s.42.6k.ii.3m.97.10.u.c4.3x' +
  '.2b.s.1.2.72.7z.3k.59.5h.bu.l.6m.4l.l.d.7m.7m.9.2.11.5.7l.n.ao.39.7w.1s.5v.3q.2h.2z.1l.9t.7w.1s.' +
  '5q.j.e.7v.3a.1.4a.4p.4i.b8.1.k.18.6e.v.4.1.88.2w.y.h.8.3q.6r.ld.cg.r.1r.o.15.nm.e.15.t.11.35.3u.' +
  '1g.v.1g.9.j.o.1t.d0.9w.5p.70.2h.3n.u.1g.1v.2r.k.ae.6x.1z.5p.7e.24.dh.b9.2e.1p.22.3v.an.m.8p.3s.8' +
  '.70.14.1q.i.ai.o.s.1h.86.6.o.9.5e.2.2.2.12.8f.4n.1l.f.1m.h1.2u.1r.3.2.3.1.1.1.3b.9g.7.3y.1h.bk.1' +
  '.1.1g.1p.6.5a.77.z.69.1g.w.2f.s.e.9k.16.20.3f.3p.4i.3t.4a.21.ev.51.cx.8z.k6.6v.8.4.1d.1.52.2m.5y' +
  '.3q.1x.f4.by.1z.37.8h.4o.hb.34.17.7e.8z.dg.86.44.50.dd.vd.1.37.2.1t.20.9v.a9.15.fr.2.32.1.12.15.' +
  'l.em.4.1m.4j.de.2p.bg.14.1.9k.2m.2w.8p.8q.3w.18.1f.4p.6a.9f.9u.i.1m.2b.3j.g1.2x.6t.7o.94.je.o6.3' +
  'l.x.r.u.6n.7.94.9.1i.7k.1m.1d.1f.as.2j.hk.2l.w.4t.4g.1i.18.2m.p.30.9.3v.1.2l.t.24.52.5q.7x.4c.3y' +
  '.7c.2y.1z.1d.la.1g.4r.8v.1.1.3f.6i.3t.t.3w.5a.3q.4k.8l.1u.6j.39.1.1.7.a.7.1v.45.5w.13.10.r.j.31.' +
  'fi.5.12.bf.t.e.8.3b.2u.5.h.1p.1b.7s.7n.2r.dm.2.25.2i.cn.e.1e.bn.1.r.ef.bi.ca.1f.dd.1m.7f.8t.2.2a' +
  '.n1.1b.65.e.n.1k.4v.at.17.7p.1g.1m.o.7r.q.9.2h.1y.5a.bl.96.5a.a.1r.3n.1j.62.ab.8u.2a.26.5p.1.d.s' +
  '.3p.55.kg.y.58.1s.o.13.16.41.10.65.3.3h.1r.7u.b.s.5k.1t.5s.4.12.4p.9.97.42.v.8i.4n.c.1.19.2s.2q.' +
  '7b.4f.g5.46.3u.44.91.ftwo.5.1g.10.7.1.1.8b.42.6j.56.8.ah.1d.p.10.59.2l.19.7k.1m.5p.62.hl.2b.bj.a' +
  '0.28.v.4o.2c.i.3i.1z.26.t.4.1o.d.u.2.2w.30.3u.g.3c.nv.e.4t.9.h.9.j.om.4d.4n.4n.2.18.6.1.2.7x.n3.' +
  '1l.ib.7a.c.au.2.j4.4e.8c.mr.iz.8.2d.q.33.23.2h.4v.34.1g.3l.11.38.5l.17.6t.1.8f.5f.j.4q.19j.21.2.' +
  '20.l6.5t.2q.5h.5f.p.x.34.6n.bz.f.3w.2e.a4.7h.3c.29.7m.c.a4.17.8l.bv.f.a.18.11.3b.ck.2e.l.kp.42.o' +
  '9.e.7t.3v.7.65.6v.10.op.4b.2i.86.25.ly.1c.v.6y.1.2y.2g.4j.18.10.p.5z.1.3.2t.1u.27.3u.k4.1s.1q.p3' +
  '.aq.dy.o.b3.25.3f.u.2.1a.1y.do.x.a.1b.1.1.1.1.1.1.1.1.1.1.1.1.1.2g.m.14.48.4w.32.ad.kc.1z.4m.ew.' +
  's5.8l.h2.3p.29.2y.a0.1x.3w.1w.j.2t.6m.3k.ex.56.p.cn.45.2.70.n.1p.9.3v.3z.i6.7.2t.3.c9.56.89.n.35' +
  '.65.n.1g.2h.u.1.k.9e.jk.4z.3a.2.1h.8e.4e.77.a.ik.21.f1.cw.b.bj.45.48.h1.s.a2.98.5.6r.2n.jq.30.9m' +
  '.2t.25.5d.1f.3o.r.1u.58.s.9r.9c.2u.b.1v.e5.f.1g.2.2.k.1g.24.11.a1.1u.c4.1bu.2g.35.y8.l.7i.1y.63.' +
  '3.5a.1h.3u.2f.1.u.q.3m.76.91.5l.3s.bj.46.48.2.97.5z.ca.13.15y.51.6m.oc.b5.8n.16.so.bp.fm.54.az.g' +
  's.cb.3l.p.2x.qg.7x.j.cl.1e.9z.gn.1a.1y.3b.i.2l.2b.46.cf.2z.2v.6k.5s.t4.4.dy.20.i.3y.e5.zs.1.27.d' +
  'p.4.ac.23.4j.2h.4c.32.8m.6u.ci.q.4f.1gl.9.2f.e3.q.3t.3.ap.a5.6e.3.12.p.1e.bh.q.3d.4.7y.j5.l0.18.' +
  'es.b.1b.7.2y.ah.k.62.b9.jo.h4.ev.nb.6k.7n.w.h6.5.x4.1g2.w.14.13l.1n.1z.2t.7q.a6.f6.1.8d.1.1.1lq.' +
  'mm.1q1';

/** 1415 spells. */
const IMMUNITY =
  'hu.1w.8o.2jb.hb.1c.z0.38.a8.b1.n.6n.a0.5h.1.1.bn.6y.ai.5.cc.1w4.qh.1b.39.6c.hr.1cy.mn.4q.fg.21.b' +
  '5.39t.lf.kw.gu.5m.tf.bk.nq.s5.1i.128.8q.21.nl.jp.w.mx.gv.bw.qi.b0.2.i.1.1.1.2r.1.1.1.1.1.1.1.5r.' +
  'x.bq.cj.8h.m6.37.t.41.1.17.1f.85.1.1.8x.j.7z.20.2w.h.21.1.1.1.1.1.1.1.6.9k.20.7b.3h.jm.19.7.3m.7' +
  '.1p.3b.83.13.10.42.40.o.1q.b1.6l.9.1.4.1x.1.3v.ac.aw.3h.25.126.n7.1z.gq.b4.ch.3l.58.vs.4u.b7.aa.' +
  '14q.99.ik.pd.2z.3.cj.9m.1y.uy.4c.34.80.13r.1aq.c2.cs.11.9x.jd.z4.m9.cj.z.9h.5.a3.1w.95.6h.54.7t.' +
  '96.7i.q9.2a.1l.46.1.yh.rt.h0.ng.cq.m.6.cj.1x.g8.4l.2f.1s.cj.1.p9.t.14e.dc.4h.3g.2x.5b.4k.h0.7l.9' +
  'b.52.j1.5.qf.gx.1r.1ei.99.fi.x.50.6c.15s.f5.1.1.2g5.6m.n2.eh.1tu.16x.z.1k5.183.2p.b5.fk.cy.6i.n1' +
  '.97.fx.7o.p5.kn.g5.92.1jz.2d.1w.c6.1.1k.mo.fk.28t.9.kr.1gr.cx.e6.hi.10k.o.1v.l.1lw.io.80.zc.11n.' +
  'eq.m8.ac.6u.48.lo.69.c6.9.yb.24.3t.tf.16s.q1.5m.y0.2m.vx.9g.2r.1l.6y.1.37.7t.2.21.33.9s.d.5q.uu.' +
  '5b.4i.1.1.9o.4g.m2.4y.3h.wq.5t.w.18.s.40.6.o.h5.1o.ee.16h.5l.6z.1i.1d.3w.1ne.5t.aj.dl.10f.39.r2.' +
  '11.dm.1an.2lc.m6.h.8h.3f.1l4.v1.40.ez.v4.8q.a.5.g1.8e.dg.17n.2s.2r.9e.9b.1u.14u.le.or.15.1dj.7e.' +
  'y.db.mx.en.85.xa.2r.15.nz.1v.1pg.rv.en.2.33.4l.59.ho.3s.i.j2.a.x.fs.1m.e0.1z.cf.34.5l.5w.2.yt.2j' +
  '.n.2y.1b.2q.ci.p.gt.7m.15j.2m.1se.gd.52.a.i.2.7.5.d.1.3.a.ju.ai.b3.15j.172.41.1p.h8.fg.4e.6p.76.' +
  '4p.3o.o3.3.v.92.2l.8q.12j.nz.4t.1.au.c6.c.eo.d6.mp.1t.ix.65.8f.af.bp.73.jx.5q.7z.2k.a3.h.ye.3.s.' +
  '23.4c.2e.ak.48.dr.bt.1s.92.16.h.6x.2d.dp.b4.1ko.h2.va.2e.1jo.39.a8.ct.9m.f6.8u.4.1g.w.8.124.1.17' +
  '.q.5l.cf.s0.7.d.g.c.1k.1.qt.5s.8f.6c.5c.d.9o.b.2b.2.6.2.4z.1z.8i.ko.9l.i.8.29.hb.3j.8.gi.1w.3q.6' +
  'i.76.3i.7y.b8.xm.i9.3h.5.5.3.7c.40.2.1l.8c.8l.2u.50.40.7l.se.61.97.dm.3.eu.2.j3.1nt.x.5h.7q.39.b' +
  'j.hy.dl.om.ci.8.dz.1l.5r.9.z.1.13n.1w.fv.3f.ol.m1.8s.bn.a3.tf.56.df.am.bb.87.hm.5.1.1.g7.2.5y.hh' +
  '.41.1a.1o.26.6.9f.2h.io.65.af.1f.21.oc.gr.ec.qn.my.1c3.5.1.1.4j.98.zg.5e.f9.3a.3h.c.lk.mb.1tn.g4' +
  '.2b.bq.47.1by.jb.xz.br.4f.fd.u9.4b.1vg.ck.kw.1tl.al.94.d8.31.6a.7f.ef.ei.6b.3a.4i.d.3y.3i.1.f3.3' +
  '.9a.is.1l.2p.ah.89.6g.5p.10m.g5.3c.s.6r.1t.7c.1sb.4v.jm.17p.4l.i3.dn.9w.hr.3b.c7.14.1.ed.x.1k.3.' +
  '2.2.2.2.db.3.5h.36.3p.bo.9y.3j.3g.3i.ab.xj.1k4.3b.88.1l.1.6.2.8s.ni.bs.1i.2f.l5.e.es.9l.1u.vp.ca' +
  '.12.72.2.1.1.1.5y.iu.6f.75.hg.4m.7x.90.6q.x.6g.2c.f.1o.9q.2e.nn.u.4b.9.3q.55.v.cx.6.1.nx.8j.p.1.' +
  '9.p.f.gc.j.2f.p.1.46.bf.c2.4z.jj.t.1.7c.24.34.15.m.cz.17.z.gx.ce.5.6i.rj.2v.7.x.25.1i.ao.9k.4i.d' +
  '6.2.37.4.1g.vd.f0.g.g.20.a0.2c.al.dg.dt.n.25.7.m.1.7w.u8.gm.2g.92.9b.19.r3.2a.1.el.2l.6o.3s.1.1.' +
  '1.1.1.1.1.1.1.1.1.1.1.1.1.1.9x.u.1u.jg.2.4n.8o.12.1m.4l.5r.4.2f.33.37.ka.3m.1g.br.7.cp.5w.w.eh.4' +
  'v.8f.e.7.1o.34.hs.z.7.4d.n.3l.8.4v.3t.12.s5.7b.os.37.s.2j.70.9.f.8z.l.1.1s.e.6t.dy.5u.2.5r.ji.ov' +
  '.4f.5j.8f.q.22.8g.cw.96.7h.76.1y.d.4l.xm.kv.77.47.4.1o.1x.ih.s4.4o.ao.cd.jg.d1.f7.33.43.5y.fp.mz' +
  '.5g.14.9b.6z.73.1.4z.1c.4m.81.fr.26.1r.1.9f.ej.cb.d9.hh.y.6.s.1.1.1.1.1x.20.34.3r.8t.2h.x.23.bz.' +
  '5k.1q.4.3q.1k.mc.8j.b.1c.1v.3q.5m.4.2l.l.1c.hj.1v.1v.o.84.h.2.1bv.7.9h.1u.3i.b1.im.14.14.19m.63.' +
  'i6.f.16.de.51.ug.12g.m.3w.32.j.p.c7.e.6.5.3.9.a.6.8.11.2.2.2.2.3.2.2.2.5i.q4.ad.ca.1uz.3i.ry.10b' +
  '.e.6b.1.1.1.87.x8.36.s.7.bn.3x.s2.14y.2hh.nb.s3.h.6.f6.n.2r.35.4b.ig.2j.6e.nx.2v.7q.1.1.ou.3t.1g' +
  't.y.3b.15.5w.j.6w.2.3a.2oo.1p.35.7d.5q.1x.sj.4l.1.1.1.x5.4z.a7.i7.4h.e9.1b.zu.1m.3b.50.1p.10m.oo' +
  '.cl.36.2f.wz.cc.2b.1b.b4.17f.do.9h.x9.j.fe.o.t.31.88.v.rx.dt.87.1m.8c.59.x3.ha.df.oh.1.2t.1.fq.i' +
  's.ow.2t.4v.f.ao.a7.28.f.3.12.3.n.a9.ox.6e.3s.5y.3y.ze.js.1.8f.a3.6b.f6.6.4.2.nn.1lf.1c.ee.xe.n.n' +
  'm.1o.n.95.p0.5m.x.3.4.b.4h.cb.5x.f.1go.jw.1z2.2g.sb.x.4q.63.pp.1.y8.fc.v0.28.3n.ma.9x.40.dw.ib.a' +
  'l.km.8e.aa.31.q0.k8.86.b.2.1e5.j7.d.6.7.7.8z.cq.7a.c2.11.17.jo.vb.27.6j.ep.sn.x2.1b.a7.gk.d.1w8.' +
  '6q.34.k0.fv31.r.m7.1ap.3l.vw.dk.aa.9r.1.p.32.4k.13g.1o9.4.1.1.6y.10b.10n.2g.2e.j6.237.11h.i5.hw.' +
  'fu.f.3w.5c.xn.j6.dh.d5.u2.9r.1jk.52.l.n.ib.11t.31.9.aj.ym.6e.4.hf.1te.ac.3.6m.3.1.gz.1mn.8f.5j.7' +
  '0.a1.f4.b.k8.2p.10z.5t.9a.gv.zq.ge.4y.1zm.81.145.1q6.d.1t.t.7l.u.138.vb.m9.8.203.f4.4d.e.k.1.1.3' +
  'r.4p.8x.54f.2x7.eq.16.b.9.1sc.tc.2.mh.x6.93.as.uj.2.1h.bi.c8.qk.56.6h.gu.4r.2.ct.9m.3a.45.3.9o.1' +
  '.1.4.2.2.8a.1gl.8t.m2.gg.1mg.m6.2ae.379.gt.g9.qw.6b.m.fs.2c3.3l9';

/** 278 spells. */
const AVOIDANCE =
  '2hy.nk.wi.l.45.fo.7m.1jt.59a.yk.39.36u.le.em.1ad.433.5n.13n.fa.9x.58.1xt.yl.ld.ug.dp.l7.2n.8vt.1' +
  '6z.9l.px.15v.7j.3ho.13w.1c9.2.1rr.xw.2ig.73.me.fw.1a6.2eb.1hk.1o.10d.55.f8.86.85.uu.1s7.ff.di.u2' +
  '.1a8.169.1lv.2k.17g.32s.1ux.27.49.xf.jw.1f2.1ci.tf.hu.b1.2kq.80.d9.1mv.ge.1t1.jt.eb.ml.1tx.76.1b' +
  '9.tn.2yb.4p.6k.f6.jk.z3.3sa.1ur.14.1c1.3h0.b.2vd.456.48n.ok.le.x.7qy.e5.bk.1.1m3.5j.ye.el.2j4.ls' +
  '.1pk.1ur.gy.v0.1.1.1.5dm.1o8.hh.aq.15w.2v.3.1dj.r3.1dw.n1.5b.rt.1d.1df.xv.d9.1nh.ic.1.1.1.1.e3.1' +
  'nl.f1.2o.1l.of.kv.2hn.1tv.6i.1j2.2n6.7hj.8u.1ak.y5.1.15a.cam.e9.ee.ov.cx.6d.8b.wa.pj.10f.o1.5.c.' +
  'c.cc.y1.1sn.e.3.ce.6m0.5.l.1gw.4v.80.ke.1.5tb.226.1i2.8.4z.e.1m3.gk.7dd.us.3q0.t9.664.l1.q2.1c9.' +
  '16b.zb.1v4.hi.1i.13.1e.9u.1h.e7.pl.29v.bc.1f8.16u.b3.1z3.eg.1an.i0.ih.4gn.5wg.27y.bh.1xi.63d.1sf' +
  '.7d.8w.cc.1x5.4dm.1q8.4yk.199.d9.xo.1hv.o.es.an6.1qe.o6.590.v4.51n.kr.4qe.c56.s.a6.4y7.8e.3z1.87' +
  's.g5h5.agt.5g0.1ff.mm.27w.7lo.7l.j3.129.hby.4x5.1vc.13.8cp';

/** 1171 spells. */
const HEALTH =
  'ma.17s.xr.13o.8s.1v.19g.aj.94.2v.3yd.ig.67.24b.hn.am.3x.9o.1c.tt.3n.5y.bd.24p.1p.56.8.r.3.e.1.77' +
  '.2.8j.22.2h.tw.1e6.af.gz.8h.fb.c.5s.o.gm.i2.br.159.vv.h3.km.2t.bp.1u.dy.9z.gf.2g7.nb.22.1u.6v.51' +
  '.fz.1pu.xs.ja.27.1.1.2.2.1.1.1.3b.c7.2.1ft.15x.2zp.31.7.b8.nl.66.151.19v.58.88.bq.5i.4w.7i.ef.27' +
  '.cn.6w.13.3.5q.6c.lb.2x.5.3t.6o.4y.tt.81.g.2c.2g.b9.1.1.o.4l.8u.1f.1.2t.pt.1.1.uk.1ko.1.uz.sm.7f' +
  '.3y.12v.1i.2.1.1.1.1.2.1.1.1.1.6z.bs.1x.ld.6a.16.3f.4c.7f.1m.b8.qf.xk.175.1.1c3.lm.22o.9n.1gf.2j' +
  '.1gw.83.1o.p2.aw.h4.4.h.uw.2kw.qx.ex.ys.2ig.1e.nz.b0.1d7.bl.n.2fw.1j.jc.5fj.16t.un.10w.5p.qt.6u.' +
  '42.68.cx.e4.10c.1dv.p.7.fq.bf.1ab.1vg.dp.sy.1.g.5.89.d2.fd.jq.m.36.ps.sz.j2.t.kj.3.2ck.4w.39.1.s' +
  'a.5v.6e.c0.8j.18.4q.l.l.50.5n.8j.f.1g.c.11n.1lv.cy.3.165.dt.xw.x.d.c7.tp.2u.2q.pz.8x.6m.y7.n2.vz' +
  '.9.6l.m.6v.8j.cd.145.29.t9.1.1v.k4.56.71.184.1xv.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.2.1.1.1.1.1.1.1.1' +
  '.1.1.1.1.1.1.1q.tk.3q.10w.17t.pp.7.8.3s.lq.3b.e5.pe.6r.1f.bn.5u.qk.fs.w.4c.5e.14z.2a.ff.ik.1.1.a' +
  'w.yy.25.8l.13.1k.8.5.1.1.1.72.9c.3.p5.te.15s.ju.6f.eh.6q.sr.39.1do.pl.jj.u2.2t.c.ne.2.xj.x.6v.p4' +
  '.b1.ca.9t.6h.io.94.a4.ll.d6.n.j9.pk.uq.nb.yq.9.2h.6k.j.2p.8r.tf.dl.6.3.3t.yj.g3.6v.49.59.f9.8q.8' +
  'h.94.fu.1.1.8r.et.em.4z.1z.t3.2c.1di.ns.f2.132.g.1bp.9q.3s.5.ad.ev.o3.8w.91.13.l.uu.r1.1cn.1g.p.' +
  '1co.5i.2u.1kx.r.ab.ax.g.92.dp.4g.77.52.1la.lf.14.ee.3w.p.1.aj.rt.b7.l4.6z.cu.ky.of.8g.6c.15d.1.2' +
  '.2.2.1.gg.1h.1.14.3j.10m.1my.mv.g0.1j.hh.9u.1q.bk.bx.e1.s.lk.ev.zn.76.s.1do.85.1iq.pu.3s.1o.7m.h' +
  '0.78.l.1.1s.1.2.3z.bj.u6.mm.1o.dn.2.lv.r0.1f.17w.y2.19f.1j4.ib.l7.7r.a.go.6.9p.47.198.5z.3k.j4.5' +
  's.ie.4t.2i.2s.10.1k.12.48.a5.2w.1h.f6.hu.ku.dn.3q.2k.vm.jv.ep.fh.43.rh.2t.4w.75.54.4s.128.q.5e.2' +
  '3.g.4d.6o.l.1.1.1.vg.2s.8i.e2.4l.pr.10.5e.33.67.1m.g3.1.1.1.1.1.1.1.1.1.1.2.1.1.2.1.1.1.1.1.2.1.' +
  '1.1.1.2s.1.1.1.1.1.1.2.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.4.1.1.1.1.1.1.1.1.2.1.1.5.1.1.1' +
  '.1.1.1.1.1.1.1.1.1.1.1.1.1.1s.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.2.1.1.1.1.' +
  '1.1.1.1.1.1.1.1.1.1.1.1.1.2.1.1.1.1.1.1.2.1.1.1.9.1.1.3.1.1.1.1.1.1.1.1.1.1.1.1.1.1.2.1.1.1.1.1.' +
  '1.1.1.1.1.o5.1o4.97.b5.4k.hi.c.94.3e.41.15.iw.77.2y.89.5.9x.ed.bf.ew.1.5g.98.b.a.1o.3q.bg.3.4d.2' +
  'k.23.p.1i.fs.cn.us.76.d.5e.bo.35.71.4h.fc.9v.2r.7.x.2.1.1.8i.hq.fz.ji.1h.1kc.i0.ix.b2.r6.dm.om.m' +
  'r.af.eq.n.1p.gv.4.d.7r.7.25w.19i.31.2m.6i.j8.4e.fs.dm.9z.67.ef.a.17r.47.7j.93.ea.b7.2d.1fg.2.7y.' +
  '7.3s.5o.5g.b8.9i.af.27.d5.13d.g.j.l.4d.3s.cz.61.jc.p.3h.gv.g.ne.1k.1.2o.6p.u9.24.pq.1w.ae.fm.hh.' +
  '49.jb.18f.92.hd.5a.1.3.1f.4s.4.4k.68.f9.7k.kt.al.1h.y5.3i.o.9r.ea.6n.74.12.54.1y.i.a.b.23t.cj.1.' +
  '1.en.4l.ve.5q.3.1.4.7j.hw.a.z7.3.ir.1k.aj.3j.149.30.1bg.je.1mm.3yx.45.c5.37q.1s.1w.1a1.wq.ah.l2.' +
  'mw.gw.bf.jn.ip.ej.4c.j9.5.z.1sh.9.5i.pu.h.7j.ui.1x.iu.ul.1.1.sk.22o.1j.83.77.a6.4u.zl.v.bz.1ac.1' +
  'e.ua.1u.1he.mx.oz.v.m2.ka.yi.ul.sk.j8.1e3.1.rf.zs.l1.4w.9a.38b.1dg.f.1yq.u1.uq.yy.26.1iy.y.c.2ag' +
  '.1eh.48.1kp.185.26u.4.5c.1s6.40.ye.9s.168.27z.qq.9x.14.b.k2.gj.gc.ce.4.5.x.5.5.v.6.6.1hu.8.a.23.' +
  '63.b9.py.3d.1rd.km.a0.4e1.76.j4.b9.wq.1n.r.fty5.10b.b7.1.1.2h.g9.oc.3p.sj.7m.ea.2j.1.1.2h3.1fc.7' +
  '.1mr.72.93.a.17.1k8.ox.1ed.22.4fz.t1.2z.i.kz.12l.57.2.b3.bd.e.27.2g.5p.1.7g.jq.1e3.1db.19a.4o.3p' +
  '.3.197.1ad.1tt.26q.3s.pd.ly.10.l.e.20c.7r.ec.lu.5z.1l.7.20b.em.ji.2pd.t7.1.16u.c9.2g.3df.at.18a.' +
  'nm.8v.cd.1.366.4i.he.oq.h.1hb.d.1.2.1.1.yu.1eu.226.24y.np.5.1.ro.5m8.1lv.21v';

/** 649 spells. */
const HEALING =
  'du.5w.46q.p5.r.18s.3s7.4a.1ir.vw.au.8d.7l.1en.21.2aj.3h.u.h.8m.1j.11h.2t.r0.1hq.n2.u.r.8l.m4.ht.' +
  '5u.62.5m.3x.dc.aq.1p.1u.9e.1r.9y.y.s8.7z.85.77.bx.3r.n6.im.3d.2v.1l.a1.t8.55.5i.mx.1y.ff.aj.j9.1' +
  'm.3k.1ho.v.k.mf.70.e.cb.aa.aj.4f.33.8c.2o.1.4s.xz.9p.4a.bk.10.3k.1n0.17a.2k.3i.jr.8x.7j.1b.75.43' +
  '.2i.2t.ed.a0.1p0.av.i2.bh.m.z.4b.1m.c.65.9e.f2.bk.151.47.a8.1e6.bq.a9.1.6v.17.10.jk.1.1.oa.117.k' +
  'w.i.n.pe.2b.13.bl.4i.7b.il.4p.1.2.2.1.1.1jx.1.4h.rr.h6.o.52.98.1mq.dq.gn.co.1dg.k0.sa.i.4.cp.5u.' +
  '1.1.r5.yg.e3.ep.4e.2dt.ji.re.87.gh.7t.e9.1k8.159.5.cs.tj.sc.lk.12.4d.15t.1hs.i2.b0.1tz.2ob.6d.1l' +
  '2.u6.by.4z.153.gb.27.7r.va.u2.k8.b.1.1.kd.4o.lb.x.b.l3.7.16r.4f.ne.jm.aj.iv.oq.37.go.k3.23e.la.q' +
  'w.m4.vn.oh.cj.s0.1m.3a.5m.4i.cb.1k.1ns.a0.2cz.24j.b.26o.177.265.vg.1xi.rh.sp.19.ia.1xs.9.d.13g.o' +
  '3.7c.2gn.6t.2t.qo.e8.ab.5s.4.2.41.4s.8b.2v.5b.7.8.oq.3h.6v.ml.8d.3q.5.u3.kg.4n.l0.x6.8p.21d.h3.3' +
  'x.2s.1z.8r.av.b3.v.d9.f.16q.1qg.12o.16p.k1.bq.1lx.j0.2.yg.uf.9m.2d.42.b9.63.4r.9d.b9.1j.uv.a.cm.' +
  'ne.7q.17a.kv.4l.dv.14q.172.es.vb.69.7b.cy.97.jl.j8.1me.kr.g6.1kx.11x.1p.fq.as.4p.tv.95.eq.aj.r0.' +
  'zs.1u.128.uy.2tr.1p9.b1.14k.us.2da.x8.2fj.17.3e.42.5y.i1.1w.ak.173.bn.1u.dt.2o9.6i.hy.jr.n0.5i.k' +
  'w.1bj.3p.bj.zj.1hb.hc.a8.1uj.9w.au.1ve.1se.iv.15z.u3.2y.ab.bb.bl.1in.5t.295.gg.1g7.5i.io.6k.u7.p' +
  'j.ua.s.p2.234.1cn.1zw.1m7.t.2yk.1w.1fk.fm.cw.93.mf.36.1l5.i8.m2.11m.17.h3.i2.194.m2.1br.i3.sa.1a' +
  'x.kv.60.fp.e0.2th.1nz.kz.37.kh.82.h3.b5.10d.2g.1lh.k5.3.gn.cw.sn.81.qn.5x.su.201.rp.vp.e0.fz.239' +
  '.k.1an.ii.15u.tf.10r.jq.6.rq.61.pq.h.od.bs.i.a.b.ez.ow.m.m.tz.9a.i7.mp.181.4.rz.11l.2l.iy.1y.8y.' +
  '16s.f5.1lu.1f3.j7.51.2c.2mx.o2.hx.8s.p.28t.uy.hz.c8.iz.bm.nk.fg.y8.ao.lw.a.k5.44.1db.5z.kp.1h0.l' +
  'q.71.g0.94.1n.17v.1pq.if.df.79.1ev.e8.i2.d2.jj.23u.1hl.3v.2t.2g.54.ab.23i.e3.3q.3j7.1v3.z.3t2.b5' +
  '.24s.1bd.7c.o2.h8.16a.4b.o.1lh.2ao.wy.eb.f.6vy.203.1n3.10.57.h5.f7.20.36.ij.c0.6v.oh.5.5.iy.1l5.' +
  '43.1t4.f.ev.q1.cs.d0.o2.85.f9.1nk.1r5.p.7j.k9.fvm6.1cm.10v.6bj.17t.20h.4bk.x3.u1.tt.86.r6.12y.3o' +
  '.l8.bz.52r.3g.1bw.3gd.ac.26s.10.3y.1aj.de.s6.169.5ko.gw.8jr.uo.5oi.1g1.1g8.k.e0.1oa.tm.1pm.2te.1' +
  'ck';

/** 22 spells. */
const SHARED =
  '5cs.2b2.32d.g45.11l.3xu.38.efv.11bk.5sv.57d.2i7.1mmm.97g.7jv.50h.12yy.oh.z3r.2it5.mv1.ghxk';

const LISTS: readonly (readonly [string, number])[] = [
  [ABSORB, 1],
  [REDUCTION, 2],
  [IMMUNITY, 4],
  [AVOIDANCE, 8],
  [HEALTH, 16],
  [HEALING, 32],
  [SHARED, 64],
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
 * What this spell does about damage, as a mask of `Defense` values, or 0.
 *
 * 0 is the answer for most spell ids, including every one the table has never
 * heard of — a spell added after this file was generated reads as not a
 * defensive, which is the safe way round for a chart that is meant to be short.
 */
export function defenseKinds(spellId: number): number {
  table ??= decode();
  return table.get(spellId) ?? 0;
}

/** Whether the spell does anything at all about damage. */
export function isDefensive(spellId: number): boolean {
  return defenseKinds(spellId) !== 0;
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function defensiveCount(): number {
  table ??= decode();
  return table.size;
}

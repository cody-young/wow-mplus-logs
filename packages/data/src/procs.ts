/**
 * How often each proc is meant to happen, from Blizzard's own data.
 *
 * GENERATED — do not edit. Rebuild with `node scripts/spell-effects.mjs`.
 * Built from SpellEffect.db2, SpellAuraOptions.db2, SpellProcsPerMinute.db2
 * and SpellProcsPerMinuteMod.db2, retail build 12.1.0.69933, via wago.tools.
 *
 * A proc is two spells: the passive a player carries — a trinket, an enchant,
 * an embellishment — and the spell it fires, which is what the log shows. The
 * passive's real-procs-per-minute rate is in the data, and its
 * PROC_TRIGGER_SPELL aura names the spell it fires. This table is that join,
 * keyed on the spell the log will show.
 *
 * A spell that some other passive also fires at no rate is left out: what it
 * was meant to do cannot be said. Only class and spec multipliers are applied. The rest scale with haste,
 * crit, race or item level, which the log does not reliably give; leaving
 * them out moves everyone's expected count the same way, so a comparison
 * between players still reads true. Procs on a flat chance per hit are not
 * here at all: they have no rate to expect.
 *
 * 1248 spells at 97 rates. Only ids and numbers are stored: no names, no
 * descriptions, no art.
 */

/**
 * Base procs per minute, class and spec adjustments ("c<classMask>:x", "s<specId>:x"),
 * spells. An adjustment is added to 1 and multiplied in, the way the game reads
 * it: a tank spec's -0.75 is a quarter of the rate.
 */
const RATES: readonly (readonly [number, string, string])[] = [
  [0.25, '', 'crp.3k2.3dx9.1ujs.l9u'],
  [0.5, '', '2pl8.2z3d.b.3r.6ir.o11.1ot5.17nh.gnpm'],
  [0.51, '', 'r3sc.g.2g'],
  [0.58, 'c256:-0.4,s102:-0.35', '2z83'],
  [0.581, 's104:-0.75,s105:-0.2,s250:-0.75,s256:0.4,s257:0,s264:-0.3,s268:-0.75,s270:-0.2,s65:0.1,s66:-0.75,s73:-0.75', '34t4'],
  [0.65, '', '5amm'],
  [0.7, '', '3kr8.115o.4t.c2.51j.19ye.k38e'],
  [0.7, 'c2607:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '4u7i.2fmo'],
  [0.72, '', '2zdu'],
  [0.75, '', '729w'],
  [0.85, '', '1y4y.x5.10aq.18gr.4cb.9ca.aj5.5b0.ufl.1w0x.jmw'],
  [0.92, '', 'pyp.2etz.2t.w.1zu.3.2.d1u.2.6.2.1.8ji.9.2.3.b.7.2.2.2.2.v.4.2.2.2.1f.3.2.2.4.5.2.3.4.3.4.e.5.a.6' +
  '.9yz.1.1.imm.b9z.2fm.2'],
  [0.92, 'c2603:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s255:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '4xo3'],
  [0.96, '', '2z54'],
  [1, '', 'adc.2ef.1f.gi.8f.1.ji.9.g9.btb.k5b.6xr.1.1ox.e75.u3.74.65.k3.85o.idc.96g.4jl.1l6.pbd.m.218.1nn.2' +
  '.f.9s.6ff.1j4.rp.3am.d.29w.u.d.7.d.9.4.5.3ef.3iu.1q6.1av.2c6.40v.2f.2.2.3.b.51.21h.30.le.g4.19j.' +
  '3sm.6.9.75k.7cb.i.1ys.20s.4nv.11.2t.1l.4x.1hk.9o.jv.2.11.2b.2s.3q.qp.4q.lv.b1.w.2.cb.c.jw.1b6.78' +
  '.6.3r.5i.1r5.xl.1j.37.4a.di.117.5p.3.1.k.b1.s.np.3o.4cc.122.9p.2ix.n.9d.2nu.4md.e3.mj.8r.1c.1rv.' +
  '8z.7.2.3.6m9.m.a.18v.h.5.98.4vl.1by.3hz.3ik.5.e2.1jo.5sg.14j.2.5xp.18i.235.lz.34w.1f3.rg.9sc.2qw' +
  '.1y.6d.qt.5p.i2.8b.1c.c1.7.h4.1.1.2.8k.aa.74.1vz.e4.1bw.2q.tt.bd.dm.2j6.5js.4.3hr.tr.3na.wb.2v.6' +
  'wj.9.6p.m0.108.k.fzg.5x7.35.c80.1af.fz6b.an.1d.au.506.1qu.3d7.hdg.9g.bwx.jnx.5kg.3t4'],
  [1, 'c400:-0.5,s102:-0.5,s104:-0.5,s105:-0.5,s250:-0.5,s253:-0.5,s254:-0.5,s262:-0.5,s264:-0.5,s268:-0.5,s270:-0.5,s581:-0.5,s65:-0.5,s66:-0.5,s73:-0.5', '56wb'],
  [1, 'c435:-0.5,c8:-0.3,s102:-0.5,s103:-0.3,s104:-0.5,s105:-0.5,s253:1,s254:1,s255:1.5,s262:-0.5,s263:0,s264:-0.5,s268:-0.5,s269:0,s270:-0.5,s577:0,s581:-0.5', '4u6g'],
  [1, 'c512:-0.1,c8:0.1', '3u7g'],
  [1, 's252:-0.32', '4lxu.5wg'],
  [1.01, '', '7vjj.1rtq.gvw4'],
  [1.1, '', '2z6a.14.1c7c.ww6.6sq.lald.19tp'],
  [1.15, '', '2yqu'],
  [1.2, '', 'tl6.15j8.3t4d.3uhx'],
  [1.2, 'c2477:-0.5,s102:-0.5,s103:-0.5,s104:-0.5,s258:-0.5,s262:-0.5,s263:-0.5,s268:-0.5,s269:-0.5,s66:-0.5,s70:-0.5', '5i5z.1'],
  [1.2, 'c2603:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s255:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '5a8w'],
  [1.21, '', '2z2c.3.r.65wy.tft'],
  [1.25, '', '1dxl.26tr.osz.hjh.17ip.68.eh.w.col.hcs.enx.2xoq.gxig'],
  [1.25, 'c32:-0.32', '4kyg'],
  [1.35, 's102:0.872,s258:-0.067,s262:0.891,s265:-0.375,s266:-0.402,s267:-0.491,s62:-0.239,s63:-0.295,s64:0.387', '2y5y'],
  [1.4, '', '5i5u'],
  [1.4, 'c2607:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '5i64'],
  [1.4, 'c4060:-0.5,s250:-0.5,s65:-0.5,s66:-0.5,s73:-0.5', '5i62'],
  [1.4, 'c476:-0.5,s102:-0.5,s103:-0.5,s105:-0.5,s251:-0.5,s252:-0.5,s269:-0.5,s270:-0.5,s577:-0.5,s65:-0.5,s70:-0.5,s71:-0.5,s72:-0.5', '5i5s.bl'],
  [1.5, '', 'c17.dpr.qf.8a4.brl.3mm.k5z.27uo.ak.4xq.ktw.4xd.1cw.5qy.4ow.2ht.4b8.7fb.8.8.v.10m.10a.25t.6c.1h4.' +
  't5.to.3v.c6.2b.f1.xo.43.1v.1ck.272.21f.5c.3cn.248.5y8.16t.1h.32t.2.45i.6g3.5y1.gm.1.y.1j0.18i.pj' +
  '.r3.10d.1jh.3j0.uw.ma.87z.1g7.fco.698.ggm.wb.t.bfb.21m.224.o4l.7a9.fyki.67.2xp.bf.6eo.6si.mq.2.2' +
  '.1h.14.2uk.4qi.g.je.1.1.1.185.ab.4fw.4k.854.mpk'],
  [1.5, 'c476:-0.5,s102:-0.5,s103:-0.5,s105:-0.5,s251:-0.5,s252:-0.5,s269:-0.5,s270:-0.5,s577:-0.5,s65:-0.5,s70:-0.5,s71:-0.5,s72:-0.5', '56w1'],
  [1.5, 's252:-0.32', '4r6p'],
  [1.5, 's258:-0.167,s62:-0.4', '3y15'],
  [1.55, '', '3lfi.2346.4.3y43'],
  [1.58, '', '72aa'],
  [1.64, '', '30bg.5c2n'],
  [1.66, '', '750s.226q.umk'],
  [1.7, '', '3u7t.422d'],
  [1.7, 'c2603:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s255:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '5hf5'],
  [1.74, 's103:0.3,s104:-0.4,s250:-0.4,s251:0.5,s252:0.05,s253:0,s254:0.2,s255:0.15,s259:0.55,s260:0.15,s261:0,s263:0.55,s268:-0.4,s269:0.2,s66:-0.4,s70:0.45,s71:0.35,s72:0.05,s73:-0.4', '34sy'],
  [1.75, '', '5yq8.xgr'],
  [1.8, 'c435:-0.5,s102:-0.5,s104:-0.5,s105:-0.5,s262:-0.5,s264:-0.5,s268:-0.5,s270:-0.5,s581:-0.5', '5i5w.1'],
  [1.8, 's71:-0.4', '4ucb'],
  [2, '', '95z.no.gb.5s.gh.10n.4k.mc.3.4.1.j.2n.mw.3n.1.l.1.5.fu.2.1.4.1.2.l.2h.2.21.18e.js.1qw.d.58d.3ij.j' +
  'rz.3sd.2.o.p.5x.b.5.38c.1.1lw1.1.y5y.9dc.po.wc.2t.1o.188.8f0.4so.c.4.2.4.5.4.2.2.7.2.3.2.9v.1kx.' +
  '16z.1.4vd.2dl.6yj.1b1.1vt.1.2.2.89i.2.p.p.7.6.7.b.7.3.3.5.5.l.1.1.1.1.1.1.4ns.d.1ym.ci.co.1.6.25' +
  '.2.5.a.1k3.4s.1jq.sc.2s.3u.48.1dz.1tg.dd.d.2.6.et.zr.3.vc.3in.5e.1cs.5gw.b8.398.23k.1fg.2d.t.77.' +
  '3iu.4mv.1av.qf.6au.v2.7b.52y.2s.1nj.8.d.2ms.1uw.2d1.50i.2w.2a1.1d5.nw.24.71r.nm.3e8.2f7.2eo.9i.1' +
  'yk.lo.1gc.72.cl.1xd.d9.3h7.2h.2mu.bl.rh.3.2.42h.a0.ie.1fy.1bn.6.gl.ac.ur.ov.2px.141.1.ae.388.3gj' +
  '.4p.w.61.3s9.2gm.l.3.le.2ld.5jx.1sx.kb.i4.123.6d.9.8.7.3x.b.3w.1t1.6p.169.113.fz.2bx.4.3.12p.1se' +
  '.5zp.s.is.2.2.6.2.2.1.5.16d.3k.10t.ku.fxry.3ss.3bi.339.85f.9j.2iu.w.2.zn.34.16k.1z.uu.21z.v7.nf.' +
  'te.6y.2ei.15a.3.cb.ze.8a.ib.90.2s9.2tl.b2r.7cz.138.gx8'],
  [2, 'c2603:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s255:-0.5,s256:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '4xnl'],
  [2, 'c2603:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s255:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '4u6q.d0c.su'],
  [2, 'c35:-0.5', '4le6'],
  [2, 'c4060:-0.5,s250:-0.5,s65:-0.5,s66:-0.5,s73:-0.5', '4u5w'],
  [2, 's263:-0.24', '4r5g.aj'],
  [2.2, '', '64vm.1aj.1sw3.3kq.4p.1.1.uaq'],
  [2.25, '', '64ag.1fng.132z.1eo.ionq.3'],
  [2.5, '', '3eva.stg.a56.qj8.guc.2a.1xk.2h.as.1o.3nb.3ip.cl.1fts.448.4k2.zmh.1et.eua.ld8.6i.29z.gemp.30.2p.f' +
  '.ct7.18q.50.6n.4p.1bt.3f.csa.ue.qyd'],
  [2.57, '', '2y61'],
  [2.611, 's102:0.1,s104:-0.75,s250:-0.75,s258:0,s262:0.05,s265:0.1,s266:0.25,s267:0.15,s268:-0.75,s62:0.25,s63:0.2,s64:0.2,s66:-0.75,s73:-0.75', '34t2'],
  [2.89, '', '2z87'],
  [3, '', '43a.9eq.7u7.4ff.fer.5cu.1o8b.z5p.dhh.593.4kn.uq.f.51h.2a.1p4.2b.2bl.d1d.7a.13b.3.5dm.a.bfe.rf.8.' +
  'f.b.1d.9.zd.1di.b.g2.1c0.4u.4cd.rh.20.6l2.2b6.87.20c.o3.1tq.1oi.3.an.1fn.hb.2.a9.54.gr.7t.6.2.12' +
  '.2.4.6l.6e5.2k.3ih.4dl.86.j.o.y.dk.1mv.1f.35u.2th.q1.hg.3u.ll.kn.z.2p.gk.8g.p.1ov.wm.2hg.4w.1r8.' +
  '14.34c.5n.1.14y.g6.zd.1ad.81d.11.2d8.11q.1m9.2jj.4ok.fp.5m.7n.3gu.149.8e0.1hv.c8e.6.3rd.s4.5mg.1' +
  'sn.7z.5y.h4.1z2.2y9.n3.3v.wj.22k.p8.1bh.4n.f.1e6.1c7.4.1ks.1bg.blr.fvwr.1gq.7l.1vr.a33.4tt.3cy.1' +
  '8.2.1.2.6n.t.1zt.1hi.32p.1fp.4r0.2q6.5z.5.11.2.r8.1oz.ty.4wf.4lw.buu.1rh.4s.pq.2ls'],
  [3, 'c2477:-0.5,s102:-0.5,s103:-0.5,s104:-0.5,s258:-0.5,s262:-0.5,s263:-0.5,s268:-0.5,s269:-0.5,s66:-0.5,s70:-0.5', '4u64'],
  [3, 'c2607:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '4u78'],
  [3, 'c400:-0.5,s102:-0.5,s104:-0.5,s105:-0.5,s250:-0.5,s253:-0.5,s254:-0.5,s262:-0.5,s264:-0.5,s268:-0.5,s270:-0.5,s581:-0.5,s65:-0.5,s66:-0.5,s73:-0.5', '5fgs'],
  [3, 'c400:-0.5,s102:-0.5,s104:-0.5,s105:-0.5,s250:-0.5,s262:-0.5,s264:-0.5,s268:-0.5,s270:-0.5,s581:-0.5,s65:-0.5,s66:-0.5,s73:-0.5', '5fgb.1'],
  [3, 'c476:-0.5,s102:-0.5,s103:-0.5,s105:-0.5,s251:-0.5,s252:-0.5,s269:-0.5,s270:-0.5,s577:-0.5,s65:-0.5,s70:-0.5,s71:-0.5,s72:-0.5', '577d'],
  [3, 's263:-0.24', '4lzq'],
  [3.5, '', '2z5i.p.1i8t.3qd.1j57.1uob.mbh.12pb.gxyj.10a2'],
  [3.5, 'c435:-0.5', '541n'],
  [3.67, '', '40eh.83'],
  [4, '', 'aei.od1.3doq.8pj.9p.ox.kis.6wu.ddu.23e.7kd.mb.5p.2w7.27g.8xh.o3.3uc.9lf.gc5.4ru.1vj.4g7.11b.95.h' +
  '4.45.7c.bm.ma.16.b0.4h.d4x.2f5.17c.sc.643.107.qgj.4d.3e.m24.132.ddf.fxlc.c.j.5.b.7en.1nk.m0b.cs0' +
  '.gm6.34b.ru.h.2.4.6'],
  [4, 'c2603:-0.5,s103:-0.5,s104:-0.5,s105:-0.5,s255:-0.5,s257:-0.5,s263:-0.5,s264:-0.5', '5fej'],
  [4, 'c476:-0.5,s102:-0.5,s103:-0.5,s105:-0.5,s251:-0.5,s252:-0.5,s269:-0.5,s270:-0.5,s577:-0.5,s65:-0.5,s70:-0.5,s71:-0.5,s72:-0.5', '577q'],
  [4.2, '', '7aij'],
  [4.5, '', '8op5'],
  [5, '', '35k2.1m.72.11pr.e1v.u9l.dxa.6lt.1di.7xs.84v.t3.ax7.8.hpe.1yv.1iu.25yt.32g.2.82.3fp.dzu.fwc3.5f.b' +
  'fq.8ty.7lr.6fb.v8.38t.dv.1.2wo'],
  [5, 'c435:-0.5,s102:-0.5,s104:-0.5,s105:-0.5,s253:-0.5,s254:-0.5,s262:-0.5,s264:-0.5,s268:-0.5,s270:-0.5,s581:-0.5', '4u61'],
  [5.5, '', '837w'],
  [6, '', '3y60.sya.55g.idg.a88.2ks.x.c.6.6.1u5.3qu.1e.2wg.bw.6v6.4.2.2.4jk.4cc.8.2v.2.1lu.as.37w.mau.1aa.1' +
  '3r.e5h.chm.8vb.j5.r.4.7lc.2.lya.e1r.1ni.5de.5.1.i.1.1.ol.1fh.grnp.3.2.2.3t.7fe.8yc.2vg.1.v.7.pd4' +
  '.fn'],
  [7.5, '', '7vxg'],
  [8, '', '5yk6.53.irc.1kuk.118q.n13.gcis.7s4.7po.k8.gzj.59p.nbe'],
  [9, '', '763z.kleu'],
  [9.17, '', '2hzc'],
  [10, '', 'mva.3jsi.12yc.qcy.chk.49u.2ll.u7s.obv.wgf.h42r.aa.9.70.f.1a.a2.id.6u.88.7ii.m.d95.79.1fr'],
  [10, 'c2477:-0.5,s102:-0.5,s103:-0.5,s104:-0.5,s258:-0.5,s262:-0.5,s263:-0.5,s268:-0.5,s269:-0.5,s66:-0.5,s70:-0.5', '5ffr'],
  [10, 'c400:-0.5,s102:-0.5,s104:-0.5,s105:-0.5,s250:-0.5,s253:-0.5,s254:-0.5,s262:-0.5,s264:-0.5,s268:-0.5,s270:-0.5,s581:-0.5,s65:-0.5,s66:-0.5,s73:-0.5', '56wa'],
  [10.8, '', '4qru'],
  [11.1, '', '900f'],
  [12, '', '4mk3.1n46.1egh.3q.899.gml.ee.1bv8.754.grbq'],
  [14, '', '7whm'],
  [15, '', '6ck3.7h7.12gx.1dek.1k.pfh.gdo3.1upw'],
  [16, '', '7who.qy4'],
  [20, '', '414r.66h.ek0.jb.dhv.1g4v.r.10ik.5td.1jp.8ee.1t1t.gkil.1ha2'],
  [20, 's0:0', '7vjk.y3.3.1zv9.h7jw'],
  [25, '', '5di5'],
  [30, '', 'a357.gnd4'],
  [30, 's0:0', '8wbg'],
  [50, '', '7weh'],
];

interface Rate {
  base: number;
  /** Class mask -> what it adds to the rate, as a fraction: -0.75 is a quarter of it. */
  classes: ReadonlyArray<readonly [number, number]>;
  /** Spec id -> the same. */
  specs: ReadonlyMap<number, number>;
}

/**
 * Built on the first lookup rather than at import: most of the app never asks,
 * and the decode is wasted work in a worker thread that only parses.
 */
let table: Map<number, Rate> | null = null;

function decode(): Map<number, Rate> {
  const built = new Map<number, Rate>();
  for (const [base, mods, text] of RATES) {
    const classes: Array<readonly [number, number]> = [];
    const specs = new Map<number, number>();
    for (const mod of mods === '' ? [] : mods.split(',')) {
      const [key, coeff] = mod.split(':') as [string, string];
      if (key[0] === 'c') classes.push([Number(key.slice(1)), Number(coeff)]);
      else specs.set(Number(key.slice(1)), Number(coeff));
    }
    const rate = { base, classes, specs };
    let id = 0;
    for (const delta of text.split('.')) {
      id += parseInt(delta, 36);
      built.set(id, rate);
    }
  }
  return built;
}

/**
 * How many times a minute this spell is meant to proc for a player of this
 * class and spec, or 0 when it is not a proc with a rate.
 *
 * 0 for every id the table has never heard of, so a proc newer than this file
 * is simply not counted, rather than counted against an expectation of nothing.
 */
export function procsPerMinute(spellId: number, classId: number, specId: number): number {
  table ??= decode();
  const rate = table.get(spellId);
  if (rate === undefined) return 0;
  let perMinute = rate.base;
  for (const [mask, coeff] of rate.classes) if (classId > 0 && mask & (1 << (classId - 1))) perMinute *= 1 + coeff;
  return perMinute * (1 + (rate.specs.get(specId) ?? 0));
}

/** How many spells the table knows. Exported for the test, which asserts it is not empty. */
export function procCount(): number {
  table ??= decode();
  return table.size;
}

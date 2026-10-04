import { useEffect, useRef, useState } from 'react';

import type { DeathReport } from '@mplus/analysis';

import { short } from '../format.js';
import { useSpellIcons } from '../icons.js';
import { Tip, useTip } from './Tip.js';

/**
 * The second before last, second by second.
 *
 * A death recap has to answer one question: was the healing there or not. A
 * chronological list of hits cannot answer it, because damage and healing
 * interleave and the eye cannot sum two columns of numbers in flight. So the
 * window is cut into one-second rows with damage growing left from the centre
 * and healing growing right, both on a single shared scale — a healing bar
 * shorter than the damage beside it is a second where they lost ground, and
 * that reads at a glance.
 *
 * Bars are per ability within the second rather than per hit: five ticks of one
 * DoT in the same second are one bar, which keeps the row legible when a pack
 * is channelling.
 *
 * Nothing is written on a bar. At this size a name is either absent or clipped
 * to a fragment — "Glacia" — which is worse than nothing, so a bar carries its
 * spell icon when there is room for one and the hover tip carries the words.
 */

interface Bar {
  key: string;
  label: string;
  source: string;
  amount: number;
  hits: number;
  color: string;
  /** The spell whose icon the bar draws. 0 when the log did not name one. */
  spellId: number;
  /** Contains the blow that finished them. */
  killing: boolean;
}

interface Row {
  key: number;
  label: string;
  damage: Bar[];
  healing: Bar[];
  damageTotal: number;
  healingTotal: number;
  isDeathSecond: boolean;
}

/** One reserved colour for every absorb, whichever shield it was. */
const ABSORB_COLOR = '#4a7fd4';

/** Square, and the bar is 14px tall. Must match .dt-ico in the stylesheet. */
const ICON_PX = 14;
/** Lane width assumed until the real one is measured, for the first paint. */
const ASSUMED_LANE_PX = 260;

// A spell id spread over a narrow hue band keeps the two sides readable as
// "damage" and "healing" before any label is read, while still giving each
// ability its own stable colour across every death in the run.
function damageColor(spellId: number): string {
  return `hsl(${(spellId * 47) % 54}, 70%, 52%)`;
}

function healColor(spellId: number): string {
  return `hsl(${104 + ((spellId * 47) % 68)}, 54%, 46%)`;
}

export function DeathTimeline({ death }: { death: DeathReport }): React.JSX.Element {
  const rows = buildRows(death);
  // One scale for both sides, or the comparison the chart exists for is a lie.
  const scale = Math.max(1, ...rows.map((row) => Math.max(row.damageTotal, row.healingTotal)));
  const icons = useSpellIcons(
    rows.flatMap((row) => [...row.damage, ...row.healing].map((bar) => bar.spellId)),
  );

  const laneRef = useRef<HTMLDivElement | null>(null);
  const tip = useTip<Bar>();

  // Whether a label or even an icon fits is a question about pixels, not about
  // share of the scale: the same 4% bar is legible in a maximised window and a
  // sliver in a tiled one. So the lane is measured rather than assumed.
  const [lanePx, setLanePx] = useState(0);
  useEffect(() => {
    const node = laneRef.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      setLanePx(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (rows.every((row) => row.damage.length === 0 && row.healing.length === 0)) {
    return (
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Nothing was recorded in the {death.windowMs / 1000}s before this death.
      </p>
    );
  }

  const lane = lanePx > 0 ? lanePx : ASSUMED_LANE_PX;

  return (
    <div className="dt" ref={tip.rootRef}>
      <div className="dt-head">
        <span>Damage taken</span>
        <span>sec</span>
        <span>Healing and absorbs</span>
      </div>
      {rows.map((row) => (
        <div className={`dt-row${row.isDeathSecond ? ' death' : ''}`} key={row.key}>
          <span className="dt-total">{row.damageTotal > 0 ? short(row.damageTotal) : ''}</span>
          <div className="dt-bars left" ref={row.key === 0 ? laneRef : undefined}>
            {row.damage.map((bar) => (
              <Segment
                bar={bar}
                scale={scale}
                lane={lane}
                icon={icons.get(bar.spellId)}
                onEnter={tip.show(bar)}
                onLeave={tip.hide}
                key={bar.key}
              />
            ))}
          </div>
          <span className="dt-mid">{row.label}</span>
          <div className="dt-bars right">
            {row.healing.map((bar) => (
              <Segment
                bar={bar}
                scale={scale}
                lane={lane}
                icon={icons.get(bar.spellId)}
                onEnter={tip.show(bar)}
                onLeave={tip.hide}
                key={bar.key}
              />
            ))}
          </div>
          <span className="dt-total">{row.healingTotal > 0 ? short(row.healingTotal) : ''}</span>
        </div>
      ))}
      {tip.data === null ? null : (
        <Tip state={tip} icon={icons.get(tip.data.spellId)}>
          <strong>{tip.data.label}</strong>
          {tip.data.source === '' ? null : <span className="dim"> {tip.data.source}</span>}
          <span className="tip-nums">
            {short(tip.data.amount)}
            {tip.data.hits > 1 ? ` · ${tip.data.hits} hits` : ''}
            {tip.data.killing ? ' · killing blow' : ''}
          </span>
        </Tip>
      )}
    </div>
  );
}

function Segment({
  bar,
  scale,
  lane,
  icon,
  onEnter,
  onLeave,
}: {
  bar: Bar;
  scale: number;
  lane: number;
  icon: string | undefined;
  onEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onLeave: () => void;
}): React.JSX.Element {
  const fraction = bar.amount / scale;
  // Whether the icon fits is a question about pixels, not about share of the
  // scale: the same 4% bar is legible in a maximised window and a sliver in a
  // tiled one. A cropped icon is unrecognisable, so it is all or nothing.
  const showIcon = icon !== undefined && fraction * lane >= ICON_PX + 2;

  const detail = [
    bar.label,
    bar.source,
    short(bar.amount),
    bar.hits > 1 ? `${bar.hits} hits` : '',
  ].filter((part) => part !== '');

  return (
    <span
      className={`dt-bar${bar.killing ? ' killing' : ''}`}
      style={{ width: `${fraction * 100}%`, background: bar.color }}
      aria-label={detail.join(' · ')}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {showIcon ? <img className="dt-ico" src={icon} alt="" /> : null}
    </span>
  );
}

function buildRows(death: DeathReport): Row[] {
  const start = death.ts - death.windowMs;
  const count = Math.max(1, Math.round(death.windowMs / 1000));
  const bucketOf = (ts: number): number =>
    Math.min(count - 1, Math.max(0, Math.floor((ts - start) / 1000)));

  const damage = new Map<string, Bar>();
  const healing = new Map<string, Bar>();
  /** Bucket -> absorbed amount, used only when the shields are not named. */
  const fallbackAbsorbs = new Map<number, number>();
  const add = (into: Map<string, Bar>, key: string, bar: Bar): void => {
    const existing = into.get(key);
    if (existing === undefined) {
      into.set(key, bar);
      return;
    }
    existing.amount += bar.amount;
    existing.hits += bar.hits;
    existing.killing = existing.killing || bar.killing;
  };

  for (const hit of death.incoming) {
    const bucket = bucketOf(hit.ts);
    const killing =
      death.killingBlow !== null &&
      hit.ts === death.killingBlow.ts &&
      hit.spellId === death.killingBlow.spellId;
    if (hit.amount > 0) {
      add(damage, `${bucket}:${hit.spellId}`, {
        key: `${bucket}:d:${hit.spellId}`,
        label: hit.spellName,
        source: hit.sourceName,
        amount: hit.amount,
        hits: 1,
        color: damageColor(hit.spellId),
        spellId: hit.spellId,
        killing,
      });
    }
    // Absorbs are added below rather than here. The damage row only carries an
    // amount, and "absorbed 424K" does not say whether that was the healer, a
    // defensive or a trinket — which is the only reason to look.
    if (hit.absorbed > 0) fallbackAbsorbs.set(bucket, (fallbackAbsorbs.get(bucket) ?? 0) + hit.absorbed);
  }

  // An absorb is damage that never landed, so it belongs with the healing: it
  // is the shield doing the healer's job a second early. SPELL_ABSORBED names
  // the shield and its caster, so each one is its own bar.
  for (const absorb of death.absorbsReceived) {
    if (absorb.amount <= 0) continue;
    const bucket = bucketOf(absorb.ts);
    add(healing, `${bucket}:a${absorb.spellId}`, {
      key: `${bucket}:h:a${absorb.spellId}`,
      label: absorb.spellName,
      source: absorb.selfApplied ? 'their own' : absorb.sourceName,
      amount: absorb.amount,
      hits: 1,
      color: ABSORB_COLOR,
      spellId: absorb.spellId,
      killing: false,
    });
  }
  // A log with no SPELL_ABSORBED lines for these hits still knows how much was
  // absorbed, just not by what. Better an unnamed bar than a missing one.
  if (death.absorbsReceived.length === 0) {
    for (const [bucket, amount] of fallbackAbsorbs) {
      add(healing, `${bucket}:a0`, {
        key: `${bucket}:h:a0`,
        label: 'absorbed',
        source: '',
        amount,
        hits: 1,
        color: ABSORB_COLOR,
        spellId: 0,
        killing: false,
      });
    }
  }

  for (const heal of death.healsReceived) {
    if (heal.amount <= 0) continue;
    const bucket = bucketOf(heal.ts);
    add(healing, `${bucket}:${heal.spellId}`, {
      key: `${bucket}:h:${heal.spellId}`,
      label: heal.spellName,
      source: heal.sourceName,
      amount: heal.amount,
      hits: 1,
      color: healColor(heal.spellId),
      spellId: heal.spellId,
      killing: false,
    });
  }

  const rows: Row[] = [];
  for (let bucket = 0; bucket < count; bucket++) {
    const prefix = `${bucket}:`;
    const inBucket = (entries: Map<string, Bar>): Bar[] =>
      [...entries.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, bar]) => bar)
        // Largest nearest the centre line, so the row reads outward.
        .sort((a, b) => b.amount - a.amount);
    const damageBars = inBucket(damage);
    const healingBars = inBucket(healing);
    rows.push({
      key: bucket,
      label: `−${count - bucket}`,
      damage: damageBars,
      healing: healingBars,
      damageTotal: damageBars.reduce((sum, bar) => sum + bar.amount, 0),
      healingTotal: healingBars.reduce((sum, bar) => sum + bar.amount, 0),
      isDeathSecond: bucket === count - 1,
    });
    rows.reverse();
  }
  return rows;
}

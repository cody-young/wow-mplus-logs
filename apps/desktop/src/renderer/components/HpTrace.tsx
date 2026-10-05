import type { DeathReport } from '@mplus/analysis';

import { short } from '../format.js';

/**
 * Health over the seconds before a death, with every hit that landed marked on
 * it. Inline SVG rather than a charting library: it is ~160 points, it has to
 * stay legible at any panel width, and the hit markers need to share the same
 * coordinate space as the line.
 */
export function HpTrace({ death }: { death: DeathReport }): React.JSX.Element {
  const width = 1000;
  const height = 118;
  const pad = { top: 8, bottom: 16, left: 0, right: 0 };
  const plot = height - pad.top - pad.bottom;

  // The whole captured span, not the ten seconds the totals describe: the
  // trace and the hits both reach back that far, and plotting them against the
  // shorter window walks everything older than it off the left edge.
  const start = death.ts - death.scrollbackMs;
  const x = (ts: number): number => ((ts - start) / death.scrollbackMs) * width;
  const y = (fraction: number): number => pad.top + (1 - Math.max(0, Math.min(1, fraction))) * plot;

  const samples = death.trace.filter((sample) => sample.fraction >= 0);
  if (samples.length < 2) {
    return (
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        No health trace for this death. Advanced combat logging may have been off.
      </p>
    );
  }

  const line = samples.map((sample) => `${x(sample.ts).toFixed(1)},${y(sample.fraction).toFixed(1)}`).join(' ');
  const area = `${x(samples[0]!.ts).toFixed(1)},${y(0)} ${line} ${x(samples[samples.length - 1]!.ts).toFixed(1)},${y(0)}`;
  const biggest = death.incoming.reduce((peak, hit) => Math.max(peak, hit.amount), 1);

  return (
    <svg className="trace" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={`Health trace over the ${death.scrollbackMs / 1000} seconds before death`}>
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line key={fraction} x1={0} x2={width} y1={y(fraction)} y2={y(fraction)} stroke="#242430" strokeWidth={1} />
      ))}
      <polygon points={area} fill="#4a7fd4" opacity={0.14} />
      <polyline points={line} fill="none" stroke="#6ea8fe" strokeWidth={2} vectorEffect="non-scaling-stroke" />

      {/* Each incoming hit, height proportional to its size. */}
      {death.incoming.map((hit, index) => {
        const h = (hit.amount / biggest) * plot * 0.55;
        const killing = death.killingBlow !== null && hit.ts === death.killingBlow.ts && hit.spellId === death.killingBlow.spellId;
        return (
          <line
            key={`${hit.ts}-${hit.spellId}-${index}`}
            x1={x(hit.ts)}
            x2={x(hit.ts)}
            y1={y(0)}
            y2={y(0) - h}
            stroke={killing ? '#e05c5c' : '#8b5cf6'}
            strokeWidth={killing ? 3 : 1.5}
            opacity={killing ? 1 : 0.55}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      <text x={4} y={y(1) - 1} fill="#5e5e75" fontSize={11}>
        {short(samples[0]!.hpMax)} max
      </text>
      <text x={4} y={height - 4} fill="#5e5e75" fontSize={11}>
        −{death.scrollbackMs / 1000}s
      </text>
      <text x={width - 4} y={height - 4} fill="#5e5e75" fontSize={11} textAnchor="end">
        death
      </text>
    </svg>
  );
}

/**
 * One colour per segment, shared by the route timeline and the map, so a pull
 * reads as the same pull in both.
 */
import type { Segment } from '@mplus/analysis';

/**
 * Each step is the golden angle round the hue wheel, so segments next to each
 * other in the key — which are next to each other on the map and on the
 * timeline — never come out alike. Keyed on the run's own segment order, so
 * every view that is handed the same run agrees.
 */
export function segmentColours(segments: readonly Segment[]): ReadonlyMap<number, string> {
  return new Map(
    segments.map((segment, index) => [segment.id, `hsl(${Math.round((index * 137.508 + 200) % 360)}, 72%, 55%)`]),
  );
}

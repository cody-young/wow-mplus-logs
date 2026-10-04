import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The hover tip the charts and tables share.
 *
 * Own tip rather than the `title` attribute: the browser's takes about a second
 * to appear and lands wherever the pointer is, which is useless on a 14px bar
 * in a stack of them. This one is instant and sits against the thing it
 * describes — above it, or below it when the view has no room above.
 *
 * The hook keeps the hovered item and its position in coordinates relative to
 * a positioned root — the chart or the table — so the tip is a sibling of the
 * rows rather than a portal, and scrolls with them.
 */

/** What is hovered right now, and where its tip points. */
interface Anchor<T> {
  data: T;
  /** Centre of the hovered element, which the tip is centred on. */
  x: number;
  /** Its top edge, which the tip sits above. */
  y: number;
  /** Its bottom edge, which the tip drops to when there is no room above. */
  bottom: number;
}

export interface TipState<T> {
  /** Put this on the positioned element the tip is placed inside. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  tipRef: React.RefObject<HTMLDivElement | null>;
  /** The hovered item, or null when nothing is. */
  data: T | null;
  /** Placement for the tip. Undefined while nothing is hovered. */
  style: { left: number; top: number } | undefined;
  /** True when the tip had to drop below what it describes. */
  below: boolean;
  /** `onMouseEnter` for an element describing `data`. */
  show: (data: T) => (event: React.MouseEvent<HTMLElement>) => void;
  /** `onMouseLeave`. */
  hide: () => void;
}

/** Breathing room between the tip and what it describes. Matches the stylesheet. */
const GAP_PX = 6;

/**
 * The top edge of whatever would cut the tip off: the nearest scrolling
 * ancestor, or the window. The chart or table itself is the wrong answer — its
 * own first row is exactly the case that needs the tip placed outside it.
 */
function clipTop(node: HTMLElement): number {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent.getBoundingClientRect().top;
  }
  return 0;
}

export function useTip<T>(): TipState<T> {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<Anchor<T> | null>(null);
  const [nudge, setNudge] = useState(0);
  const [below, setBelow] = useState(false);

  // The tip is centred on what it describes, which puts it off the edge for the
  // items at either end. Measured after paint and slid back inside, which is
  // one extra render per hover and never loops: the effect only runs when the
  // anchor changes.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const root = rootRef.current;
    if (anchor === null || tip === null || root === null) {
      setNudge(0);
      return;
    }
    const tipBox = tip.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const over = Math.max(0, tipBox.right - rootBox.right) - Math.max(0, rootBox.left - tipBox.left);
    if (over !== 0) setNudge((current) => current - over);
    // Above by default, below when the view would cut the top off — which is
    // the normal case for the first rows of a long table. Decided from the
    // room above rather than from where the tip currently is, so the two
    // placements cannot argue with each other and flip forever.
    setBelow(rootBox.top + anchor.y - tipBox.height - GAP_PX < clipTop(root));
  }, [anchor]);

  return {
    rootRef,
    tipRef,
    data: anchor?.data ?? null,
    below,
    style:
      anchor === null ? undefined : { left: anchor.x + nudge, top: below ? anchor.bottom : anchor.y },
    show: (data: T) => (event: React.MouseEvent<HTMLElement>): void => {
      const root = rootRef.current;
      if (root === null) return;
      const box = event.currentTarget.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      setAnchor({
        data,
        x: box.left + box.width / 2 - rootBox.left,
        y: box.top - rootBox.top,
        bottom: box.bottom - rootBox.top,
      });
    },
    hide: () => setAnchor(null),
  };
}

/** The tip itself: an optional spell icon, then whatever the caller writes. */
export function Tip<T>({
  state,
  icon,
  children,
}: {
  state: TipState<T>;
  icon?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`tip${state.below ? ' below' : ''}`}
      ref={state.tipRef}
      style={state.style}
      role="tooltip"
    >
      {icon === undefined ? null : <img className="tip-ico" src={icon} alt="" />}
      <div className="tip-body">{children}</div>
    </div>
  );
}

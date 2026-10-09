import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 *
 * Plain-text tips go through `data-tip` instead, which `AttributeTips` serves
 * for the whole window. Never `title`: that brings the slow browser tip back.
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

/** Where the attribute tip points, in viewport coordinates. */
interface AttributeAnchor {
  text: string;
  x: number;
  y: number;
  bottom: number;
}

/** Room for the cursor itself, when a tip follows the pointer and drops below it. */
const CURSOR_PX = 20;

/**
 * The tip for every `data-tip` in the window: the same look as `Tip`, for
 * anything whose tip is a line or two of text. Mounted once, beside the app.
 *
 * It sits against the element it describes, like `Tip`. An element marked
 * `data-tip-follow` — the map canvas, whose tip is whatever pull is under the
 * pointer — gets it against the pointer instead. The text is read live, so an
 * element can change its tip while hovered.
 */
export function AttributeTips(): React.JSX.Element | null {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<AttributeAnchor | null>(null);
  const [place, setPlace] = useState({ nudge: 0, below: false });

  useEffect(() => {
    let active: HTMLElement | null = null;
    let point: { x: number; y: number } | null = null;
    // A click puts the tip away until the pointer leaves, as the browser's does.
    let dismissed = false;

    const show = (): void => {
      const text = active?.dataset['tip'] ?? '';
      if (active === null || dismissed || text === '' || !active.isConnected) {
        setAnchor(null);
        return;
      }
      if (point !== null && active.hasAttribute('data-tip-follow')) {
        setAnchor({ text, x: point.x, y: point.y, bottom: point.y + CURSOR_PX });
        return;
      }
      const box = active.getBoundingClientRect();
      setAnchor({ text, x: box.left + box.width / 2, y: box.top, bottom: box.bottom });
    };
    const watch = new MutationObserver(show);
    const activate = (element: HTMLElement | null): void => {
      if (element === active) return;
      active = element;
      dismissed = false;
      watch.disconnect();
      if (element !== null) watch.observe(element, { attributes: true, attributeFilter: ['data-tip'] });
      show();
    };

    const over = (event: PointerEvent): void => {
      point = { x: event.clientX, y: event.clientY };
      activate(event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null);
    };
    const move = (event: PointerEvent): void => {
      point = { x: event.clientX, y: event.clientY };
      // An element removed from under a still pointer never reports leaving.
      if (active !== null && !active.isConnected) activate(null);
      else if (active?.hasAttribute('data-tip-follow') === true) {
        dismissed = false;
        show();
      }
    };
    const out = (event: PointerEvent): void => {
      if (event.relatedTarget === null) activate(null);
    };
    const away = (): void => {
      dismissed = true;
      setAnchor(null);
    };
    const hide = (): void => activate(null);

    document.addEventListener('pointerover', over);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      watch.disconnect();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Slid back inside the window and flipped below when the top would be cut
  // off, measured after paint as `useTip` does. Placed from the anchor alone,
  // so the two placements cannot argue and flip forever.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (anchor === null || tip === null) return;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const half = width / 2;
    const left = Math.min(Math.max(anchor.x, half + GAP_PX), Math.max(window.innerWidth - half - GAP_PX, half));
    const below = anchor.y - height - GAP_PX < 0;
    const nudge = left - anchor.x;
    setPlace((current) => (current.nudge === nudge && current.below === below ? current : { nudge, below }));
  }, [anchor]);

  if (anchor === null) return null;
  return (
    <div
      className={`tip attr-tip${place.below ? ' below' : ''}`}
      ref={tipRef}
      style={{ left: anchor.x + place.nudge, top: place.below ? anchor.bottom : anchor.y }}
      role="tooltip"
    >
      <div className="tip-body">{anchor.text}</div>
    </div>
  );
}

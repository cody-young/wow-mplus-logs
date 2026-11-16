import type { ConsumableState, DeathReport, Readiness } from '@mplus/analysis';

/**
 * The narc: what they died with still in the bag.
 *
 * Ready is the point and is loud; pressed is the good outcome and says so;
 * not back yet is said quietly and with a hedge, because the clocks are base
 * clocks and a talent may have had it back. See `narc.ts` in the analysis.
 */
export function DeathNarc({ death }: { death: DeathReport }): React.JSX.Element {
  const { healthstone, potion, defensives, oneShot } = death.narc;
  // A heal saves nobody from a hit bigger than their health bar, so on a
  // one-shot a ready healthstone or potion is no charge against them.
  const excuse = (item: Item): Item =>
    oneShot !== null && item.state === 'ready' ? { ...item, state: 'cooldown', excused: true } : item;
  const items: Item[] = [
    ...(healthstone === null ? [] : [excuse(consumable('Healthstone', healthstone, 60))]),
    excuse(consumable('Health Potion', potion, 300)),
    ...defensives.map((entry) => ({ name: entry.name, state: entry.state, lastUsedTs: entry.lastUsedTs })),
  ];
  const ready = items.filter((item) => item.state === 'ready').map((item) => item.name);
  const heckle = quip(death);

  return (
    <>
      <h3>Narc</h3>
      {heckle === null ? null : <p className="narc-quip">{heckle}</p>}
      {oneShot !== null ? (
        <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>
          One-shot: {oneShot.spellName} took {Math.round(Math.min(1, oneShot.fraction) * 100)}% of their health at
          once. No healthstone or potion would have saved them.
        </p>
      ) : null}
      <p style={{ margin: '0 0 8px', color: ready.length > 0 ? 'var(--danger)' : 'var(--dim)' }}>
        {ready.length > 0
          ? `Died with ${list(ready)} ready.`
          : oneShot !== null
            ? 'No defensive of theirs was left unused.'
            : 'Nothing left unused: everything was pressed or still coming back.'}
      </p>
      <div className="chips">
        {items.map((item) => (
          <span key={item.name} className={`chip narc ${item.state}`} data-tip={tip(item, death.ts)}>
            {item.name}
            <span className="narc-state"> · {label(item, death.ts)}</span>
          </span>
        ))}
      </div>
      {defensives.length === 0 ? (
        <p className="roster-note">
          No big defensive of theirs showed up anywhere in this run, so there is none to hold against them.
        </p>
      ) : null}
    </>
  );
}

interface Item {
  name: string;
  state: Readiness;
  lastUsedTs: number | null;
  /** Base cooldown in seconds, for the tooltip of a consumable. */
  cooldownS?: number;
  /** Ready, but a one-shot made it no use. */
  excused?: boolean;
}

function consumable(name: string, state: ConsumableState, cooldownS: number): Item {
  return { name, state: state.state, lastUsedTs: state.lastUsedTs, cooldownS };
}

function label(item: Item, deathTs: number): string {
  if (item.excused === true) return 'ready, no use against a one-shot';
  const ago = item.lastUsedTs === null ? '' : since(deathTs - item.lastUsedTs);
  switch (item.state) {
    case 'ready':
      return 'ready';
    case 'pressed':
      return `pressed −${ago}`;
    case 'cooldown':
      return `used ${ago} before`;
    case 'empty':
      return 'out of charges';
  }
}

function tip(item: Item, deathTs: number): string {
  if (item.excused === true) return 'Off cooldown, but they went from full to dead in one ability: no heal would have kept them up.';
  const last =
    item.lastUsedTs === null
      ? 'Not used before this death.'
      : `Last used ${since(deathTs - item.lastUsedTs)} before they died.`;
  switch (item.state) {
    case 'ready':
      return `${last} Off cooldown and unused.`;
    case 'pressed':
      return 'Used in the seconds before they died.';
    case 'cooldown':
      return `${last} Not back yet on its base cooldown — a talent may have had it back sooner.`;
    case 'empty':
      return 'All three charges used, and no Soulwell since to take another.';
  }
}

/**
 * The subtitle: one line of heckling, or null when there is nothing to heckle.
 *
 * A forgotten healthstone or potion is the headline, a one-shot excuses it,
 * and a big defensive left on the bar is saved for next key. Where there are
 * two ways to say it, which one is fixed by the death, so it holds still
 * while the reader clicks around.
 */
export function quip(death: DeathReport): string | null {
  const { healthstone, potion, defensives, oneShot } = death.narc;
  const forgot = [
    ...(healthstone?.state === 'ready' ? ['healthstone'] : []),
    ...(potion.state === 'ready' ? ['health pot'] : []),
  ].join(' or ');
  const saved = defensives.some((entry) => entry.state === 'ready');
  if (forgot !== '' && oneShot === null) {
    const lines = [
      `I'm telling mom you forgot to ${forgot}`,
      death.self ? `You forgot to ${forgot}, didn't you?` : `Someone forgot to ${forgot}`,
    ];
    return `📸 ${lines[hash(`${death.actorIndex}-${death.ts}`) % lines.length]!}`;
  }
  if (saved) return '📸 Saving it for next key';
  return null;
}

/** A small, stable number from a string: the same death always picks the same line. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** 42s, or 3:20 past a minute. */
function since(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

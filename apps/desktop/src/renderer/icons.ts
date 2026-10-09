/**
 * Icons for the views, as hooks over one process-wide cache.
 *
 * The cache is module state rather than React state because the same spells
 * appear in every death of a run: the second death should draw instantly from
 * what the first one resolved, and selecting a death is a remount. Components
 * subscribe to a version counter, so one resolved batch repaints everyone.
 *
 * Two kinds of key share that cache. Spell icons are keyed by spell id and
 * come from whatever is on screen. Spec icons are keyed by texture name and
 * are a closed set — so they are fetched as one batch the first time any view
 * wants one, rather than five separate round trips for a five-player party.
 * Numbers and strings never collide as Map keys, so one cache serves both.
 *
 * Spell descriptions ride along in a cache of their own — same ids as the
 * icons, different values — and the same version counter, since they come
 * from the same lookup in the main process.
 *
 * Icons are optional by design. Without the bridge (the server-rendered smoke
 * test) or without network (MPLUS_OFFLINE=1, a plane, a dead CDN) this resolves
 * to nothing and every view still renders — nothing waits on an icon.
 */
import { useEffect, useState } from 'react';

import { SPECS } from './specs.js';

type Key = number | string;

/** Spell id or icon name -> data URL, or null for "asked, and there is none". */
const cache = new Map<Key, string | null>();
const inflight = new Set<Key>();
/** Spell id -> description, or null for "asked, and there is none". */
const descriptionCache = new Map<number, string | null>();
const descriptionInflight = new Set<number>();
/** Spell id -> name, for the ids the log never named. */
const nameCache = new Map<number, string | null>();
const nameInflight = new Set<number>();
const subscribers = new Set<(version: number) => void>();
let version = 0;

function notify(): void {
  version++;
  for (const subscriber of subscribers) subscriber(version);
}

function bridge(): Window['mplus'] | undefined {
  return typeof window === 'undefined' ? undefined : window.mplus;
}

/**
 * Resolves whichever keys are not already known or in flight.
 *
 * `kind` picks the bridge call rather than being inferred from the key type,
 * so a numeric-looking icon name could never be sent down the spell path.
 */
async function request(keys: readonly Key[], kind: 'spell' | 'named'): Promise<void> {
  const api = bridge();
  const wanted = keys.filter((key) => !cache.has(key) && !inflight.has(key));
  const resolve = kind === 'spell' ? api?.resolveIcons : api?.resolveNamedIcons;
  if (wanted.length === 0 || resolve === undefined) return;

  for (const key of wanted) inflight.add(key);
  try {
    const found =
      kind === 'spell'
        ? await api!.resolveIcons(wanted as number[])
        : await api!.resolveNamedIcons(wanted as string[]);
    for (const key of wanted) cache.set(key, (found as Record<Key, string>)[key] ?? null);
  } catch {
    // Left uncached on purpose: a failed batch should be retried the next time
    // a view asks, not remembered as "this spell has no icon".
  } finally {
    for (const key of wanted) inflight.delete(key);
    notify();
  }
}

/** Same as `request`, for descriptions — and for names, which share the shape. */
async function requestDescriptions(ids: readonly number[], kind: 'description' | 'name' = 'description'): Promise<void> {
  const api = bridge();
  const into = kind === 'description' ? descriptionCache : nameCache;
  const busy = kind === 'description' ? descriptionInflight : nameInflight;
  const wanted = ids.filter((id) => !into.has(id) && !busy.has(id));
  const resolve = kind === 'description' ? api?.resolveDescriptions : api?.resolveSpellNames;
  if (wanted.length === 0 || resolve === undefined) return;

  for (const id of wanted) busy.add(id);
  try {
    const found = await resolve(wanted);
    for (const id of wanted) into.set(id, found[id] ?? null);
  } catch {
    // Uncached, to be asked again, for the same reason as a failed icon batch.
  } finally {
    for (const id of wanted) busy.delete(id);
    notify();
  }
}

/** Repaints the caller whenever any batch resolves. */
function useIconVersion(): void {
  const [, setVersion] = useState(version);
  useEffect(() => {
    const onChange = (next: number): void => setVersion(next);
    subscribers.add(onChange);
    return () => {
      subscribers.delete(onChange);
    };
  }, []);
}

function resolved<K extends Key>(keys: readonly K[]): ReadonlyMap<K, string> {
  const out = new Map<K, string>();
  for (const key of keys) {
    const url = cache.get(key);
    if (typeof url === 'string') out.set(key, url);
  }
  return out;
}

/**
 * Data URLs for the ids that have one. Ids still resolving are simply absent,
 * so a caller renders without the icon now and with it when it arrives.
 */
export function useSpellIcons(spellIds: readonly number[]): ReadonlyMap<number, string> {
  const ids = [...new Set(spellIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const key = ids.join(',');
  useIconVersion();

  useEffect(() => {
    // Re-read from the key so the effect never closes over a stale array.
    void request(key === '' ? [] : key.split(',').map(Number), 'spell');
  }, [key]);

  return resolved(ids);
}

/**
 * The spells' descriptions, for the ids that have one. Like the icons, an id
 * still resolving is just absent, and a view without them reads the same.
 */
export function useSpellDescriptions(spellIds: readonly number[]): ReadonlyMap<number, string> {
  const ids = [...new Set(spellIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const key = ids.join(',');
  useIconVersion();

  useEffect(() => {
    void requestDescriptions(key === '' ? [] : key.split(',').map(Number));
  }, [key]);

  const out = new Map<number, string>();
  for (const id of ids) {
    const text = descriptionCache.get(id);
    if (typeof text === 'string') out.set(id, text);
  }
  return out;
}

/**
 * Names for spells the log gave only an id, with the same contract as the
 * descriptions: absent until resolved, and absent for good offline.
 */
export function useSpellNames(spellIds: readonly number[]): ReadonlyMap<number, string> {
  const ids = [...new Set(spellIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const key = ids.join(',');
  useIconVersion();

  useEffect(() => {
    void requestDescriptions(key === '' ? [] : key.split(',').map(Number), 'name');
  }, [key]);

  const out = new Map<number, string>();
  for (const id of ids) {
    const text = nameCache.get(id);
    if (typeof text === 'string') out.set(id, text);
  }
  return out;
}

/**
 * Every spec's icon, keyed by texture name.
 *
 * The whole table at once, deliberately: it is 39 icons of a couple of
 * kilobytes each, fetched once per machine ever, and asking for the set means
 * a party's five icons appear together instead of popping in one by one as
 * five separate requests come back.
 */
const SPEC_ICON_NAMES = [...new Set(Object.values(SPECS).map((spec) => spec.icon))].filter(
  (name) => name !== '',
);

/**
 * Memoised on the version counter, because every spec icon on screen calls
 * this: a party header, a death list and an expanded breakdown together render
 * dozens, and each would otherwise rebuild the whole 39-entry map for the one
 * entry it reads. The set is fixed, so one map per resolved batch is enough.
 */
let specMemo: { version: number; icons: ReadonlyMap<string, string> } | null = null;

export function useSpecIcons(): ReadonlyMap<string, string> {
  useIconVersion();
  useEffect(() => {
    void request(SPEC_ICON_NAMES, 'named');
  }, []);

  if (specMemo === null || specMemo.version !== version) {
    specMemo = { version, icons: resolved(SPEC_ICON_NAMES) };
  }
  return specMemo.icons;
}

/**
 * Display id -> portrait data URL, or null for "asked, and there is none".
 * Its own cache rather than the shared one: display ids and spell ids are both
 * numbers, and the same number names a model and an unrelated spell.
 */
const portraitCache = new Map<number, string | null>();
const portraitInflight = new Set<number>();

async function requestPortraits(ids: readonly number[]): Promise<void> {
  const api = bridge();
  const wanted = ids.filter((id) => !portraitCache.has(id) && !portraitInflight.has(id));
  if (wanted.length === 0 || api?.resolvePortraits === undefined) return;

  for (const id of wanted) portraitInflight.add(id);
  try {
    const found = await api.resolvePortraits(wanted);
    for (const id of wanted) portraitCache.set(id, found[id] ?? null);
  } catch {
    // Uncached, to be asked again, for the same reason as a failed icon batch.
  } finally {
    for (const id of wanted) portraitInflight.delete(id);
    notify();
  }
}

/**
 * Creature portraits by display id, for the ids that have one. Like the
 * icons, an id still resolving is absent and the map draws a plain dot.
 */
export function usePortraits(displayIds: readonly number[]): ReadonlyMap<number, string> {
  const ids = [...new Set(displayIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const key = ids.join(',');
  useIconVersion();

  useEffect(() => {
    void requestPortraits(key === '' ? [] : key.split(',').map(Number));
  }, [key]);

  const out = new Map<number, string>();
  for (const id of ids) {
    const url = portraitCache.get(id);
    if (typeof url === 'string') out.set(id, url);
  }
  return out;
}

/**
 * Spell icons, which the combat log does not contain.
 *
 * A log line carries a spell id and a name and nothing else, so an icon has to
 * come from outside: Wowhead's tooltip endpoint turns an id into an icon name
 * and its CDN serves the 36px jpg. That is the only network traffic this app
 * ever makes, it is driven entirely by spell ids the user already has in their
 * own log, and it happens at most once per spell per machine — everything is
 * written to userData and read from there forever after. Set MPLUS_OFFLINE=1 to
 * turn it off completely; the UI simply draws no icons.
 *
 * Nothing here is allowed to fail loudly. An icon is decoration on a chart that
 * is already readable without it, so a timeout, a 404 or no network at all
 * resolves to "no icon" and the renderer never hears about it.
 *
 * Two ways in, sharing one on-disk store. `resolveIcons` takes spell ids and
 * has to ask the tooltip endpoint what an id's icon is called. `resolveNamed`
 * takes the names directly, for art that is not a spell and so has no id to
 * look up: the class/spec icons, whose texture names are fixed game data the
 * renderer already holds. That path skips the tooltip hop entirely and is one
 * CDN request per icon, once per machine, ever.
 *
 * The same tooltip response also carries the spell's description, which the
 * Superiority Assister shows on hover. It is kept from the call that already
 * happens for the icon, in its own file beside the index, so spells looked up
 * before descriptions were kept are asked once more and never again.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

/** Spell id -> icon name, or null for "asked, and there is no icon". */
type Index = Record<string, string | null>;
/** Spell id -> description as plain text, or null for "asked, and there is none". */
type Descriptions = Record<string, string | null>;

const TIMEOUT_MS = 6000;
const CONCURRENCY = 4;
const UA = 'mplus-logs (local combat log viewer)';

let dir = '';
let index: Index | null = null;
let indexDirty = false;
let descriptions: Descriptions | null = null;
let descriptionsDirty = false;
/** Icon name -> data URL. The hot path, so disk is touched once per name. */
const dataUrls = new Map<string, string>();
const inflight = new Map<number, Promise<void>>();
const namedInflight = new Map<string, Promise<void>>();
/**
 * Names the CDN had nothing for, this session only.
 *
 * Not written to the index like a spell miss is: these names come from our own
 * static tables rather than from a log, so a miss means the table is wrong and
 * should start working again the moment it is fixed — not be remembered as
 * fact across every future run.
 */
const namedMisses = new Set<string>();

function offline(): boolean {
  return process.env['MPLUS_OFFLINE'] === '1';
}

/**
 * Icon names come from a remote response and are used as a filename, so they
 * are whitelisted rather than escaped: anything that is not a plain icon name
 * is treated as "no icon".
 */
function safeName(name: unknown): string | null {
  return typeof name === 'string' && /^[a-z0-9_]{1,80}$/i.test(name) ? name : null;
}

async function store(): Promise<string> {
  if (dir === '') {
    dir = join(app.getPath('userData'), 'spell-icons');
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

async function loadIndex(): Promise<Index> {
  if (index !== null) return index;
  try {
    const raw = await readFile(join(await store(), 'index.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    index = typeof parsed === 'object' && parsed !== null ? (parsed as Index) : {};
  } catch {
    index = {};
  }
  return index;
}

async function saveIndex(): Promise<void> {
  if (!indexDirty || index === null) return;
  indexDirty = false;
  try {
    await writeFile(join(await store(), 'index.json'), JSON.stringify(index), 'utf8');
  } catch {
    // A cache that cannot be written just means the next run asks again.
  }
}

async function loadDescriptions(): Promise<Descriptions> {
  if (descriptions !== null) return descriptions;
  try {
    const raw = await readFile(join(await store(), 'descriptions.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    descriptions = typeof parsed === 'object' && parsed !== null ? (parsed as Descriptions) : {};
  } catch {
    descriptions = {};
  }
  return descriptions;
}

async function saveDescriptions(): Promise<void> {
  if (!descriptionsDirty || descriptions === null) return;
  descriptionsDirty = false;
  try {
    await writeFile(join(await store(), 'descriptions.json'), JSON.stringify(descriptions), 'utf8');
  } catch {
    // Same as the index: unwritten just means asked again next run.
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * The description out of a tooltip's HTML, as plain text.
 *
 * Wowhead puts it in the first `<div class="q">` of the tooltip. It is reduced
 * to text here, in the main process, so the renderer only ever gets a string
 * to print and never markup from a remote response to inject.
 */
export function describe(tooltip: unknown): string | null {
  if (typeof tooltip !== 'string') return null;
  const match = /<div class="q">([\s\S]*?)<\/div>/.exec(tooltip);
  if (match === null) return null;
  const text = match[1]!
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith('#')) {
        const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text.slice(0, 1000);
}

async function readCached(name: string): Promise<string | null> {
  const cached = dataUrls.get(name);
  if (cached !== undefined) return cached;
  try {
    const bytes = await readFile(join(await store(), `${name}.jpg`));
    const url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    dataUrls.set(name, url);
    return url;
  } catch {
    return null;
  }
}

async function get(url: string, as: 'json' | 'bytes'): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return as === 'json' ? await response.json() : Buffer.from(await response.arrayBuffer());
}

/** Resolves one spell id all the way to a cached file, or records the miss. */
async function fetchOne(spellId: number): Promise<void> {
  const map = await loadIndex();
  const tooltip = (await get(
    `https://nether.wowhead.com/tooltip/spell/${spellId}?dataEnv=1&locale=0`,
    'json',
  )) as { icon?: unknown; tooltip?: unknown } | null;
  (await loadDescriptions())[String(spellId)] = describe(tooltip?.tooltip);
  descriptionsDirty = true;
  const name = safeName(tooltip?.icon);
  if (name === null) {
    // A real answer with no icon in it: remember the miss so it is never asked
    // again. Network errors deliberately do not get here.
    map[String(spellId)] = null;
    indexDirty = true;
    return;
  }

  map[String(spellId)] = name;
  indexDirty = true;
  if ((await readCached(name)) !== null) return;

  const bytes = (await get(
    `https://wow.zamimg.com/images/wow/icons/medium/${name}.jpg`,
    'bytes',
  )) as Buffer;
  await writeFile(join(await store(), `${name}.jpg`), bytes);
  dataUrls.set(name, `data:image/jpeg;base64,${bytes.toString('base64')}`);
}

/**
 * Data URLs for whatever is known, keyed by spell id. Ids with no icon are
 * omitted rather than sent as null, so the renderer can treat the result as
 * "everything I can draw".
 */
export async function resolveIcons(spellIds: number[]): Promise<Record<number, string>> {
  const wanted = [...new Set(spellIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, 400);
  const map = await loadIndex();

  await fetchAll(offline() ? [] : wanted.filter((id) => !(String(id) in map)));

  const out: Record<number, string> = {};
  for (const id of wanted) {
    const name = map[String(id)];
    if (name === undefined || name === null) continue;
    const url = await readCached(name);
    if (url !== null) out[id] = url;
  }
  return out;
}

/** Runs `fetchOne` over the ids, four at a time, sharing jobs already in flight. */
async function fetchAll(spellIds: readonly number[]): Promise<void> {
  // A chunked worklist rather than Promise.all over everything: a long key can
  // carry a couple of hundred unseen spells and firing those at once is both
  // rude and slower than four at a time.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, spellIds.length) }, async () => {
      for (let i = next++; i < spellIds.length; i = next++) {
        const id = spellIds[i]!;
        let job = inflight.get(id);
        if (job === undefined) {
          job = fetchOne(id).catch(() => undefined);
          inflight.set(id, job);
        }
        await job;
        inflight.delete(id);
      }
    }),
  );
  await saveIndex();
  await saveDescriptions();
}

/**
 * Spell descriptions as plain text, keyed by spell id. Same contract as
 * `resolveIcons`: ids with nothing behind them are omitted, and offline this
 * is whatever is already on disk.
 */
export async function resolveDescriptions(spellIds: number[]): Promise<Record<number, string>> {
  const wanted = [...new Set(spellIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, 400);
  const known = await loadDescriptions();
  await fetchAll(offline() ? [] : wanted.filter((id) => !(String(id) in known)));

  const out: Record<number, string> = {};
  for (const id of wanted) {
    const text = known[String(id)];
    if (typeof text === 'string') out[id] = text;
  }
  return out;
}

/** Fetches one named icon to the store, or records the miss for this session. */
async function fetchNamed(name: string): Promise<void> {
  try {
    const bytes = (await get(
      `https://wow.zamimg.com/images/wow/icons/medium/${name}.jpg`,
      'bytes',
    )) as Buffer;
    await writeFile(join(await store(), `${name}.jpg`), bytes);
    dataUrls.set(name, `data:image/jpeg;base64,${bytes.toString('base64')}`);
  } catch {
    namedMisses.add(name);
  }
}

/**
 * Data URLs for icons asked for by texture name, keyed by that name.
 *
 * Same contract as `resolveIcons`: names with nothing behind them are omitted,
 * and the whole thing resolves to `{}` offline rather than rejecting.
 */
export async function resolveNamed(names: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(names)]
    .map((name) => safeName(name))
    .filter((name): name is string => name !== null)
    .slice(0, 200);

  const missing: string[] = [];
  for (const name of wanted) {
    if (namedMisses.has(name)) continue;
    if ((await readCached(name)) === null && !offline()) missing.push(name);
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
      for (let i = next++; i < missing.length; i = next++) {
        const name = missing[i]!;
        let job = namedInflight.get(name);
        if (job === undefined) {
          job = fetchNamed(name);
          namedInflight.set(name, job);
        }
        await job;
        namedInflight.delete(name);
      }
    }),
  );

  const out: Record<string, string> = {};
  for (const name of wanted) {
    const url = await readCached(name);
    if (url !== null) out[name] = url;
  }
  return out;
}

/**
 * Creature portraits, for the map's mob icons.
 *
 * Keyed by display id, the creature's model, which only MDT names: the log
 * carries a creature id and nothing about what it looks like. Wowhead renders
 * a thumbnail of every model, a 300px png of the whole creature on a clear
 * background, under a folder named for the id's low byte. The renderer crops
 * it to a face. Same rules as the icons: once per machine, offline means
 * whatever is on disk, and a miss is "no portrait", never an error.
 */
const portraitUrls = new Map<number, string>();
const portraitInflight = new Map<number, Promise<void>>();
/** Ids the CDN had nothing for, this session only, as for named icons. */
const portraitMisses = new Set<number>();

async function portraitStore(): Promise<string> {
  const folder = join(await store(), 'npc');
  await mkdir(folder, { recursive: true });
  return folder;
}

async function readPortrait(displayId: number): Promise<string | null> {
  const cached = portraitUrls.get(displayId);
  if (cached !== undefined) return cached;
  try {
    const bytes = await readFile(join(await portraitStore(), `${displayId}.png`));
    const url = `data:image/png;base64,${bytes.toString('base64')}`;
    portraitUrls.set(displayId, url);
    return url;
  } catch {
    return null;
  }
}

async function fetchPortrait(displayId: number): Promise<void> {
  try {
    const bytes = (await get(
      `https://wow.zamimg.com/modelviewer/live/webthumbs/npc/${displayId & 0xff}/${displayId}.png`,
      'bytes',
    )) as Buffer;
    await writeFile(join(await portraitStore(), `${displayId}.png`), bytes);
    portraitUrls.set(displayId, `data:image/png;base64,${bytes.toString('base64')}`);
  } catch {
    portraitMisses.add(displayId);
  }
}

/** Data URLs for creature portraits, keyed by display id, with misses omitted. */
export async function resolvePortraits(displayIds: number[]): Promise<Record<number, string>> {
  const wanted = [...new Set(displayIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, 200);

  const missing: number[] = [];
  for (const id of wanted) {
    if (portraitMisses.has(id)) continue;
    if ((await readPortrait(id)) === null && !offline()) missing.push(id);
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
      for (let i = next++; i < missing.length; i = next++) {
        const id = missing[i]!;
        let job = portraitInflight.get(id);
        if (job === undefined) {
          job = fetchPortrait(id);
          portraitInflight.set(id, job);
        }
        await job;
        portraitInflight.delete(id);
      }
    }),
  );

  const out: Record<number, string> = {};
  for (const id of wanted) {
    const url = await readPortrait(id);
    if (url !== null) out[id] = url;
  }
  return out;
}

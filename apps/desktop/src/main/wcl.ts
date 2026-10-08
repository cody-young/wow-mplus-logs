/**
 * Warcraft Logs parses for a finished key, when someone uploaded it.
 *
 * Signed in as the reader, never as us. The app is registered with Warcraft
 * Logs as a public client and uses the PKCE flow, so the only thing shipped is
 * a client id — which is not a secret — and every request spends the reader's
 * own token. There is no server of ours in the path and nothing to leak.
 *
 * Sign-in is a browser round trip: the system browser opens Warcraft Logs'
 * consent page, which redirects to a one-shot listener on a fixed loopback
 * port, and the code it carries is exchanged for a token here. The token is
 * written to userData through Electron's safeStorage, or held for the session
 * only where the platform has no keyring to encrypt it with.
 *
 * Finding the run is three queries, each one batched with aliases rather than
 * sent per player:
 *   1. Recent reports for each of the five players, plus the reader's own
 *      uploads, narrowed to the ones whose span covers the key.
 *   2. Those reports' fights, to find the one at this keystone level that
 *      began when the key did.
 *   3. That fight's dps and hps rankings.
 *
 * Like the icons, nothing here fails loudly: a parse is a badge beside a
 * number that stands on its own, so every failure is a status the panel can
 * show, never a thrown error.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { app, safeStorage, shell } from 'electron';

import type { WclParse, WclPlayerParses, WclRunQuery, WclRunResult, WclStatus } from '../shared.js';

/**
 * The id Warcraft Logs issued when the app was registered as a public client,
 * at https://www.warcraftlogs.com/api/clients. Public by design: PKCE has no
 * secret to go with it. The environment variable is for trying a client of
 * your own without a rebuild.
 */
const CLIENT_ID = process.env['MPLUS_WCL_CLIENT_ID'] ?? '01a1197a-d43c-7137-b940-1937bdc62a1c';

const SITE = 'https://www.warcraftlogs.com';
/** User tokens go to /user; /client is for the client-credentials flow we do not use. */
const API = `${SITE}/api/v2/user`;
/**
 * Fixed, because Warcraft Logs matches the redirect exactly against the one
 * registered. An IP rather than "localhost" so the browser cannot resolve it
 * to ::1 while we listen on IPv4.
 */
const CALLBACK_PORT = 47213;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

const TIMEOUT_MS = 10_000;
/** How long the consent page may sit open before the listener gives up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** Reports per player to look through. A key from today is near the top. */
const RECENT_REPORTS = 10;
/** Reports whose fights are fetched. The overlap filter leaves one or two. */
const MAX_CANDIDATES = 4;
/**
 * How far a fight's start may sit from the key's. Both are the same
 * CHALLENGE_MODE_START line, so this only absorbs rounding and a reader whose
 * log predates the UTC offset.
 */
const MATCH_SLACK_MS = 2 * 60_000;
/** A miss is asked again after this, since the upload may simply be late. */
const MISS_TTL_MS = 5 * 60_000;

interface Token {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  /** The Warcraft Logs user, for "your own uploads" and the panel. */
  userId: number | null;
  userName: string | null;
}

let token: Token | null = null;
let tokenLoaded: Promise<void> | null = null;
let signingIn: Promise<WclStatus> | null = null;
const results = new Map<string, { result: WclRunResult; at: number }>();
const inflight = new Map<string, Promise<WclRunResult>>();

function disabled(): boolean {
  return CLIENT_ID === '' || process.env['MPLUS_OFFLINE'] === '1';
}

function tokenPath(): string {
  return join(app.getPath('userData'), 'wcl-token.bin');
}

async function loadToken(): Promise<void> {
  tokenLoaded ??= (async () => {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const parsed: unknown = JSON.parse(safeStorage.decryptString(await readFile(tokenPath())));
      if (typeof parsed === 'object' && parsed !== null && typeof (parsed as Token).accessToken === 'string') {
        token = parsed as Token;
      }
    } catch {
      // Never signed in, or a token from another keyring. Signed out.
    }
  })();
  return tokenLoaded;
}

async function saveToken(next: Token | null): Promise<void> {
  token = next;
  try {
    if (next === null) await rm(tokenPath(), { force: true });
    else if (safeStorage.isEncryptionAvailable()) {
      await writeFile(tokenPath(), safeStorage.encryptString(JSON.stringify(next)));
    }
  } catch {
    // Held for this session; the reader signs in again next launch.
  }
}

export async function status(): Promise<WclStatus> {
  if (disabled()) return { available: false, signedIn: false, userName: null };
  await loadToken();
  return { available: true, signedIn: token !== null, userName: token?.userName ?? null };
}

export async function signOut(): Promise<WclStatus> {
  await saveToken(null);
  results.clear();
  return status();
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** Opens the consent page and resolves once the reader has answered it. */
export function signIn(): Promise<WclStatus> {
  if (disabled()) return status();
  signingIn ??= runSignIn().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

async function runSignIn(): Promise<WclStatus> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  let code: string;
  try {
    code = await awaitCallback(state, () => {
      const url = new URL(`${SITE}/oauth/authorize`);
      url.search = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();
      void shell.openExternal(url.toString());
    });
  } catch {
    return status();
  }

  const granted = await requestToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  if (granted === null) return status();
  await saveToken(granted);

  const me = await query<{ userData: { currentUser: { id: number; name: string } | null } }>(
    'query { userData { currentUser { id name } } }',
  );
  const user = me?.userData.currentUser ?? null;
  if (user !== null) await saveToken({ ...granted, userId: user.id, userName: user.name });
  results.clear();
  return status();
}

/**
 * Listens for the one redirect the consent page sends, then closes.
 *
 * `open` runs once the port is bound, so a browser that answers instantly
 * cannot arrive before anyone is listening.
 */
function awaitCallback(state: string, open: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null;
    const finish = (error: Error | null, code?: string): void => {
      clearTimeout(timer);
      server?.close();
      if (error !== null || code === undefined) reject(error ?? new Error('no code'));
      else resolve(code);
    };
    const timer = setTimeout(() => finish(new Error('timed out')), SIGN_IN_TIMEOUT_MS);

    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const ok = code !== null && url.searchParams.get('state') === state;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        ok
          ? '<p style="font-family:sans-serif">Signed in to Warcraft Logs. You can close this tab and return to M+ Logs.</p>'
          : '<p style="font-family:sans-serif">Sign-in was cancelled or did not match. Try again from M+ Logs.</p>',
      );
      finish(ok ? null : new Error('denied'), code ?? undefined);
    });
    server.on('error', (error) => finish(error));
    server.listen(CALLBACK_PORT, '127.0.0.1', open);
  });
}

async function requestToken(form: Record<string, string>): Promise<Token | null> {
  try {
    const response = await fetch(`${SITE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body['access_token'] !== 'string') return null;
    const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : 3600;
    return {
      accessToken: body['access_token'],
      refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null,
      expiresAt: Date.now() + expiresIn * 1000,
      userId: token?.userId ?? null,
      userName: token?.userName ?? null,
    };
  } catch {
    return null;
  }
}

/** A live token, refreshed if it can be, or null for "signed out". */
async function accessToken(): Promise<string | null> {
  await loadToken();
  if (token === null) return null;
  if (token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  const refreshed =
    token.refreshToken === null
      ? null
      : await requestToken({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: token.refreshToken });
  await saveToken(refreshed);
  return refreshed?.accessToken ?? null;
}

/**
 * One GraphQL request. Partial data is returned as is: a player Warcraft Logs
 * has never seen nulls their alias and adds an error, and that must not cost
 * the other four.
 */
async function query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  const bearer = await accessToken();
  if (bearer === null) return null;
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ query: text, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) {
      await saveToken(null);
      return null;
    }
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: T | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

interface PlayerRef {
  name: string;
  realm: string;
  region: string;
}

/**
 * "Marmin-Stormrage-US" into its parts. Split from the right, since the name
 * itself never has a dash and the region is always last.
 */
function playerRef(full: string): PlayerRef | null {
  const parts = full.split('-');
  if (parts.length < 3) return null;
  const region = parts.pop()!;
  const name = parts.shift()!;
  return { name, realm: parts.join('-'), region: region.toLowerCase() };
}

/**
 * The log's realm as Warcraft Logs' slug for it.
 *
 * The log writes the realm with its spaces taken out — "MoonGuard",
 * "Area52" — and the slug puts a dash back where each word began. Apostrophes
 * are dropped after the split, so "Mal'Ganis" stays one word. A realm whose
 * real name runs two capitalised words together with no space between them
 * comes out wrong; the reader's own uploads still find the key in that case.
 */
export function realmSlug(realm: string): string {
  return realm
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Za-z])/g, '$1-$2')
    .replace(/'/g, '')
    .toLowerCase();
}

interface ReportStub {
  code: string;
  startTime: number;
  endTime: number;
}

interface FightStub {
  id: number;
  startTime: number;
  keystoneLevel: number | null;
}

/** The renderer's query, checked before any of it goes into a request. */
function wellFormed(run: unknown): run is WclRunQuery {
  if (typeof run !== 'object' || run === null) return false;
  const r = run as Record<string, unknown>;
  const finite = (key: string): boolean => typeof r[key] === 'number' && Number.isFinite(r[key]);
  return (
    typeof r['runId'] === 'string' &&
    finite('keystoneLevel') && finite('startMs') && finite('endMs') && finite('utcOffsetMinutes') &&
    Array.isArray(r['party']) && r['party'].length <= 5 &&
    r['party'].every(
      (p: unknown) =>
        typeof p === 'object' && p !== null &&
        typeof (p as Record<string, unknown>)['actorIndex'] === 'number' &&
        typeof (p as Record<string, unknown>)['name'] === 'string',
    )
  );
}

/**
 * A found key is answered from memory for the session, and a miss for a few
 * minutes, so moving between keys costs nothing. `fresh` skips a remembered
 * miss: the renderer's backoff, and the reader's own "Check again", must
 * actually ask.
 */
export function parsesForRun(run: unknown, fresh = false): Promise<WclRunResult> {
  if (disabled() || !wellFormed(run)) return Promise.resolve({ status: 'unavailable' });
  const cached = results.get(run.runId);
  if (
    cached !== undefined &&
    (cached.result.status === 'found' || (!fresh && Date.now() - cached.at < MISS_TTL_MS))
  ) {
    return Promise.resolve(cached.result);
  }
  let pending = inflight.get(run.runId);
  if (pending === undefined) {
    pending = lookUp(run)
      .then((result) => {
        if (result.status !== 'signed-out') results.set(run.runId, { result, at: Date.now() });
        return result;
      })
      .finally(() => inflight.delete(run.runId));
    inflight.set(run.runId, pending);
  }
  return pending;
}

async function lookUp(run: WclRunQuery): Promise<WclRunResult> {
  if ((await accessToken()) === null) return { status: 'signed-out' };

  const offset = run.utcOffsetMinutes * 60_000;
  const start = run.startMs - offset;
  const end = run.endMs - offset;

  const reports = await candidateReports(run, start, end);
  if (reports === null) return { status: 'error' };

  const fights = await fightsOf(reports);
  if (fights === null) return { status: 'error' };
  let match: { code: string; fight: FightStub } | null = null;
  for (const { code, startTime, fights: list } of fights) {
    for (const fight of list) {
      if (fight.keystoneLevel !== run.keystoneLevel) continue;
      if (Math.abs(startTime + fight.startTime - start) > MATCH_SLACK_MS) continue;
      match = { code, fight };
      break;
    }
    if (match !== null) break;
  }
  if (match === null) return { status: 'not-found' };

  const url = `${SITE}/reports/${match.code}#fight=${match.fight.id}`;
  const ranked = await rankings(match.code, match.fight.id, run.party);
  if (ranked === null) return { status: 'error' };
  if (Object.keys(ranked).length === 0) return { status: 'unranked', url };
  return { status: 'found', url, players: ranked };
}

async function candidateReports(run: WclRunQuery, start: number, end: number): Promise<ReportStub[] | null> {
  const refs = run.party.map((player) => playerRef(player.name));
  const declarations: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};
  refs.forEach((ref, i) => {
    if (ref === null) return;
    declarations.push(`$n${i}: String!, $s${i}: String!, $r${i}: String!`);
    fields.push(
      `p${i}: character(name: $n${i}, serverSlug: $s${i}, serverRegion: $r${i}) { recentReports(limit: ${RECENT_REPORTS}) { data { code startTime endTime } } }`,
    );
    variables[`n${i}`] = ref.name;
    variables[`s${i}`] = realmSlug(ref.realm);
    variables[`r${i}`] = ref.region;
  });
  // The reader's own uploads, by time, which needs no realm slug at all.
  const own = token?.userId ?? null;
  if (own !== null) {
    declarations.push('$user: Int!, $from: Float!, $to: Float!');
    variables['user'] = own;
    variables['from'] = start - 6 * 3600_000;
    variables['to'] = end + 6 * 3600_000;
  }
  const text = `query(${declarations.join(', ')}) {
    characterData { ${fields.join('\n')} }
    ${own !== null ? 'reportData { reports(userID: $user, startTime: $from, endTime: $to, limit: 10) { data { code startTime endTime } } }' : ''}
  }`;

  type Page = { data: ReportStub[] } | null;
  const data = await query<{
    characterData: Record<string, { recentReports: Page } | null>;
    reportData?: { reports: Page };
  }>(text, variables);
  if (data === null) return null;

  const all = [
    ...(data.reportData?.reports?.data ?? []),
    ...Object.values(data.characterData ?? {}).flatMap((c) => c?.recentReports?.data ?? []),
  ];
  const seen = new Set<string>();
  return all
    .filter((report) => {
      if (seen.has(report.code)) return false;
      seen.add(report.code);
      // A live-logged report's end keeps moving, so only its start is held to
      // the key; anything that began after the key ended cannot hold it.
      return report.startTime <= start + MATCH_SLACK_MS && report.endTime >= start;
    })
    .slice(0, MAX_CANDIDATES);
}

async function fightsOf(
  reports: ReportStub[],
): Promise<Array<{ code: string; startTime: number; fights: FightStub[] }> | null> {
  if (reports.length === 0) return [];
  const variables: Record<string, unknown> = {};
  const fields = reports.map((report, i) => {
    variables[`c${i}`] = report.code;
    return `r${i}: report(code: $c${i}) { code startTime fights { id startTime keystoneLevel } }`;
  });
  const text = `query(${reports.map((_, i) => `$c${i}: String!`).join(', ')}) { reportData { ${fields.join('\n')} } }`;
  const data = await query<{
    reportData: Record<string, { code: string; startTime: number; fights: FightStub[] | null } | null>;
  }>(text, variables);
  if (data === null) return null;
  return Object.values(data.reportData ?? {}).flatMap((report) =>
    report === null ? [] : [{ code: report.code, startTime: report.startTime, fights: report.fights ?? [] }],
  );
}

/**
 * The fight's rankings, keyed by the actor index the renderer asked about.
 *
 * Warcraft Logs answers in a JSON scalar shaped by role — roles.tanks,
 * .healers, .dps, each with a characters list — and that shape is read
 * defensively, since the schema does not promise it.
 */
async function rankings(
  code: string,
  fightId: number,
  party: WclRunQuery['party'],
): Promise<Record<number, WclPlayerParses> | null> {
  const data = await query<{ reportData: { report: { dps: unknown; hps: unknown } | null } }>(
    `query($code: String!, $fight: [Int]!) { reportData { report(code: $code) {
      dps: rankings(fightIDs: $fight, playerMetric: dps)
      hps: rankings(fightIDs: $fight, playerMetric: hps)
    } } }`,
    { code, fight: [fightId] },
  );
  const report = data?.reportData.report;
  if (report === undefined || report === null) return null;

  const byName = new Map<string, number>();
  for (const player of party) {
    const ref = playerRef(player.name);
    byName.set((ref?.name ?? player.name).toLowerCase(), player.actorIndex);
  }

  const out: Record<number, WclPlayerParses> = {};
  for (const metric of ['dps', 'hps'] as const) {
    for (const entry of rankedCharacters(report[metric])) {
      const actorIndex = byName.get(entry.name.toLowerCase());
      if (actorIndex === undefined) continue;
      (out[actorIndex] ??= {})[metric] = entry.parse;
    }
  }
  return out;
}

function rankedCharacters(json: unknown): Array<{ name: string; parse: WclParse }> {
  const out: Array<{ name: string; parse: WclParse }> = [];
  const fights = (json as { data?: unknown })?.data;
  if (!Array.isArray(fights)) return out;
  for (const fight of fights) {
    const roles = (fight as { roles?: Record<string, { characters?: unknown }> })?.roles;
    if (roles === undefined || roles === null) continue;
    for (const role of Object.values(roles)) {
      if (!Array.isArray(role?.characters)) continue;
      for (const character of role.characters as Array<Record<string, unknown>>) {
        const name = character['name'];
        const rank = character['rankPercent'];
        if (typeof name !== 'string' || typeof rank !== 'number') continue;
        const bracket = character['bracketPercent'];
        out.push({
          name,
          parse: {
            rankPercent: rank,
            bracketPercent: typeof bracket === 'number' ? bracket : null,
            amount: typeof character['amount'] === 'number' ? character['amount'] : null,
          },
        });
      }
    }
  }
  return out;
}

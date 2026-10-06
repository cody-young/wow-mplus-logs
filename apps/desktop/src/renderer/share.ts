import {
  SegmentKind,
  combinedAvoidable,
  summarizeAvoidable,
  summarizeCrowdControl,
  summarizeDispels,
  summarizeInterrupts,
} from '@mplus/analysis';

import { clock, integer, percent, short } from './format.js';
import { shortName } from './specs.js';
import type {
  AvoidableReport,
  BreakdownReport,
  ControlReport,
  DeathReport,
  DispelReport,
  InterruptReport,
  RunForces,
  RunMeta,
  Segment,
} from '../shared.js';

/**
 * Every tab as plain text, for the copy button: something to paste into party
 * chat, Discord, or a note.
 *
 * Built from the same lists the tab is showing, for the same scope — the whole
 * key or the one pull selected — so what is copied is what is on screen.
 * Elitism Helper's end-of-dungeon report is the model: a heading line, then one
 * short numbered line per player, worst first.
 *
 * Every line is held under WoW's 255-character chat limit, so each pastes as
 * one message. The text carries no links or colour codes, which chat would
 * show as raw escapes.
 */

/** Past this, a list is a tail nobody reads in chat. */
const LINES = 10;

/** WoW refuses a chat message longer than this. */
const CHAT_LIMIT = 255;

export interface ShareScope {
  meta: RunMeta;
  /** The pull or boss selected, or null for the whole key. */
  segment: Segment | null;
}

function heading(title: string, scope: ShareScope): string {
  const key = `+${scope.meta.keystoneLevel} ${scope.meta.zoneName}`;
  return fit(`${title} — ${key}${scope.segment === null ? '' : `, ${scope.segment.label}`}`);
}

/** Trims a line to the chat limit at a word, marking the cut. */
function fit(line: string): string {
  if (line.length <= CHAT_LIMIT) return line;
  const cut = line.lastIndexOf(' ', CHAT_LIMIT - 1);
  return `${line.slice(0, cut > 0 ? cut : CHAT_LIMIT - 1)}…`;
}

/**
 * A ranked line with as many trailing details as fit.
 *
 * The details — a player's worst abilities — are dropped from the end rather
 * than the whole line cut mid-word, so what survives the limit still reads.
 */
function ranked(rank: number, body: string, details: readonly string[] = []): string {
  let line = `${rank}. ${body}`;
  for (const [index, detail] of details.entries()) {
    const next = `${line}${index === 0 ? ': ' : ', '}${detail}`;
    if (next.length > CHAT_LIMIT) break;
    line = next;
  }
  return fit(line);
}

function join(lines: readonly string[]): string {
  return lines.join('\n');
}

export function shareBreakdown(
  report: BreakdownReport,
  mode: 'done' | 'taken' | 'healing',
  scope: ShareScope,
): string {
  const title = mode === 'done' ? 'Damage done' : mode === 'taken' ? 'Damage taken' : 'Healing';
  const rate = mode === 'done' ? 'dps' : mode === 'taken' ? 'dtps' : 'hps';
  const lines = [heading(title, scope)];
  const actors = report.actors.filter((actor) => actor.total > 0).slice(0, LINES);
  if (actors.length === 0) lines.push('Nothing recorded.');
  for (const [index, actor] of actors.entries()) {
    lines.push(
      ranked(
        index + 1,
        `${shortName(actor.name)} ${short(actor.total)} (${short(actor.perSecond)} ${rate}, ${percent(actor.share)})`,
      ),
    );
  }
  return join(lines);
}

export function shareInterrupts(report: InterruptReport, scope: ShareScope): string {
  const summary = summarizeInterrupts(report.attempts, report.stops);
  const lines = [heading('Interrupts', scope)];
  if (summary.casts === 0 && summary.stops === 0) lines.push('No interrupts.');
  for (const [index, actor] of summary.actors.slice(0, LINES).entries()) {
    // Stops and presses rather than a rate: an area interrupt can stop more
    // casts than it took presses.
    lines.push(
      ranked(
        index + 1,
        `${shortName(actor.name)} ${actor.stops} stopped, ${actor.casts} pressed` +
          (actor.whiffs > 0 ? ` (${actor.whiffs} hit nothing)` : ''),
      ),
    );
  }
  return join(lines);
}

export function shareControl(report: ControlReport, scope: ShareScope): string {
  const summary = summarizeCrowdControl(report.applications);
  const lines = [heading('Crowd control', scope)];
  if (summary.casts === 0) lines.push('No crowd control.');
  for (const [index, actor] of summary.actors.slice(0, LINES).entries()) {
    lines.push(
      ranked(
        index + 1,
        `${shortName(actor.name)} ${actor.casts} casts on ${actor.targets} targets, ${(actor.ms / 1000).toFixed(0)}s held`,
        actor.abilities.slice(0, 3).map((ability) => `${ability.name} ×${ability.casts}`),
      ),
    );
  }
  return join(lines);
}

export function shareDispels(report: DispelReport, scope: ShareScope): string {
  const summary = summarizeDispels(report.dispels);
  const lines = [heading('Dispels', scope)];
  if (summary.removed === 0) lines.push('Nothing dispelled.');
  for (const [index, actor] of summary.actors.slice(0, LINES).entries()) {
    const kinds = [
      actor.byKind.purge > 0 ? `${actor.byKind.purge} purged` : '',
      actor.byKind.soothe > 0 ? `${actor.byKind.soothe} soothed` : '',
      actor.byKind.cleanse > 0 ? `${actor.byKind.cleanse} cleansed` : '',
    ].filter((part) => part !== '');
    lines.push(ranked(index + 1, `${shortName(actor.name)} ${actor.removed} removed (${kinds.join(', ')})`));
  }
  return join(lines);
}

export function shareDeaths(deaths: readonly DeathReport[], scope: ShareScope): string {
  const lines = [heading(`Deaths (${deaths.length})`, scope)];
  if (deaths.length === 0) lines.push('Nobody died.');
  // Newest first, like every list in the app.
  for (const death of [...deaths].reverse().slice(0, LINES)) {
    const blow = death.killingBlow;
    const cause =
      blow === null
        ? 'cause unknown'
        : `${blow.spellName} ${short(blow.amount)}${blow.sourceName === '' ? '' : ` from ${blow.sourceName}`}`;
    lines.push(fit(`${clock(death.ts)} ${shortName(death.name)} — ${cause}`));
  }
  if (deaths.length > LINES) lines.push(`…and ${deaths.length - LINES} earlier.`);
  return join(lines);
}

export function shareAvoidable(report: AvoidableReport, scope: ShareScope): string {
  const summary = summarizeAvoidable(report.hits);
  const lines = [heading('Avoidable damage', scope)];
  if (!report.covered) {
    lines.push('This dungeon is not on the avoidable list, so nothing here was checked.');
    return join(lines);
  }
  if (summary.hits === 0) lines.push('No avoidable damage taken.');
  for (const [index, actor] of summary.actors.slice(0, LINES).entries()) {
    const died = actor.deaths > 0 ? `, died to it ${actor.deaths === 1 ? 'once' : `${actor.deaths}×`}` : '';
    lines.push(
      ranked(
        index + 1,
        `${shortName(actor.name)} ${short(actor.amount)} (${actor.hits} ${actor.hits === 1 ? 'hit' : 'hits'}${died})`,
        actor.abilities.map((ability) => `${ability.name} ${short(ability.amount)}`),
      ),
    );
  }
  return join(lines);
}

/** In development: every side of the avoidable comparison, player by player. */
export function shareAvoidableCompare(report: AvoidableReport, scope: ShareScope): string {
  const ours = summarizeAvoidable(report.hits);
  const theirs = summarizeAvoidable(report.blizzard);
  const combined = summarizeAvoidable(combinedAvoidable(report));
  const lines = [
    heading('Avoidable, ours vs Blizzard', scope),
    fit(
      `Ours ${report.covered ? `${short(ours.amount)} (${ours.hits} hits)` : 'not on the list'}, ` +
        `Blizzard ${short(theirs.amount)} (${theirs.hits} hits), ` +
        `combined ${short(combined.amount)} (${combined.hits} hits)`,
    ),
  ];
  const amountOf = (summary: typeof ours, index: number): number =>
    summary.actors.find((actor) => actor.actorIndex === index)?.amount ?? 0;
  // Combined holds every player either other side does, worst first.
  for (const [rank, actor] of combined.actors.slice(0, LINES).entries()) {
    lines.push(
      ranked(
        rank + 1,
        `${shortName(actor.name)} ours ${short(amountOf(ours, actor.actorIndex))}, ` +
          `Blizzard ${short(amountOf(theirs, actor.actorIndex))}, combined ${short(actor.amount)}`,
      ),
    );
  }
  return join(lines);
}

/**
 * The route: each pull with its size, its share of the count and when it
 * started. Newest first like every list here; the pull numbers keep the order.
 */
export function shareRoute(segments: readonly Segment[], forces: RunForces, scope: ShareScope): string {
  const shown = scope.segment === null ? segments : segments.filter((segment) => segment.id === scope.segment!.id);
  const ordered = [...shown].sort((a, b) => a.startTs - b.startTs);
  const lines = [heading(`Route (${ordered.filter((segment) => segment.kind === SegmentKind.PULL).length} pulls)`, scope)];
  for (const segment of ordered.reverse().slice(0, LINES)) {
    const name = segment.kind === SegmentKind.BOSS ? `Boss: ${segment.label}` : `${segment.pullNumber}. ${segment.label}`;
    const mobs = `${integer(segment.enemies.length)} ${segment.enemies.length === 1 ? 'mob' : 'mobs'}`;
    const count = forces.known && segment.forces > 0 ? ` · ${percent(segment.forces / forces.required)}` : '';
    lines.push(fit(`${clock(segment.startTs)} ${name} — ${mobs}${count}`));
  }
  if (ordered.length > LINES) lines.push(`…and ${ordered.length - LINES} earlier.`);
  return join(lines);
}

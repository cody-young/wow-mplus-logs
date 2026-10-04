import type { LogSession, Run, StringInterner } from '@mplus/parser';

/**
 * What an analysis needs beyond the event store.
 *
 * The store holds interned ids, not text, and the string table and spell-name
 * map live on the parser rather than the run (they are shared across every run
 * in a file). Bundling them keeps every report function to one argument
 * instead of four.
 */
export interface AnalysisContext {
  run: Run;
  interner: StringInterner;
  /** spellId -> interned name id */
  spellNames: ReadonlyMap<number, number>;
}

export function contextFor(session: LogSession, run: Run): AnalysisContext {
  return { run, interner: session.parser.interner, spellNames: session.parser.spellNames };
}

export function actorName(context: AnalysisContext, actorIndex: number): string {
  const actor = context.run.actors.at(actorIndex);
  return actor === undefined ? '(unknown)' : context.interner.resolve(actor.nameId);
}

export function spellName(context: AnalysisContext, spellId: number): string {
  if (spellId === 0) return 'Melee';
  const nameId = context.spellNames.get(spellId);
  return nameId === undefined ? `Spell ${spellId}` : context.interner.resolve(nameId);
}

/**
 * The ability a spell name belongs to, which is not always the name itself.
 *
 * The game logs one button under several ids and several names. A dual-wield
 * spec's Stormstrike lands as "Stormstrike" and "Stormstrike Off-Hand"; a
 * talent that changes an ability in place gets a parenthetical — "Crash
 * Lightning (Unleashed)", "Eviscerate (Coup de Grace)", "Rejuvenation
 * (Germination)", "Fatebound Coin (Heads)". Left apart, an enhancement
 * shaman's largest ability appears as three middling rows and the top line of
 * their table is the wrong spell.
 *
 * Only those two suffixes are stripped, and only from the end. A name that
 * says something else — "Chain Lightning Overload" — keeps its own row,
 * because nothing in it claims to be the same button.
 *
 * This deliberately merges a little more than Warcraft Logs does. They keep
 * 211094 apart from 188443 and relabel it "Chain Lightning (Ride the
 * Lightning)", which the combat log gives no way to know: it calls both of
 * them "Chain Lightning". Ours become one row, with the pieces underneath.
 */
export function abilityName(name: string): string {
  let out = name;
  // Twice, so a name carrying both suffixes collapses the whole way.
  for (let pass = 0; pass < 2; pass++) {
    if (out.endsWith(')')) {
      const open = out.lastIndexOf(' (');
      // `> 0`, so a name that is nothing but a parenthetical keeps itself.
      if (open > 0) {
        out = out.slice(0, open);
        continue;
      }
    }
    if (out.endsWith(OFF_HAND)) {
      out = out.slice(0, -OFF_HAND.length);
      continue;
    }
    break;
  }
  return out;
}

const OFF_HAND = ' Off-Hand';

/**
 * How long the run took in real time, in ms: the denominator of every rate.
 *
 * Not `meta.totalTimeMs`. That is the keystone timer, and the timer charges
 * 15 seconds for each death — time in which, by definition, no damage was
 * dealt. On a +12 Den of Nalorakk with seven deaths the timer read 97 seconds
 * longer than the key lasted, and dividing by it reported every player 7%
 * below their Warcraft Logs DPS at once.
 *
 * A run still in progress has no end yet, so its last event stands in for one.
 */
export function elapsedMs(run: Run): number {
  if (run.meta.elapsedMs !== null) return run.meta.elapsedMs;
  const last = run.store.count > 0 ? run.store.ts[run.store.count - 1] : undefined;
  return last ?? run.meta.totalTimeMs ?? 0;
}

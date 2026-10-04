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

import { Ev } from '@mplus/parser';

/**
 * Which event codes count as damage, and the one trap in doing so.
 *
 * SWING_DAMAGE and SWING_DAMAGE_LANDED are the same hits reported from either
 * side — measured on a real log their totals agree within 3% — so summing both
 * double-counts all melee. Totals use SWING_DAMAGE; SWING_DAMAGE_LANDED is
 * useful only to death analysis, where its advanced block describes the victim
 * and therefore carries the victim's health.
 */
export const DAMAGE_CODES: ReadonlySet<number> = new Set<number>([
  Ev.SPELL_DAMAGE,
  Ev.SPELL_PERIODIC_DAMAGE,
  Ev.SPELL_BUILDING_DAMAGE,
  Ev.RANGE_DAMAGE,
  Ev.SWING_DAMAGE,
  Ev.DAMAGE_SHIELD,
  Ev.DAMAGE_SPLIT,
]);

/** Damage a player can take that no hostile unit dealt. */
export const SELF_DAMAGE_CODES: ReadonlySet<number> = new Set<number>([Ev.ENVIRONMENTAL_DAMAGE]);

/** Melee from the victim's perspective. Health traces only — never totals. */
export const VICTIM_MELEE_CODES: ReadonlySet<number> = new Set<number>([Ev.SWING_DAMAGE_LANDED]);

export const HEAL_CODES: ReadonlySet<number> = new Set<number>([Ev.SPELL_HEAL, Ev.SPELL_PERIODIC_HEAL]);

/**
 * Effective amount.
 *
 * Both damage and healing write the gross figure in `amount` and the wasted
 * part in `waste` — overkill for damage, overhealing for healing. Confirmed on
 * a real log: 10,838 heals had amount exactly equal to overhealing (a fully
 * wasted heal) and none had amount 0 with overhealing above it, so `amount`
 * is inclusive in both cases. Overkill writes -1 when nothing was wasted,
 * which must not be added back as a credit.
 */
export function effective(amount: number, waste: number): number {
  return waste > 0 ? amount - waste : amount;
}

export function wasted(waste: number): number {
  return waste > 0 ? waste : 0;
}

import { Ev, EvFlag, type Run } from '@mplus/parser';

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

/**
 * Fully or partly absorbed hits, which damage done has to count and damage
 * taken must not.
 *
 * A shield on an enemy does not make the hit stop happening: the swing landed,
 * the shield ate it, and the player still produced that output. Warcraft Logs
 * counts it, and leaving it out put every damage dealer on a real +12 short by
 * 0.4-0.8% — Snuggay 289.6M against 291.8M — while barely moving the healer,
 * because the gap tracks how much you hit shielded enemies.
 *
 * Healing reads the same rows from the other side: damage a shield stopped is
 * healing by whoever cast the shield, which is how Warcraft Logs counts it and
 * the only way a blood death knight's Blood Shield or a warlock's Soul Leech
 * appears at all. On the same +12 that was 44.7M of the tank's 125.5M.
 *
 * Kept out of DAMAGE_CODES and HEAL_CODES deliberately. Segmentation and death
 * traces also read those sets, and for them an absorbed hit is not damage: it
 * dealt none, and counting it as damage taken would contradict the absorb
 * figure a death already reports alongside it.
 *
 * No double counting: a partial absorb logs SPELL_ABSORBED for the shielded
 * part and a separate damage event for the rest, and `amount` on the damage
 * event is already net of the absorb.
 */
export const ABSORBED_CODES: ReadonlySet<number> = new Set<number>([Ev.SPELL_ABSORBED]);

/**
 * Absorbs that defer damage rather than prevent it: nobody's healing, and no
 * protection in a death recap.
 *
 * A brewmaster's Stagger is logged as a SPELL_ABSORBED like any shield, but
 * what it soaks comes back a moment later as a Stagger tick (124255) the monk
 * takes in full. Counting the soak as healing credited a real brewmaster
 * with 198.0M on a key where 129.2M of it was Stagger, which put the tank
 * above the healer for damage they then took anyway.
 */
export const DEFERRED_ABSORBS: ReadonlySet<number> = new Set<number>([115069]);

/** Damage a player can take that no hostile unit dealt. */
export const SELF_DAMAGE_CODES: ReadonlySet<number> = new Set<number>([Ev.ENVIRONMENTAL_DAMAGE]);

/** Melee from the victim's perspective. Health traces only — never totals. */
export const VICTIM_MELEE_CODES: ReadonlySet<number> = new Set<number>([Ev.SWING_DAMAGE_LANDED]);

export const HEAL_CODES: ReadonlySet<number> = new Set<number>([Ev.SPELL_HEAL, Ev.SPELL_PERIODIC_HEAL]);

/**
 * Attempts to hit, for the denominator of a miss rate.
 *
 * Kept out of DAMAGE_CODES because a miss has no amount: it adds nothing to a
 * total and exists only so "90 hits" can be read as 90 attempts or as 900.
 * Only the rows flagged `AVOIDED` count — see that flag for why an absorbed or
 * blocked hit is logged as a miss and must not be counted as one.
 */
export const MISS_CODES: ReadonlySet<number> = new Set<number>([
  Ev.SWING_MISSED,
  Ev.RANGE_MISSED,
  Ev.SPELL_MISSED,
  Ev.SPELL_PERIODIC_MISSED,
  Ev.DAMAGE_SHIELD_MISSED,
]);

/**
 * Aura events after which the aura is up, for uptime.
 *
 * REFRESH and both DOSE events belong here and not with the removals: a dose
 * coming off a stack of five leaves four, and the debuff is still on the
 * target. Only SPELL_AURA_REMOVED takes the last one away.
 */
export const AURA_UP_CODES: ReadonlySet<number> = new Set<number>([
  Ev.SPELL_AURA_APPLIED,
  Ev.SPELL_AURA_REFRESH,
  Ev.SPELL_AURA_APPLIED_DOSE,
  Ev.SPELL_AURA_REMOVED_DOSE,
]);

/** Aura events after which the aura is gone. */
export const AURA_DOWN_CODES: ReadonlySet<number> = new Set<number>([
  Ev.SPELL_AURA_REMOVED,
  Ev.SPELL_AURA_BROKEN,
  Ev.SPELL_AURA_BROKEN_SPELL,
]);

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

/**
 * Whose amount an event's is: the source, or the owner when a pet dealt it.
 *
 * One ability breaks that rule. A row twinned with a `_SUPPORT` copy belongs
 * to the supporter named on it, not to the actor the log put in the source
 * field. A Scalecommander Devastation Evoker's Bombardments is logged against
 * whichever party member's hit set the bomb off — on a real +17 that put 12.8M
 * of a 17.0M ability into four other players' tables, and the rows naming a
 * mage's Mirror Image or a death knight's ghoul as the dealer rolled it up to
 * them from there. Breath of Eons, Fate Mirror and Inferno's Blessing are the
 * same shape.
 *
 * Augmentation's Ebon Might is deliberately untouched by this: those rows are
 * never twinned, because they are a slice of the ally's own hit rather than
 * the evoker's own ability. See EvFlag.SUPPORT_TWIN.
 */
export function creditedActor(run: Run, row: number): number {
  const { store, actors } = run;
  if ((store.flags[row]! & EvFlag.SUPPORT_TWIN) !== 0) {
    const supporter = store.support.get(row);
    if (supporter !== undefined) return actors.attribute(supporter);
  }
  return actors.attribute(store.srcActor[row]!);
}

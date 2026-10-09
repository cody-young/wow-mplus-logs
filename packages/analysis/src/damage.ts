import { Ev, EvFlag } from '@mplus/parser';

import { abilityName, actorName, elapsedMs, spellName, type AnalysisContext } from './context.js';
import {
  ABSORBED_CODES,
  AURA_DOWN_CODES,
  AURA_UP_CODES,
  DAMAGE_CODES,
  HEAL_CODES,
  MISS_CODES,
  SELF_DAMAGE_CODES,
  creditedActor,
  effective,
  wasted,
} from './events.js';
import { SegmentKind, type SegmentIndex } from './segments.js';

/**
 * Damage and healing breakdowns, overall or for one segment.
 *
 * Two attribution rules do the real work here.
 *
 * Pets roll up to their owner, so a Wild Imp's damage lands on the warlock.
 *
 * _SUPPORT events are excluded from totals. They are not extra damage: the
 * copy repeats damage the log already reported, and summing both would inflate
 * every total. What the copy adds is a name — who enabled the hit — and there
 * are two quite different reasons it might be there.
 *
 * Augmentation's Ebon Might, Prescience and Shifting Sands are a slice of the
 * ally's own hit, which that ally's plain rows already contain. By default the
 * slice is moved to the evoker, ability by ability: the evoker's table gains a
 * row for the buff, the ally's loses that much of the ability the slice rode
 * in on, and the run total is unchanged. That is how Warcraft Logs reports an
 * aug, and the only way one reads as a player rather than a bystander — on a
 * real raid of 464.6M it was 14.2M, three quarters of the evoker's own column.
 * `creditSupport: false` gives the log's own arithmetic instead, where the
 * buffed player keeps every point and the evoker is only named beside it.
 *
 * A Scalecommander Devastation Evoker's Bombardments is not that. It is the
 * evoker's own bomb, and the log credits whichever party member's hit set it
 * off: an ordinary SPELL_DAMAGE under spell 434481 against a mage, a rogue,
 * even a death knight's ghoul, with the _SUPPORT copy on the next line naming
 * the evoker. On a real +17 that put 12.8M of a 17.0M ability into four other
 * players' tables, for a talent nobody but the evoker brought. The parser
 * pairs those two lines and flags both (EvFlag.SUPPORT_TWIN); `creditedActor`
 * then files the damage under the evoker, and the copy is skipped outright
 * rather than counted as aid — the damage is theirs, not lent.
 */

export type Direction = 'done' | 'taken';

export interface SpellBreakdown {
  spellId: number;
  name: string;
  /** Effective amount, net of overkill or overhealing. */
  total: number;
  /** Gross amount as logged. */
  raw: number;
  wasted: number;
  hits: number;
  crits: number;
  /** Effective amount the crits among those hits accounted for. */
  critTotal: number;
  /** Periodic ticks, counted within `hits`. */
  ticks: number;
  /**
   * Times the ability was cast successfully, which hits cannot stand in for:
   * one cast of a DoT is a dozen ticks and one cleave is five hits. Zero for
   * damage taken, where the casts belong to the enemy, not to the victim.
   */
  casts: number;
  /**
   * Attempts that landed on nothing — missed, dodged, parried, immune. Absorbs
   * and blocks are excluded: the log reports those as misses too, but the blow
   * connected and its damage is counted elsewhere.
   */
  misses: number;
  /**
   * Milliseconds the ability's aura was up on at least one target, within the
   * report's window.
   *
   * A union rather than a sum, so a DoT on five targets reads as uptime and
   * not as 500%. Two limits worth knowing: an aura already up when the window
   * opened is only counted from the next time the log mentions it, because
   * nothing in the window says when it went on; and a merged row takes the
   * largest of its parts rather than their total, since the ids of one button
   * are variants of the same aura and adding them would exceed the fight.
   */
  uptimeMs: number;
  max: number;
  /** Largest single contributor, for damage taken. */
  topSourceName: string;
  /**
   * The individual spell ids this row merged, biggest first — absent unless
   * it merged more than one. See `abilityName` for what counts as the same
   * ability, and expect a row to have parts whenever a talent gave the button
   * a second id.
   */
  parts?: SpellBreakdown[];
}

export interface ActorBreakdown {
  actorIndex: number;
  name: string;
  specId: number;
  total: number;
  raw: number;
  wasted: number;
  /**
   * Damage this actor enabled for others, whether or not it was moved to them.
   *
   * Credit as the log reports it, so it is unaffected by `creditSupport` and
   * can exceed what the move was able to pay — a slice of a swing the game
   * wrote only from the victim's side is owed by a column that holds nothing.
   * See `settleSupport`.
   */
  supportGiven: number;
  /** How much of this actor's damage a supporter is credited for. */
  supportReceived: number;
  perSecond: number;
  /** Fraction of the report total, 0..1. */
  share: number;
  /** Ms of the window the actor was active, by Warcraft Logs' rule. See `ACTIVE_GAP_MS`. */
  activeMs: number;
  spells: SpellBreakdown[];
}

export interface BreakdownReport {
  label: string;
  actors: ActorBreakdown[];
  total: number;
  wasted: number;
  durationMs: number;
  /** Amount whose hostile side could not be identified (environment, etc). */
  unattributed: number;
}

export interface BreakdownOptions {
  /** Restrict to one segment. Omit for the whole run. */
  segmentId?: number;
  direction?: Direction;
  /**
   * Move _SUPPORT amounts from the player who dealt them to the Augmentation
   * Evoker who enabled them. On by default, which is how Warcraft Logs reports
   * an aug and the only way one reads as anything but zero. Set false for the
   * log's own arithmetic, where the buffed player keeps every point.
   */
  creditSupport?: boolean;
}

interface SpellAcc {
  spellId: number;
  total: number;
  raw: number;
  wasted: number;
  hits: number;
  crits: number;
  critTotal: number;
  ticks: number;
  max: number;
  sources: Map<number, number>;
}

/**
 * One ability's aura, mid-scan.
 *
 * `on` is the set of targets currently carrying it and `since` the instant the
 * set last became non-empty, which together give the union of its intervals in
 * one pass: a DoT ticking on five enemies is up once, not five times.
 */
interface AuraAcc {
  on: Set<number>;
  since: number;
  ms: number;
}

interface ActorAcc {
  actorIndex: number;
  total: number;
  raw: number;
  wasted: number;
  supportGiven: number;
  supportReceived: number;
  spells: Map<number, SpellAcc>;
  /** Spell id -> successful casts. Kept apart from `spells`, which is amounts. */
  casts: Map<number, number>;
  /**
   * Spell id -> avoided attempts, and spell id -> aura uptime.
   *
   * Kept out of `spells` for the same reason as `casts`: a row is created by
   * damage, and these events are not damage. An ability that only ever missed
   * is worth a row, but a taunt, a slow or a crowd control is not, and every
   * one of those applies an aura. Merged in at build time, where ids with no
   * amount behind them are simply dropped.
   */
  misses: Map<number, number>;
  auras: Map<number, AuraAcc>;
  activeMs: number;
  /** The last row counted for this actor, for `activeMs`. */
  lastTs: number;
}

/**
 * Active time, the way Warcraft Logs counts it: the gaps between an actor's
 * consecutive rows in the table, summed, leaving out any gap longer than this.
 *
 * Nothing about casting or the global cooldown. A row alone in its window
 * counts nothing, and two hits nine seconds apart count nine seconds. Checked
 * against Warcraft Logs' own figures by asking it for tiny windows and single
 * abilities, then for 50 player-keys of eleven uploaded +12s: on the damage
 * and healing tables both, it is this, to the millisecond. So a column of
 * Active % reads the same here as there, and means the same: the share of the
 * key the player never went ten seconds without doing anything that table
 * counts.
 */
const ACTIVE_GAP_MS = 10_000;

function touch(acc: ActorAcc, ts: number): void {
  if (ts - acc.lastTs <= ACTIVE_GAP_MS) acc.activeMs += ts - acc.lastTs;
  acc.lastTs = ts;
}

/**
 * One ability's worth of support, from one dealer to one supporter.
 *
 * Aggregated rather than applied row by row so that the cap in
 * `settleSupport` is applied to the ability as a whole: taking the slices off
 * one at a time would stop partway through and leave the rest where it was,
 * which reads as the evoker having been paid for some hits of Kill Command and
 * not others.
 */
interface SupportMove {
  dealer: number;
  /** The ally's ability the slice was part of, 0 for melee. */
  carrier: number;
  to: number;
  /** The supporter's own spell: Ebon Might, Shifting Sands, Prescience. */
  spellId: number;
  net: number;
  raw: number;
  hits: number;
  crits: number;
  critTotal: number;
  ticks: number;
  max: number;
}

/**
 * Pays the supporter what the dealer's ability can cover, and no more.
 *
 * The slice moves off the ability it rode in on: the ally's hit is unchanged —
 * it landed, and for what the log says — but the part of it the evoker bought
 * now sits in the evoker's column, and leaving it in both would add an aug's
 * whole output to the run twice over.
 *
 * Capped at what that ability holds, which is not a formality. A pet's swing
 * is written to the log only from the victim's side on most hits — 23,515
 * SWING_DAMAGE_LANDED against 4,818 SWING_DAMAGE for one raid's Lesser Ghouls
 * — and totals read the attacker's side, so a ghoul can owe melee it was never
 * credited with. Uncapped, the evoker would be paid out of a column that does
 * not contain it: 6M invented across 2,132 of that log's pets, a negative
 * Melee row on each. Capped, the evoker is short only what the report never
 * counted in the first place, and the run total is conserved exactly.
 */
function settleSupport(
  moves: ReadonlyMap<string, SupportMove>,
  accs: ReadonlyMap<number, ActorAcc>,
  accFor: (index: number) => ActorAcc,
  spellFor: (acc: ActorAcc, spellId: number) => SpellAcc,
): void {
  /** dealer|ability -> what is left of it to pay out of. */
  const room = new Map<string, number>();
  for (const move of moves.values()) {
    const key = `${move.dealer}|${move.carrier}`;
    if (room.has(key)) continue;
    const held = accs.get(move.dealer)?.spells.get(move.carrier)?.total ?? 0;
    room.set(key, Math.max(held, 0));
  }

  for (const move of moves.values()) {
    if (move.net <= 0) continue;
    const key = `${move.dealer}|${move.carrier}`;
    const left = room.get(key) ?? 0;
    if (left <= 0) continue;
    const net = Math.min(move.net, left);
    const share = net / move.net;
    const raw = move.raw * share;
    room.set(key, left - net);

    const from = accs.get(move.dealer);
    const carrier = from?.spells.get(move.carrier);
    if (from === undefined || carrier === undefined) continue;
    from.total -= net;
    from.raw -= raw;
    carrier.total -= net;
    carrier.raw -= raw;

    const gain = accFor(move.to);
    gain.total += net;
    gain.raw += raw;
    const given = spellFor(gain, move.spellId);
    given.total += net;
    given.raw += raw;
    given.hits += move.hits;
    given.crits += move.crits;
    given.critTotal += move.critTotal * share;
    given.ticks += move.ticks;
    if (move.max > given.max) given.max = move.max;
  }
}

export function damageReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: BreakdownOptions = {},
): BreakdownReport {
  return build(context, segments, options, 'damage');
}

export function healingReport(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: BreakdownOptions = {},
): BreakdownReport {
  return build(context, segments, options, 'healing');
}

function build(
  context: AnalysisContext,
  segments: SegmentIndex,
  options: BreakdownOptions,
  mode: 'damage' | 'healing',
): BreakdownReport {
  const { run } = context;
  const { store, actors } = run;
  const direction = options.direction ?? 'done';
  const creditSupport = options.creditSupport ?? true;
  const segmentId = options.segmentId;
  const segment = segmentId === undefined ? undefined : segments.get(segmentId);

  const codes = mode === 'healing' ? HEAL_CODES : DAMAGE_CODES;
  const accs = new Map<number, ActorAcc>();
  /** Party member -> spell id -> damage it did to the party. See the loop. */
  const friendlyFire = new Map<number, Map<number, number>>();
  /**
   * Support amounts waiting to be moved, keyed dealer|ability|supporter|spell.
   *
   * Settled after the scan rather than at the row, for two reasons. The
   * ability the slice rode in on has to exist before anything can be taken
   * off it — and a support row names the supporter's spell, not the ally's, so
   * the ability is `extraSpellId`, where the parser puts what the log left to
   * the line above. And the transfer has to be capped by what that ability
   * actually holds, which only the finished scan knows. See `settleSupport`.
   */
  const supportMoves = new Map<string, SupportMove>();
  let unattributed = 0;

  const accFor = (index: number): ActorAcc => {
    let acc = accs.get(index);
    if (acc === undefined) {
      acc = {
        actorIndex: index,
        total: 0,
        raw: 0,
        wasted: 0,
        supportGiven: 0,
        supportReceived: 0,
        spells: new Map(),
        casts: new Map(),
        misses: new Map(),
        auras: new Map(),
        activeMs: 0,
        lastTs: -Infinity,
      };
      accs.set(index, acc);
    }
    return acc;
  };

  const spellFor = (acc: ActorAcc, spellId: number): SpellAcc => {
    let spell = acc.spells.get(spellId);
    if (spell === undefined) {
      spell = {
        spellId,
        total: 0,
        raw: 0,
        wasted: 0,
        hits: 0,
        crits: 0,
        critTotal: 0,
        ticks: 0,
        max: 0,
        sources: new Map(),
      };
      acc.spells.set(spellId, spell);
    }
    return spell;
  };

  /**
   * One successful cast by a party member.
   *
   * Filed by time rather than by enemy, like healing: a cast names no target
   * in the log at all, so `segmentOf` has nothing to go on. Only the caster's
   * own casts are counted — a pet's are its own presses, not the owner's — and
   * only for `done`, because on `taken` the casts belong to the enemy.
   */
  const tallyCast = (row: number): void => {
    const caster = store.srcActor[row]!;
    if (!segments.party.has(caster)) return;
    if (segment !== undefined) {
      const ts = store.ts[row]!;
      if (ts < segment.startTs || ts > segment.endTs) return;
    }
    const casts = accFor(caster).casts;
    const spellId = store.spellId[row]!;
    casts.set(spellId, (casts.get(spellId) ?? 0) + 1);
  };

  /**
   * The report's window, hoisted above the scan because uptime needs it there:
   * an aura still up when the window closes has to be charged to its end, and
   * only the scan knows which auras those are.
   */
  const windowStart = segment === undefined ? 0 : segment.startTs;
  const windowEnd = segment === undefined ? Math.max(elapsedMs(run), 1) : segment.endTs;
  const durationMs = Math.max(windowEnd - windowStart, 1);

  // Scanning only the segment's time range still requires the per-enemy check
  // below, because a segment's window can contain another segment's events.
  const from = segment === undefined ? 0 : store.seek(segment.startTs);
  const to = segment === undefined ? store.count : store.seek(segment.endTs + 1);

  for (let row = from; row < to; row++) {
    const code = store.code[row]!;
    const flags = store.flags[row]!;
    const isSelfDamage = mode === 'damage' && SELF_DAMAGE_CODES.has(code);
    // Absorbed hits are output, not damage received, so they join `done` only.
    const isAbsorbed = mode === 'damage' && direction === 'done' && ABSORBED_CODES.has(code);
    // The same rows, read the other way round: damage a shield stopped is
    // healing by whoever cast the shield. See `shielder` below.
    const isShielded = mode === 'healing' && direction === 'done' && ABSORBED_CODES.has(code);
    // Damage a party member did to the party, which healing has to weigh
    // against the ability that did it. See `friendlyFire` below.
    const isFriendlyFire = mode === 'healing' && direction === 'done' && DAMAGE_CODES.has(code);
    // An attempt that landed on nothing, for a miss rate. Damage only: a heal
    // cannot be dodged.
    const isMiss = mode === 'damage' && MISS_CODES.has(code);
    const auraUp = AURA_UP_CODES.has(code);
    const isAura = auraUp || AURA_DOWN_CODES.has(code);
    /**
     * Melee support, which arrives on the side of the swing totals ignore.
     *
     * Totals read SWING_DAMAGE, the attacker's copy, because counting both
     * sides of a swing counts all melee twice. But Blizzard writes the
     * supported slice of a melee hit only as SWING_DAMAGE_LANDED_SUPPORT —
     * there is no SWING_DAMAGE_SUPPORT at all — so excluding the landed code
     * outright drops it: 25.8M across 99,028 rows of one raid log, the whole
     * of what Ebon Might, Shifting Sands and Prescience added to melee. There
     * is nothing to double-count, since the only such rows are support rows.
     */
    const isSupportMelee =
      mode === 'damage' && code === Ev.SWING_DAMAGE_LANDED && (flags & EvFlag.SUPPORT) !== 0;
    if (code === Ev.SPELL_CAST_SUCCESS) {
      if (direction === 'done') tallyCast(row);
      continue;
    }
    if (
      !codes.has(code) &&
      !isSelfDamage &&
      !isAbsorbed &&
      !isShielded &&
      !isFriendlyFire &&
      !isMiss &&
      !isAura &&
      !isSupportMelee
    ) {
      continue;
    }

    const src = store.srcActor[row]!;
    const dst = store.dstActor[row]!;
    // Not actors.attribute(src): a twinned row is the supporter's own ability,
    // credited by the log to whoever triggered it. See `creditedActor`.
    const srcOwner = creditedActor(run, row);
    const dstOwner = actors.attribute(dst);
    const srcFriendly = segments.party.has(srcOwner);
    const dstFriendly = segments.party.has(dstOwner);

    /**
     * Whose shield stopped the hit, for the absorb rows healing counts.
     *
     * A SPELL_ABSORBED row's own source is whoever swung — the healer is in
     * the extra slot, where the parser puts the shield's caster. Without this
     * a blood death knight's Blood Shield and a warlock's Soul Leech are not
     * healing at all: on a real +12 that was 44.7M of the tank's 125.5M and
     * 12.2M of the warlock's 19.9M, and it is the whole reason a tank can
     * out-heal the healer on some pulls and show nothing for it.
     */
    const shielder = isShielded ? store.extraActor.get(row) : undefined;
    const shieldOwner = shielder === undefined ? -1 : actors.attribute(shielder);

    /**
     * Damage a party member dealt to the party, held aside until the end.
     *
     * Spirit Link Totem levels the group's health, which means healing
     * whoever is lowest by hurting whoever is highest — both under spell id
     * 98021. Count only the healing half and the shaman is credited with
     * 4.09M for an ability whose net effect that key was -0.47M.
     *
     * It is deliberately not subtracted here. Only abilities that also
     * healed are netted, which is resolved after the scan, because "did this
     * spell heal anyone" is not knowable at the row that damaged them.
     * Subtracting every friendly hit instead would charge a warlock for
     * Burning Rush and a shaman for Harsh Winds — self-harm that heals no
     * one, that Warcraft Logs does not deduct either, and that on this log
     * would have cost two players a figure that currently matches exactly.
     */
    if (isFriendlyFire) {
      if (srcFriendly && dstFriendly && (flags & EvFlag.SUPPORT) === 0) {
        let bySpell = friendlyFire.get(srcOwner);
        if (bySpell === undefined) {
          bySpell = new Map();
          friendlyFire.set(srcOwner, bySpell);
        }
        const spellId = store.spellId[row]!;
        const dealt = effective(store.amount[row]!, store.waste[row]!);
        bySpell.set(spellId, (bySpell.get(spellId) ?? 0) + dealt);
      }
      continue;
    }

    // Healing is friendly-to-friendly, so it has no hostile side to segment by.
    // Attribute it by timestamp instead, which is correct because a heal cannot
    // belong to two segments the way a trash pack dragged into a boss can.
    let rowSegment: number;
    if (mode === 'healing') {
      rowSegment = segment === undefined ? -2 : segment.id;
    } else {
      rowSegment = segments.segmentOf(row);
    }
    if (segment !== undefined && rowSegment !== segment.id) {
      if (!isSelfDamage) continue;
      // Self damage has no enemy; fall back to the time window.
      const ts = store.ts[row]!;
      if (ts < segment.startTs || ts > segment.endTs) continue;
    }

    const subject = isShielded ? shieldOwner : direction === 'done' ? srcOwner : dstOwner;
    const subjectFriendly = isShielded
      ? shieldOwner >= 0 && segments.party.has(shieldOwner)
      : direction === 'done'
        ? srcFriendly
        : dstFriendly;
    if (mode === 'healing') {
      if (!subjectFriendly) continue;
      // A shield on an enemy stopped damage we dealt. That is the enemy's
      // mitigation, not our healing, and it is already counted as damage done.
      if (isShielded && !dstFriendly) continue;
    } else if (direction === 'done') {
      if (!srcFriendly || dstFriendly) continue;
    } else {
      if (!dstFriendly || (srcFriendly && !isSelfDamage)) continue;
    }

    /**
     * Misses and auras, which refine a row rather than fill one.
     *
     * Filed against the subject the damage rules already picked, so that the
     * two columns describe the same side of the fight as the amount beside
     * them: on `done` a debuff a player put on an enemy and a swing an enemy
     * avoided, on `taken` a debuff the player is carrying and a blow they
     * dodged. The friendly-side checks above have already dropped the rest —
     * party buffs on `done`, the player's own buffs on `taken`.
     */
    if (isMiss || isAura) {
      if (subjectFriendly && (flags & EvFlag.SUPPORT) === 0) {
        const subjectAcc = accFor(subject);
        // A shield coming off is healing activity, though not healing. See
        // EvFlag.SHIELD.
        if (mode === 'healing' && flags & EvFlag.SHIELD) touch(subjectAcc, store.ts[row]!);
        const spellId = store.spellId[row]!;
        if (isMiss) {
          // Only a real avoid. An absorbed or blocked hit is logged as a miss
          // too, and its damage is already in the table — see EvFlag.AVOIDED.
          if (flags & EvFlag.AVOIDED) {
            subjectAcc.misses.set(spellId, (subjectAcc.misses.get(spellId) ?? 0) + 1);
          }
        } else {
          // Keyed on `dst` rather than its owner: the aura is on the unit the
          // event names, and two pets of one warlock are two targets.
          trackAura(subjectAcc.auras, spellId, dst, store.ts[row]!, auraUp);
        }
      }
      continue;
    }

    const amount = store.amount[row]!;
    // SPELL_ABSORBED puts the shielded amount in `amount` and leaves `waste`
    // for the shield's remaining pool, which is neither overkill nor
    // overhealing. A shield that expires unspent is waste that the log never
    // states, so absorbs contribute to a total and never to its overheal.
    const waste = isAbsorbed || isShielded ? 0 : store.waste[row]!;
    const net = effective(amount, waste);

    if (flags & EvFlag.SUPPORT) {
      // The copy of a twinned pair, whose plain half has already been filed
      // under the supporter. Not credit: an evoker's Bombardment is their own
      // damage, not aid lent to the player whose hit set it off, and counting
      // it here would show up as "aided" on a player who gained nothing.
      if (flags & EvFlag.SUPPORT_TWIN) continue;
      // A slice of the subject's own hit, reported again under the evoker's
      // spell. Added to nobody's total as it stands — the ally's row already
      // contains it, and counting it here as well would invent damage.
      const supporter = store.support.get(row);
      const to = supporter === undefined ? -1 : actors.attribute(supporter);
      if (to >= 0) accFor(to).supportGiven += net;
      if (subjectFriendly) accFor(subject).supportReceived += net;
      // Beyond this point the slice is moved to the evoker. `taken` is left
      // out because there is nothing there to move: an aug buffs the party,
      // so a supported row is always a party member hitting an enemy.
      //
      // An absorb's slice is the one shape of `done` that cannot move either.
      // Blizzard writes the support spell into the shield's slot there rather
      // than the attack's, so the row says neither which ability earned it nor
      // which shield to take it off — 4.8M of a raid log's 755.4M of support,
      // which stays credit on both sides.
      if (!creditSupport || direction !== 'done' || isAbsorbed || isShielded) continue;
      if (to < 0 || to === subject || !subjectFriendly) continue;

      const carrier = store.extraSpellId[row]!;
      const spellId = store.spellId[row]!;
      const key = `${subject}|${carrier}|${to}|${spellId}`;
      let move = supportMoves.get(key);
      if (move === undefined) {
        move = {
          dealer: subject,
          carrier,
          to,
          spellId,
          net: 0,
          raw: 0,
          hits: 0,
          crits: 0,
          critTotal: 0,
          ticks: 0,
          max: 0,
        };
        supportMoves.set(key, move);
      }
      move.net += net;
      move.raw += amount;
      move.hits++;
      if (flags & EvFlag.CRITICAL) {
        move.crits++;
        move.critTotal += net;
      }
      if (flags & EvFlag.PERIODIC) move.ticks++;
      if (net > move.max) move.max = net;
      continue;
    }

    if (!subjectFriendly && mode === 'damage' && direction === 'taken' && !isSelfDamage) {
      unattributed += net;
      continue;
    }

    const acc = accFor(subject);
    acc.total += net;
    touch(acc, store.ts[row]!);
    acc.raw += amount;
    acc.wasted += wasted(waste);

    // The shield, not the blow it stopped: "Blood Shield", not "Melee".
    const spellId = isShielded ? store.extraSpellId[row]! : store.spellId[row]!;
    const spell = spellFor(acc, spellId);
    spell.total += net;
    spell.raw += amount;
    spell.wasted += wasted(waste);
    spell.hits++;
    if (flags & EvFlag.CRITICAL) {
      spell.crits++;
      spell.critTotal += net;
    }
    if (flags & EvFlag.PERIODIC) spell.ticks++;
    if (net > spell.max) spell.max = net;
    if (direction === 'taken') {
      spell.sources.set(srcOwner, (spell.sources.get(srcOwner) ?? 0) + net);
    }
  }

  // An ability that healed the party and hurt it is one ability, and what it
  // did is the difference. Abilities that only ever hurt are not here: they
  // have no healing row to net against, so the lookup misses and they are
  // left alone. Overheal is untouched — it is a fact about healing, and a
  // Spirit Link that hurt someone did not overheal them.
  for (const [subject, bySpell] of friendlyFire) {
    const acc = accs.get(subject);
    if (acc === undefined) continue;
    for (const [spellId, dealt] of bySpell) {
      const spell = acc.spells.get(spellId);
      if (spell === undefined) continue;
      spell.total -= dealt;
      acc.total -= dealt;
    }
  }

  settleSupport(supportMoves, accs, accFor, spellFor);

  // Auras still up when the window closed. Without this a debuff applied once
  // and never removed — what anything lasting to the end of a pull looks like —
  // reads as no uptime at all rather than as all of it.
  for (const acc of accs.values()) {
    for (const aura of acc.auras.values()) {
      if (aura.on.size > 0 && aura.since >= 0) {
        aura.ms += Math.max(0, windowEnd - aura.since);
        aura.on.clear();
        aura.since = -1;
      }
    }
  }

  const total = [...accs.values()].reduce((sum, acc) => sum + Math.max(acc.total, 0), 0);
  const seconds = durationMs / 1000;

  const result: ActorBreakdown[] = [...accs.values()]
    .filter((acc) => acc.total !== 0 || acc.supportGiven !== 0)
    .map((acc) => {
      const actor = actors.at(acc.actorIndex);
      return {
        actorIndex: acc.actorIndex,
        name: actorName(context, acc.actorIndex),
        specId: actor?.specId ?? -1,
        total: acc.total,
        raw: acc.raw,
        wasted: acc.wasted,
        supportGiven: acc.supportGiven,
        supportReceived: acc.supportReceived,
        perSecond: acc.total / seconds,
        share: total > 0 ? acc.total / total : 0,
        activeMs: acc.activeMs,
        spells: buildSpells(context, acc, durationMs),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    label:
      segment === undefined
        ? mode === 'healing'
          ? 'Healing — whole key'
          : 'Damage — whole key'
        : `${segment.kind === SegmentKind.BOSS ? 'Boss' : 'Pull'}: ${segment.label}`,
    actors: result,
    total,
    wasted: [...accs.values()].reduce((sum, acc) => sum + acc.wasted, 0),
    durationMs,
    unattributed,
  };
}

/**
 * One row per ability rather than one per spell id.
 *
 * Spell ids are how the log reports damage and abilities are how a player
 * thinks about it, and the two stopped lining up some expansions ago. An
 * enhancement shaman's Crash Lightning arrives under three ids — the cast,
 * the cleave it procs, and the hero talent's version — and listed separately
 * they are 16.9M, 9.8M and 19.1M, three unremarkable rows, when the ability
 * is 45.7M and the largest thing the player did.
 *
 * Nothing is lost: a merged row keeps its pieces in `parts`, so the table can
 * open it, and every total is the same sum it was before.
 */
function buildSpells(
  context: AnalysisContext,
  acc: ActorAcc,
  durationMs: number,
): SpellBreakdown[] {
  const one = (spell: SpellAcc): SpellBreakdown => ({
    spellId: spell.spellId,
    name: spellName(context, spell.spellId),
    total: spell.total,
    raw: spell.raw,
    wasted: spell.wasted,
    hits: spell.hits,
    crits: spell.crits,
    critTotal: spell.critTotal,
    ticks: spell.ticks,
    casts: acc.casts.get(spell.spellId) ?? 0,
    misses: acc.misses.get(spell.spellId) ?? 0,
    // Clamped, so a column reading "101%" can never come out of a run whose
    // last event outran its own CHALLENGE_MODE_END.
    uptimeMs: Math.min(durationMs, acc.auras.get(spell.spellId)?.ms ?? 0),
    max: spell.max,
    topSourceName: topSource(context, spell.sources),
  });

  const groups = new Map<string, SpellAcc[]>();
  for (const spell of acc.spells.values()) {
    const key = abilityName(spellName(context, spell.spellId));
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [spell]);
    else members.push(spell);
  }

  const rows: SpellBreakdown[] = [];
  for (const [key, members] of groups) {
    const first = members[0]!;
    if (members.length === 1) {
      rows.push(one(first));
      continue;
    }
    const parts = members.map(one).sort((a, b) => b.total - a.total);
    // Sources are unioned rather than taken from the biggest part, so "who
    // hit me hardest with this" stays true of the ability and not of one of
    // its ids. Cheap: a merged row has two or three parts.
    const sources = new Map<number, number>();
    for (const spell of members) {
      for (const [source, amount] of spell.sources) {
        sources.set(source, (sources.get(source) ?? 0) + amount);
      }
    }
    rows.push({
      // The plain-named part, which is the ability's own spell and so the one
      // whose icon and tooltip a reader expects. Its variants are the
      // derivatives.
      spellId: (parts.find((part) => part.name === key) ?? parts[0]!).spellId,
      name: key,
      total: sum(parts, (part) => part.total),
      raw: sum(parts, (part) => part.raw),
      wasted: sum(parts, (part) => part.wasted),
      hits: sum(parts, (part) => part.hits),
      crits: sum(parts, (part) => part.crits),
      critTotal: sum(parts, (part) => part.critTotal),
      ticks: sum(parts, (part) => part.ticks),
      casts: sum(parts, (part) => part.casts),
      misses: sum(parts, (part) => part.misses),
      // The largest part, not their sum. The ids of one button are variants of
      // the same aura and are rarely up together, so adding them would report
      // an ability as up longer than the fight lasted.
      uptimeMs: parts.reduce((best, part) => Math.max(best, part.uptimeMs), 0),
      max: parts.reduce((best, part) => Math.max(best, part.max), 0),
      topSourceName: topSource(context, sources),
      parts,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

/**
 * One aura event folded into an ability's uptime.
 *
 * The targets carrying the aura are kept as a set rather than a count so the
 * intervals union in a single pass: a DoT ticking on five enemies is up once,
 * not five times, and uptime only advances when the last of them loses it.
 */
function trackAura(
  auras: Map<number, AuraAcc>,
  spellId: number,
  target: number,
  ts: number,
  up: boolean,
): void {
  let aura = auras.get(spellId);
  if (aura === undefined) {
    aura = { on: new Set(), since: -1, ms: 0 };
    auras.set(spellId, aura);
  }
  if (up) {
    if (aura.on.size === 0) aura.since = ts;
    aura.on.add(target);
    return;
  }
  // A removal for a target never seen gaining it belongs to an aura that went
  // up before the window opened, and nothing in the window says when. Dropped
  // rather than guessed: that understates such an aura and never invents one.
  if (!aura.on.delete(target)) return;
  if (aura.on.size === 0 && aura.since >= 0) {
    aura.ms += Math.max(0, ts - aura.since);
    aura.since = -1;
  }
}

function sum(parts: readonly SpellBreakdown[], of: (part: SpellBreakdown) => number): number {
  let total = 0;
  for (const part of parts) total += of(part);
  return total;
}

function topSource(context: AnalysisContext, sources: Map<number, number>): string {
  let best = -1;
  let bestTotal = -1;
  for (const [index, total] of sources) {
    if (total > bestTotal) {
      best = index;
      bestTotal = total;
    }
  }
  return best < 0 ? '' : actorName(context, best);
}

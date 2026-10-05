# wow-mplus-logs

Combat log analysis for Mythic+ keys. Desktop-first, because live-tailing a key
in progress needs filesystem access a browser cannot have.

MIT licensed — see [LICENSE](LICENSE). Downloads for Linux and Windows are on
the [releases page](../../releases); `## Building a release` below covers making
them yourself.

## Layout

```
packages/parser/    portable combat log engine — bytes in, columnar events out
packages/analysis/  segmentation, damage/healing breakdowns, interrupts, deaths
apps/desktop/       Electron shell: worker-thread parsing, live tail, React UI
packages/data/      the generated enemy-forces and spell tables, the MDT reader
```

## The rule that keeps a web version possible

`packages/parser` imports no Node builtin. It accepts `Uint8Array` chunks; the
caller decides whether those came from `fs.createReadStream`, a dropped `File`,
or a socket. `npm run check:pure` fails the build on any `node:` import, because
breaking that rule quietly turns the web port into a rewrite.

## Design decisions worth knowing

**Incremental by default.** The parser is a push-based state machine. Batch
parsing is just pushing a whole file quickly; live tail is pushing the bytes
appended since the last poll. One code path, so the batch case cannot drift from
the tailing case. `test/parser.test.ts` feeds the same log one byte at a time and
asserts the result is identical to a single push — that test is what makes
tailing trustworthy, since the game flushes whenever it likes and every split
point has to behave the same.

**Columnar storage.** One object per event would be ~300 bytes and would put a
million short-lived objects through GC per key. The store is struct-of-arrays
typed columns at a measured 54 bytes/event. It also doubles as the wire format
for sharing a run later: a header plus concatenated buffers, no serialization
pass.

**Layout is derived, not hardcoded.** Event names are `PREFIX + SUFFIX` and the
parameter list is `[8 base][prefix][advanced?][suffix]`. The parser computes
widths from the name and detects the advanced block by testing whether the field
at its offset looks like a GUID, so it handles events it has never seen.

**The advanced block is measured, not assumed.** It was 17 fields and is 19 as
of build 12.1.0, with the new stat fields inserted in the middle. So health is
addressed from the block's start and position/level from its end — both ends are
stable — and the width itself is found by locating `positionX`, the only
fractional field in the block. A future insertion in the middle changes nothing.

**Overkill position is calibrated.** `baseAmount` was likewise inserted into the
damage suffix, shifting `overkill`. Suffix width decides the extremes, and in
the ambiguous middle the `-1` sentinel on non-killing hits identifies the slot.
The answer locks once determined, since it cannot change within one file.

**The spec id is found structurally.** `COMBATANT_INFO` is
`GUID, faction, <stats...>, currentSpecID, [talents], ...`, so the spec is the
field before the first bracketed array. It was at index 23, moved to 24 in
12.1.0, and will move again; the stats are all plain numbers, so the first `[`
is unambiguous.

**The advanced block does not always describe the destination.** `SWING_DAMAGE`
reports the attacker while `SWING_DAMAGE_LANDED` and the spell events report the
victim, so the block's `infoGUID` is compared against both actors and the
`INFO_IS_SOURCE` flag records the answer. This matters twice over: the health
column is otherwise attributed to the wrong unit, and the block's `ownerGUID` —
the pet link — applied to the source regardless meant a healer topping up
someone's pet adopted that pet's owner, which rerouted the healer's whole output
onto an unrelated actor and silently zeroed every per-player total.

**Party membership is per run.** `Actor.inParty` is sticky and the actor table
spans the whole file, so over an evening with a tank swap the file-wide list is
everyone who played. `RunMeta.party` holds the five who were actually there.

## Enemy forces ("count"), from Blizzard's own criteria

A key is not finished until the party has killed enough trash: the enemy-forces
bar, which players call **count**. The combat log does not carry it. Every event
says who hit whom for how much; none of them says that killing a Ritual
Chieftain moves the bar by 25 of the 817 Altar of Fangs asks for.

That mapping lives in the game's scenario criteria, and so does this table. A
key is a scenario, a scenario's requirements are a tree of criteria, and one
node per dungeon is called **Enemy Forces**: its `Amount` is the count the
dungeon demands and its children are the ways to earn it. A `Criteria.Type 0`
child names a creature and what killing one is worth.
`scripts/enemy-forces.mjs` reads five DB2 tables via [wago.tools][wago] and
generates `packages/data/src/enemy-forces.ts` — 74 dungeons, 1,531 creatures,
24KB of ids and amounts.

**This replaced [Mythic Dungeon Tools][mdt], which is where the number usually
comes from.** MDT turned out to be exactly right: checked across six dungeons
it agreed on every total and on all 110 overlapping per-kill values. Every
difference ran one way — MDT *omits* creatures Blizzard credits, ten across
those six dungeons — so this is not a second opinion about MDT's numbers. It is
the same numbers from upstream, with the gaps filled.

Two things follow from the source change. Blizzard's data is not GPL-2.0, so
unlike MDT's tables it can be shipped: **a user with no addons installed now
gets counts**, where before they got none. And the criteria tree carries
something a kill-based table structurally cannot — see below.

**Some dungeons award forces for things that are not kills.** Eight of the 74 do:
the Mists of Tirna Scithe maze, Ruby Life Pools, and King's Rest, where a
scenario objective is worth 30 of its 608. Nothing in the combat log reports an
objective being completed, so those points are unearnable by any log reader —
which is why a real timed King's Rest counts 584 of 608 and reads 96%.

That number is correct and is left alone. `nonKillForces` is carried per dungeon
as a **tolerance, not an addend**: the count still reads 96% because there is no
evidence in the log that the objective happened, but a completed key short by no
more than the dungeon's own award is fully explained and is not flagged. What
survives that tolerance is a genuine contradiction — a creature worth more than
the table says, or a hotfix newer than the build — and is worth a warning.

The committed table is checked in CI with `node scripts/enemy-forces.mjs
--check`, which regenerates and exits non-zero if it differs. Hotfixes are
already applied in what wago.tools exports, so the table is live data rather
than a snapshot of a patch's shipped files: every hotfixed `CriteriaTree` row
absent from the export is a delete.

One field still comes from MDT, when the user has it: `teleportSpellId`, the
spell whose icon is the dungeon's art. Nothing in Blizzard's data links a
dungeon to a spell. `packages/data/src/mdt.ts` reads it from a string and stays
browser-portable; `apps/desktop/src/main/forces.ts` is the half that touches the
filesystem and finds MDT **next to the log being read** —
`<install>/_retail_/Interface/AddOns/MythicDungeonTools`, derived from
`<install>/_retail_/Logs/WoWCombatLog-*.txt` — because someone with a live and a
PTR install has two MDTs at different versions and the right one is the one
belonging to the client that wrote the log. It is purely cosmetic now: without
it a dungeon shows its initials and every number on the page is identical.

[mdt]: https://github.com/Nnoggie/MythicDungeonTools
[wago]: https://wago.tools

## Icons

Three kinds of art, one cache, and no game files in this repo.

**Spell icons** are the original case. A log line carries a spell id and a name
and nothing else, so the icon has to come from outside: Wowhead's tooltip
endpoint turns an id into a texture name and its CDN serves the 36px jpg.

**Spec icons** sit next to every player name — in the breakdown tables, the
death list, the party header and the key selector. A spec is not a spell and has
no id to look up, so `specs.ts` carries the texture names directly and
`resolveNamed` fetches them without the tooltip hop. The names are game data,
not a lookup result, so the whole set resolves in one batch the first time any
view wants one rather than five round trips for a five-player party.

**Dungeon icons** are the one that looked like it needed a new data source and
did not. A dungeon's *teleport spell* carries exactly the icon the game uses for
the dungeon itself — `Path of the Windrunners` is
`inv_achievement_dungeon_windrunnerspire` — and MDT's `mapInfo` already lists a
`teleportId` per dungeon, which is how MDT's own dungeon picker draws itself. So
the dungeon icon is one more spell id down the path that already existed, and
the alternative — a hand-maintained table of dungeon ids to texture names, stale
every season — never has to be written.

That does mean dungeon art is the one thing still gated on MDT being installed,
now that the counts are not. The key selector falls back to the dungeon's
initials, so those rows still read as deliberate rather than broken.

**Nothing is vendored.** Blizzard's icon art is fetched per user at runtime and
cached under `userData`, never committed here — the same reasoning that keeps
MDT's tables out of the repo, applied to art instead of data. The cost is one
CDN request per icon per machine, ever.

**Nothing waits on an icon.** Every view renders without one: the boxes are
sized and coloured by CSS before any art arrives, so nothing reflows when it
does, and offline (`MPLUS_OFFLINE=1`, a dead CDN, a plane) the class colour is
simply all there is. That is also what the server-rendered smoke test sees,
which is why it can assert on the no-icon case for free.

**The join key is the challenge-mode map id.** `CHALLENGE_MODE_START` writes
both an instance id and a challenge-mode id, and only the second is what
`MapChallengeMode.ID` holds (and what MDT keys `mapInfo[dungeonIndex].mapID`
on). Ruby Life Pools is challenge-mode 399 and instance 2521; joining on the
wrong one matches nothing at all. Confirmed on real logs: Voidscar Arena 585,
Altar of Fangs 588, Den of Nalorakk 586, Murder Row 587, The Blinding Vale 584.

Getting from there to the criteria tree is the one join the data does not make
for you: `MapChallengeMode` and `Scenario` were added five expansions apart and
nothing links them numerically, so the generator matches them by name and keeps
a four-entry alias table for the dungeons whose two names disagree ("Upper
Return to Karazhan" against "Return to Karazhan: Upper"). An unmatched name is
reported in the generator's output rather than silently dropped.

**The Lua is read by brace depth, not by indentation or by regex alone.** Only
MDT's `mapInfo` header is read now, but finding it in a real file is still the
whole job: the enemy table below it is full of `["id"]` keys at several depths,
and a dungeon name can contain a brace. Doing it by indentation would break the
first time MDT reformats; doing it by plain regex reads a clone's `["id"]` as a
map. A file whose braces do not balance reads as no teleport rather than as a
guess, so a truncated download costs an icon and nothing else.

**Forces are awarded on death, and only for enemies the party engaged.** Both
halves of that are load-bearing. A pack tagged and walked past moves the bar by
nothing, so `killed` is tracked apart from `spawns`. And a real +12 Voidscar
Arena had fourteen enemies die without ever being hit — six Voidminders at the
same instant, then pairs of Enthralled Shamans and Dominated Brawlers sharing a
timestamp to the millisecond — which are waves despawning when their event
ends. Counting them took the run from 742/738 (100.5%, what a timed key looks
like) to 784 (106.2%, a number the game cannot produce).

Measured against six real keys, five timed and one depleted:

| key | count | |
| --- | --- | --- |
| +12 Voidscar Arena | 742 / 738 | 100.5% |
| +12 Altar of Fangs | 826 / 817 | 101.1% |
| +12 Den of Nalorakk | 750 / 729 | 102.9% |
| +15 Murder Row | 666 / 655 | 101.7% |
| +12 The Blinding Vale | 698 / 686 | 101.7% |
| +16 Murder Row (depleted) | 472 / 655 | 72.1% |

Every timed key lands just over 100%, which is what finishing a key actually
looks like — the last pull overshoots. The depleted one is the party giving up
three-quarters of the way through. Reading MDT off a real install takes 20 ms
for all sixteen dungeons.

`null` and `0` are kept distinct throughout: 0 is a boss or a summon genuinely
worth nothing, `null` is a creature no table covers. The UI shows the second as
`—` and says the segment's count is a lower bound, because collapsing them
would quietly understate a pull.

## Defensives, and why the list is not curated

The death recap has a lane for what the dying player had up. Filling it with
every buff makes it useless: a real key puts over a hundred distinct buffs on
five players, and food, weapon imbues, haste procs and seasonal trinkets bury
the one Shield Wall you are looking for. One logged Kings' Rest key carries 166
of them.

The obvious fix is a hand-kept list of defensives, which is wrong for the usual
reason — it is a few hundred spells across thirty-nine specs, it goes stale
every patch, and whoever forgets to update it is the person who later wonders
why the lane is empty for a Druid.

So it is derived instead. The game has no flag that says "this is a defensive",
but it does classify what every spell *effect* does, and the aura types are the
vocabulary we want: `SCHOOL_ABSORB`, `MOD_DAMAGE_PERCENT_TAKEN`,
`SCHOOL_IMMUNITY`, `MOD_DODGE_PERCENT`, and six more. A spell that reduces the
damage you take is a defensive whatever it is called and whichever patch
invented it. `scripts/spell-effects.mjs` reads `SpellEffect.db2` from
[wago.tools][wago], keeps the spells carrying one of those ten auras, and writes
`packages/data/src/defensives.ts`. On the current build that is 629k effect rows
in, 9k spell ids out. On the key above it cuts the lane from 166 buffs to 27.

What is still a judgement call is the ten aura numbers — but ten numbers that
have barely moved in a decade is a different maintenance problem from five
hundred spells that move every patch. Each one is listed in the script beside
the spell that proves it, every one of them read off the data rather than
trusted from memory.

Two caveats, both in the script:

- **Dummy auras.** A handful of defensives are implemented as a script behind
  `SPELL_AURA_DUMMY`, so nothing in the data describes them. Survival Instincts
  is the notable one. Those are in a short hand-held list, which is allowed to
  stay short — if a spell's aura is in the data, the aura list is what should
  change.
- **`MECHANIC_IMMUNITY` is excluded.** It is crowd-control immunity, which is
  utility rather than survival, and every real defensive carrying it also
  carries `MOD_DAMAGE_PERCENT_TAKEN`, so it would have bought noise and nothing
  else.

The tables are regenerated per patch with `npm run spell-effects`, and
`npm run spell-effects -- --check` fails without writing if a committed copy is
out of date. Only spell ids are stored — no names, no descriptions, no art. The
log already carries the name of every aura it reports.

Classification is a fact about the spell, so the analysis tags every aura with
it and the chart decides what to do: buffs are narrowed to defensives, debuffs
are kept whatever they do. A debuff on someone who then died is worth seeing
even if it was only a slow.

### The one thing the debuff lane does drop

Some of what the game writes on a player as a debuff is the game talking to
itself. Sated is the example: it is how the client remembers you have had
Bloodlust, and the refusal to give you another lives in Bloodlust rather than in
Sated, which does nothing whatsoever. Hypothermia, Cauterized, Cheated Death and
a spent Demonic Gateway are the same shape — a cooldown written down where you
can see it. None of them belongs in a chart about dying.

That is readable from the same table. Every effect a spell has is a row in
`SpellEffect.db2`, and a spell whose rows all apply `SPELL_AURA_DUMMY` and
trigger nothing has no described effect at all. The second generated table,
`packages/data/src/markers.ts`, is those spells: 50k of them, which is the
warning as much as the answer. **Plenty of boss mechanics are in that list**,
because a debuff that detonates when it expires is implemented in a script and
the data describes a script as nothing — three of the thirty-eight debuffs in
the Kings' Rest key land there for exactly that reason.

So the table is never consulted alone. The pairing is: the game's data gives the
spell no effect, *and* the dying player applied it to themselves. A note you
wrote on yourself that does nothing is a note. A mechanic a boss put on you
stays in the chart however little the data says about it. The analysis does that
pairing once, in `bookkeeping` on `AuraWindow`, rather than leaving the
dangerous half lying around for a call site to misuse.

The known gap is the other direction: hero sickness applied by the caster rather
than by the recipient would not be caught. In every log checked it is applied by
the recipient, and the cost of being wrong is one line of noise rather than a
missing mechanic.

### What they pressed, when the log cannot tell a press from a proc

The recap's other lane is what the dying player did about it, and the log is no
help at all here: it reports a proc exactly the way it reports a keypress. A
retribution paladin who took Crusading Strikes writes a `SPELL_CAST_SUCCESS`
under their own name on *every auto-attack* — 258 of them in one logged arena —
and an evoker's Charged Blast does the same for a stacking buff nobody has a
keybind for. A demon hunter picking up Soul Fragments logs 637. Read at face
value the lane reads as a player hammering buttons as they died, with the one
Shield Wall that is the actual answer buried in it.

Same move as the defensives, against a different fact. Everything a player can
press is on a clock of some kind — the global cooldown, a cooldown of its own,
or a charge — because an ability with no clock at all would be spammable and
nothing in the game is. A triggered strike has none of the three, because the
talent that triggers it owns the rate. `scripts/spell-presses.mjs` reads those
three columns out of `SpellCategories.db2`, `SpellCooldowns.db2` and
`SpellCategory.db2` and writes `packages/data/src/buttons.ts`: 40k spells, ids
only. The three downloads come to ~4MB, so unlike its sibling this one is cheap
to re-run.

Across two real logs it drops exactly the right rows and nothing else:
Crusading Strikes, Charged Blast, Soul Fragment, a rogue's Fatebound Coin flip,
Mutilate's off-hand half, Voidblade's triggered half, and the warrior pattern
where Charge, Heroic Leap, Whirlwind and Intervene each log a second cast line
beside the press — whose partner is kept, so the recap loses nothing.

Two caveats, both in the generated file:

- **A few defensives carry no clock either.** Renewing Blaze and Shield of
  Vengeance have no cooldown anywhere in the data, so the question is asked
  beside `isDefensive` and a defensive is a press whatever the button table
  says. A defensive missing from the recap of the death it was pressed in is
  the one error worth paying noise to avoid. The pairing is done once, in
  `pressed` in @mplus/analysis.
- **Above the build's highest spell id, everything is a press.** Spell ids are
  handed out in order, so an id past the frontier belongs to a patch newer than
  the table, and the honest answer about it is "no idea". Saying press costs a
  line of noise; saying proc would hide a brand-new button.

What it does drop that was really pressed is a cast with no clock *and* no
cooldown: weapon poisons and food, which take a cast but nothing else. Neither
happens in the ten seconds before someone dies.

The lane was also missing presses, for an unrelated reason worth writing down.
The scan split on destination before it looked at casts, so a cast aimed at the
dying player themselves — a shield or a heal on their own health bar, which
names them on both sides of the event — fell down the "not about the victim"
branch and was never recorded. That is 3% of player casts in a real log, and
disproportionately the interesting ones.

[wago]: https://wago.tools

## Interrupts, and what a whiff actually is

The interrupts tab answers two questions that the log answers from opposite
ends. **What was stopped** is stated outright: `SPELL_INTERRUPT` names the
interrupt and the cast it ended, so that half needs no table and no inference.
**What was pressed** is not reported at all — a Kick is an ordinary
`SPELL_CAST_SUCCESS`, indistinguishable from a Frostbolt unless you already know
what the spell does.

So the press side needs the same treatment as the defensives, against a
different effect: `SPELL_EFFECT_INTERRUPT_CAST`. 603 spells carry it, and most
of them are not interrupts in the sense anyone means — Avenger's Shield carries
it, and a protection paladin presses that on cooldown for its damage. Counting
those casts would report a tank whiffing a hundred interrupts a key. What
separates the two is everything *else* the spell does, so the rule is
subtraction: the 136 spells whose every described effect is the interrupt. Every
player interrupt in the game is in that set and nothing that deals damage is.
Five more are added by hand in `scripts/spell-effects.mjs`, because the press
and the interrupt are two different spells and the data only describes the
second — Skull Bash, Silence, Solar Beam, the sacrificed-pet Spell Lock and Axe
Toss. A button missing from that list costs only its whiffs; its interrupts
still count, because those come from the log.

Pairing the two halves is easier than it looks: across five real logs the
interrupt followed its own cast by a median of 1 ms and never by more than
84 ms. The match is on the player and the clock rather than on the spell,
because it has to be — a druid's press is Skull Bash `106839` and the interrupt
arrives as Skull Bash `93985`.

**One press, two cast lines.** Skull Bash is logged as a cast of `93985` *and* a
cast of `106839`, same millisecond, same target, every time. Taken at face value
a druid presses 46 interrupts in a key and lands 17, because the second line of
each pair always whiffs — the first has already claimed the interrupt. Collapsed
the same way the damage tables merge an ability logged under several ids, the
same key reads 23 presses and 17 stops. Two presses by one player at one target
in the same millisecond is not a thing that happens, so the collapse costs
nothing.

### Why the whiffs are broken down

"Pressed 15, interrupted 10" is an accusation, and usually a wrong one. Over
sixteen real keys — 1,033 presses, 802 casts stopped — the 231 whiffs were:

| what the press ran into | count |
| --- | --- |
| another player's interrupt got that cast first | 122 |
| the target was not casting at all | 77 |
| the cast had already finished | 15 |
| the target was mid-cast and the cast carried on | 10 |
| the target started casting just after | 6 |
| the log reports the interrupt itself as missed | 1 |

The largest group is not a mistake by the player it is charged to: it is two
cooldowns spent on one cast, which is a conversation for the party and a
different one from "you were asleep". So each press is put to the target's own
cast windows — built from `SPELL_CAST_START` and whatever closed it — and
reported with what became of the cast it was about.

The one inference in that table is the fourth row. The log never says a cast
could not be interrupted; what it says is that the press landed inside a cast
that completed anyway, which is what an uninterruptible cast and an unreported
immunity both look like. The outcome is named for the observation
(`ignored`, "cast carried on") rather than for the conclusion.

Pets are rolled up like damage: a felhunter's Spell Lock is the warlock's
interrupt, and the press log names the pet beside the spell. Attempts are
attributed to the segment their **target** belongs to, like damage and for the
same reason — a Kick into a straggler dragged through a boss fight belongs to
that straggler's pull, not to whatever the clock was in.

## Segmentation, and why it is keyed on the enemy

A key splits into boss fights and trash pulls. Boss windows come free from
ENCOUNTER_START/END; trash pulls are inferred from combat activity with a 5s gap.

The hard part is that the two **overlap** — dragging a pack into a boss is
routine, and sometimes deliberate. Segments are therefore not a partition of the
timeline, and attributing damage by timestamp would count a dragged pack against
both the boss and its own pull.

So attribution is keyed on the **enemy**, not the clock. Each hostile unit is
assigned to the segment it was first engaged in, and a damage event belongs to
whichever segment its enemy side belongs to. Boss adds land on the boss because
they are first engaged inside its window; a pack pulled beforehand keeps its own
pull even while the boss is up. Both are live at once, and the sum over segments
equals the run total exactly — there is a test asserting that, and the
`report` script prints the residual on real logs (0.00%).

One wrinkle needed real data to find. ENCOUNTER_START lags the first hit: on a
real log a boss was damaged 4s before its window opened, which filed the entire
boss under the preceding trash pull and left its own segment reading zero. A
grace period alone cannot fix it, because a pack dragged in was engaged only 11s
early — any window wide enough to catch the boss also catches the pack. Health
separates them cleanly: the boss had 92.5M against the pack's 12.7M. So a boss
window reclaims units engaged shortly before it whose health is at least half
the largest in the window.

## Attribution rules worth knowing

- **Pets roll up to their owner.** A Wild Imp's damage lands on the warlock.
- **`_SUPPORT` is a slice of someone else's hit, and it goes to the evoker.**
  Augmentation Evoker rows report how much of an ally's hit the buff added,
  under the evoker's own spell id, and that amount is already inside the ally's
  plain events — summing both invents damage. By default the slice is moved:
  the evoker's table gains a row for Ebon Might, Prescience or Shifting Sands,
  the ally's loses that much of the ability it rode in on, and the run total is
  unchanged. On a real raid of 464.6M that was 14.2M, three quarters of the
  evoker's own column, and it is how Warcraft Logs reports an aug.
  `creditSupport: false` leaves every point with the ally instead.
  - Which ability it rode in on is only knowable from the line above: the copy
    names the buff, not what the ally pressed. Of 580,708 support rows in one
    raid log, 580,639 sat directly behind a plain row with the same source and
    target, and the parser records that row's spell id.
  - The transfer is capped by what the ability actually holds. Most pet swings
    are written only from the victim's side — 23,515 `SWING_DAMAGE_LANDED`
    against 4,818 `SWING_DAMAGE` for one raid's Lesser Ghouls — and totals read
    the attacker's, so a pet can owe melee it was never credited with.
    Uncapped that invented 6M across 2,132 pets, each with a negative Melee row.
  - Melee support arrives on `SWING_DAMAGE_LANDED` only; there is no
    `SWING_DAMAGE_SUPPORT`. Its copy also carries a spell triple that a plain
    swing has nothing in the place of, which is the one event in the format
    where `_SUPPORT` changes the field layout rather than just the last field.
  - An absorbed slice is the exception that stays credit on both sides.
    `SPELL_ABSORBED_SUPPORT` puts the buff in the shield's slot rather than the
    attack's, so the row says neither which ability earned it nor which shield
    to take it off — 4.8M of that log's 755.4M of support.
- **Unless the `_SUPPORT` row repeats the line before it** — then it is the
  supporter's own ability and the game credited the wrong player. A
  Scalecommander Devastation Evoker's Bombardments is logged as an ordinary
  `SPELL_DAMAGE` against whichever party member's hit set the bomb off, with a
  `_SUPPORT` copy beside it naming the evoker; on a real +17 that left 12.8M of
  a 17.0M ability in four other players' tables. The parser pairs the two
  lines, and the damage is filed under the evoker. Breath of Eons,
  Fate Mirror and Inferno's Blessing are the same shape — 236M of a real raid
  log between them — while 345,259 Ebon Might rows paired with nothing, which is
  what tells the two cases apart.
- **`SWING_DAMAGE_LANDED` is not extra melee.** It is the same hits from the
  victim's side. Totals use `SWING_DAMAGE`; the LANDED rows serve death
  analysis, where their advanced block carries the victim's health, and carry
  the one thing the attacker's side never reports — melee `_SUPPORT`.
- **Effective is `amount - waste`** for both damage and healing. Confirmed on a
  real log: 10,838 heals had amount exactly equal to overhealing, and none had
  amount 0 with overhealing above it.
- **A pet dying is not a player death.** Testing the attributed owner rather than
  the victim turned 9 real deaths into 27, because a Blood DK's Blood Beasts
  resolve to a party member.

## Verified format

Confirmed against a real 188 MB log, build 12.1.0 / `COMBAT_LOG_VERSION` 22:

| | |
| --- | --- |
| advanced block | 19 fields (was 17) |
| damage suffix | `amount, baseAmount, overkill, school, resisted, blocked, absorbed, critical, glancing, crushing` + trailing `ST`/`AOE` on spells, absent on swings |
| `_SUPPORT` | the supporter's GUID replaces the `ST`/`AOE` field rather than being appended |
| `ENVIRONMENTAL_DAMAGE` | no prefix; `environmentalType` follows the advanced block |
| `SPELL_ABSORBED` | absorbed amount is 3 from the end — the last number is the shield's whole pool |
| `SPELL_HEAL_ABSORBED` | same tail without the critical flag, so 2 from the end |
| `COMBATANT_INFO` spec | field 24 (was 23) |
| `CHALLENGE_MODE_START` | `zoneName, instanceId, challengeModeId, keystoneLevel, [affixes]` — the third field is what joins to an enemy-forces table |
| `SWING_DAMAGE` vs `_LANDED` | the same hits from either side; totals agree within ~3%, so count one, not both |

## Verifying against your own logs

Format assumptions rot every patch. Point the inspector at a real log:

```sh
npm run build
npm run inspect -- ~/path/to/WoWCombatLog-093026_184900.txt
```

It reports throughput, the runs it found, the measured advanced-block width,
where overkill actually sits, whether the spec id still looks like one, and any
event names it does not recognize. `INSPECT_SAMPLES=1` adds one sample line per
event type.

```sh
npm run summary -- ~/path/to/WoWCombatLog-093026_184800.txt
```

The summary prints per-player dps, healing and deaths per run. The inspector
checks that fields parse; this checks that the numbers are *plausible*, which is
what actually catches attribution bugs — a tank at 140K dps and 118K hps reads
as a Blood DK, and a column of zeros does not.

```sh
npm run report -- ~/path/to/WoWCombatLog-100226_172805.txt 0
```

The report adds segments, per-pull count and the conservation checks. It reads
enemy forces through the app's own MDT reader, so it prints the real count for
each pull and the dungeon's requirement — and on a timed key the total landing
just over 100% is the single best end-to-end check there is. Without MDT
installed it says so and prints everything else.

## Measured

A real 188 MB / 643k-line log on this machine (3 keys, 638k recorded events):

| mode | throughput |
| --- | --- |
| index + full shape analysis | 89 MB/s, 305k lines/s |

A synthetic 271 MB / 900k-event log, isolating the two modes:

| mode | throughput | store |
| --- | --- | --- |
| index only (hooks fire, events discarded) | 179 MB/s, 594k lines/s | — |
| full record | 157 MB/s, 520k lines/s | 46.3 MB |

Index-only is the path that matters for opening a large log: it finds every run
without recording events, so a multi-gigabyte file lists its keys in seconds and
only the run the user clicks gets fully parsed.

## The desktop app

```sh
npm run dev     # electron-vite dev server with hot reload
npm run build   # compile packages, then bundle main/preload/renderer
```

**One-time setup.** npm blocked Electron's postinstall, so the Electron runtime
binary was never downloaded and the app cannot launch until it is:

```sh
npm install-scripts approve electron
npm rebuild electron            # approval alone does not run the skipped script
```

Everything else works without it — the packages build and test, and
`scripts/report.mjs` exercises the full analysis pipeline from the command line.

Architecture: parsing runs in a **worker thread**, not the main process, because
a long key is a couple of hundred megabytes and even at 157 MB/s that drops
frames. Only finished reports cross the IPC boundary — about 340 KB per run,
measured — while the event store stays in the worker.

Four launch-environment details worth knowing:

- `ELECTRON_RUN_AS_NODE` is set by VS Code in every terminal it spawns, and
  Electron honours it by running as bare Node: no Chromium, no window, `app`
  undefined. `electron.vite.config.ts` clears it, which covers `dev`, `preview`
  and `start` at once because electron-vite spawns Electron from that process.
- `productName` in `apps/desktop/package.json` is what gives the window a stable
  WM_CLASS / Wayland app_id (`mplus-logs`) for window-manager rules. It has to
  be the manifest field: Electron captures the id before the main script runs, so
  `app.setName()` is too late and Chromium's `--class` switch is ignored outright.
  Without it the window announces itself as `@mplus/desktop` and the per-user
  data directory nests under an `@mplus` folder.
- The preload is `out/preload/index.mjs`, not `.js` — Electron requires that
  extension for an ESM preload, so that is what electron-vite emits. Point
  `webPreferences.preload` at the wrong name and the renderer loads with no
  `window.mplus`; React then throws on the first view that reads it and leaves
  an empty `#root`, which looks exactly like a styling problem. `main.tsx`
  checks for the bridge and says so rather than rendering nothing.
- `scripts/electron-vite.mjs` wraps the CLI only to drop one class of upstream
  stderr noise: Electron links a fontconfig older than the system's config files,
  so on a distro shipping fontconfig 2.18 it prints ~90 "invalid constant used"
  lines per launch. Nothing is broken by them and nothing in the app can fix them
  — details in the script's header comment.

Live tailing needs no backscan. The engine reads faster than 100 MB/s, so
attaching to a key already in progress just means parsing the whole file (about
a second for 188 MB) and then following appends. The in-progress run falls out of
that naturally.

## Commands

```sh
npm run build          # all packages plus the desktop bundles
npm test               # parser and analysis suites
npm run typecheck      # including the renderer
npm run check:pure     # fail on node: imports in the portable packages
npm run inspect -- <log>      # format drift report
npm run summary -- <log>      # per-run dps/hps/deaths sanity check
npm run report -- <log> [n]   # segments, breakdowns, interrupts and deaths
npm run ui-smoke -- <log> [n] # server-render every view against a real run
npm run shot -- <log> [--view deaths] [--death 0]   # screenshot a view
npm run spell-effects         # rebuild the spell tables from Blizzard's DB2
npm run spell-presses         # rebuild the button table from Blizzard's DB2
```

`ui-smoke` is how the UI is verified without launching Electron: it runs the real
parse worker, then server-renders every view against the resulting analysis and
asserts the output — that the top player is named, that the health trace emits a
polyline with points, that no `NaN` or `undefined` reached the DOM, that empty
states say something useful. A visual check would not catch most of those.

It renders all 39 spec icons at once for the same reason: a spec whose texture
name was never filled in is invisible until someone plays that spec, and the
assertion costs nothing. The update strip is in there for the same reason again:
its interesting states — a staged update, a failed check — are ones you cannot
reach on demand on a machine that is already current. The key selector is rendered through `RunRow`, which is
a component rather than inline JSX in `App` largely so this test can reach it.

## Building a release

```sh
npm run dist                              # installers for the host platform, into release/
npm run pack --workspace @mplus/desktop   # unpacked app only, no installers
```

Linux produces an AppImage and a `.deb`; Windows an NSIS installer
(`-setup.exe`) and a portable `.exe`. CI builds both on a `v*` tag and attaches
them to a **draft** release, so a build is checked and its notes written before
anyone can download it. `workflow_dispatch` runs the same matrix without
publishing, which is how a packaging change gets proved without spending a tag.

Four things worth knowing before the first release.

**Every target needs a name of its own, and the Windows pair did not have one.**
A single `artifactName` template covers Linux fine, because AppImage and deb
differ in `${ext}`. Both Windows targets build a `.exe`, so under one template
they resolved to one path: the portable build overwrote the installer, the
publisher then queued two uploads under the same asset name, and the second
deleted and re-pushed 110 MB until GitHub's uploader returned `408 Request
Timeout`. The packaging log reads as a clean success right up to the upload,
which is why this looked like an Electron or a Windows problem and was neither.
`nsis` and `portable` now carry their own names.

The matching trap is that electron-builder publishes by the **manifest**
version, not by the tag you pushed, so `v0.1.1` against a `0.1.0` manifest
uploads `0.1.0` files into the `v0.1.0` release — and if that release already
has them, straight back onto the overwrite path above. The release workflow now
checks the two agree before it installs anything.

**The packaged app has no runtime dependencies.** `electron.vite.config.ts`
bundles the workspace packages rather than externalizing them, so the asar is
the build output and `package.json` and nothing else — no `node_modules`, no
symlinks for the packager to chase. That is the whole reason
`electron-builder.yml` is as short as it is.

**`npmRebuild` is off, and that is load-bearing.** Left on, electron-builder
shells out to `app-builder` to "install production dependencies" before every
package, with the app directory's `node_modules` as the working directory. A
clean `npm ci` hoists everything to the repo root and never creates
`apps/desktop/node_modules`, and Node reports a missing **cwd** as `ENOENT`
against the *executable's* path — so the failure reads as a missing
`app-builder` binary that is in fact present, 18 MB and executable, exactly
where the error says it is not.

It passed locally and failed on both runners because a worktree that has run
`npm install` a few times still has a stale `apps/desktop/node_modules` lying
around. Reproducing it needs a fresh clone, not a fresh build. The step is pure
waste here regardless — no native modules, no production dependencies — so it
is simply turned off.

**Nothing is signed.** Windows shows a SmartScreen warning on first run; Linux
does not care. Signing needs a certificate — an EV one, realistically, to clear
SmartScreen immediately — at a few hundred dollars a year. Until that is worth
it, the warning is the honest cost of an unsigned build. Automatic updates work
regardless: electron-updater only verifies a publisher when there is one to
verify. The warning simply returns with each update's installer.

**`productName` and `executableName` are pinned in `electron-builder.yml`,** not
left to default. electron-builder falls back to the package `name` for the
executable, and this package is `@mplus/desktop`, which it sanitises to
`@mplusdesktop` — the exact string the window must not announce itself as. A
packaged build reports `WM_CLASS=mplus-logs`, which is what window rules match.

## Automatic updates

`electron-updater` reads the feed the packaging run already produces —
`latest.yml` / `latest-linux.yml` beside the installers, and `app-update.yml`
inside the app pointing at this repo's releases. `src/main/updater.ts` holds the
policy; the strip at the bottom of the key list is the whole UI.

**A tag does not ship an update.** `publish.releaseType` is `draft`, and the
client resolves the newest version through the public `releases.atom` feed,
which does not list drafts. So the workflow attaching installers to a draft is
invisible to every installed copy until the release is **published** — which is
the intent, but it does mean clicking Publish is the step that ships, not
pushing the tag.

**Only two of the four targets can update themselves.** The NSIS installer
replaces itself and the AppImage rewrites its own file. The portable `.exe`
installs nothing, so there is nothing to replace, and the `.deb` belongs to
dpkg — electron-updater's deb path shells out to `sudo`/`pkexec`, which is not
something a combat log viewer should ask for. Those two builds still check the
feed and link to the releases page instead; `capability()` is that decision and
the UI renders from it rather than guessing.

**The check is automatic, the download is not.** `autoDownload` defaults to on,
which means a 110 MB pull starting by itself while someone is mid-key, against
the same connection the game is using. Nothing downloads until it is asked for,
and once downloaded `autoInstallOnAppQuit` applies it on the next quit rather
than interrupting a run. The startup check is delayed eight seconds so it never
competes with opening a log, and `settings.json` in userData remembers it being
turned off.

**`MPLUS_UPDATE_LOG=1` turns the updater's own logging back on.** It is off by
default — in a packaged app it writes to a stdout nobody is reading — but it is
the only way to see which release the feed resolved and why a check decided what
it did, the same escape hatch `MPLUS_OFFLINE=1` is for icon fetching.

**A failed check is only an error if someone asked.** No network, a timeout or a
rate-limited API on the startup check resolves to silence; the same failure
after clicking Check for updates is reported, because there someone is waiting
for an answer. The `error` listener is not optional either way — `AppUpdater` is
an `EventEmitter`, and an unhandled `error` event would take the process down.

**electron-updater is bundled, not externalized.** It is a `devDependency` so
`externalizeDepsPlugin` bundles it into `out/main/index.js` along with the
workspace packages, which keeps the "no runtime dependencies" property above
intact: the asar is still the build output and `package.json`, with nothing for
the packager to trace. The bundle grows by about 570 KB.

**The updater's cache directory needed the `productName` treatment too.**
electron-builder derives it as `sanitize(name) + "-updater"` with no option to
set it, and this package is `@mplus/desktop` — so left alone the updater creates
`@mplusdesktop-updater` in `%LOCALAPPDATA%`. `extraMetadata.name` in
`electron-builder.yml` overrides the packaged manifest's name before any of
those paths are derived, which makes it `mplus-logs-updater`. `app.getName()` is
unaffected, because Electron reads `productName` first.

## Licensing and fan content

This project is MIT licensed. That covers the code in this repository and
nothing else — three other parties' work is involved and none of it is
redistributed here.

**Blizzard.** *World of Warcraft* and its combat logs, spell, class and dungeon
names, and icon art are the property of Blizzard Entertainment. This is an
unofficial fan project, not affiliated with or endorsed by Blizzard, made under
their [Fan Content Policy][fan]. It reads logs the user's own client wrote, and
the icon art it draws is fetched to that user's machine at runtime (see
`## Icons`) rather than shipped in this repository or in a release.

Three tables are derived from Blizzard's own game data: the enemy-forces table
in `packages/data/src/enemy-forces.ts` (see `## Enemy forces` above), the
defensive-spell list in `packages/data/src/defensives.ts` and the inert-spell
list in `packages/data/src/markers.ts` (see `## Defensives`). All three hold
numeric ids and amounts and nothing else — no creature or spell names, no
descriptions, no art, no game text, the dungeons' own names being the one
exception — and all three are regenerated from the current patch by a script in
`scripts/` rather than copied from anywhere.

**Mythic Dungeon Tools** is GPL-2.0, which is why none of its data is in this
repository. It is read from the user's own install at runtime for one cosmetic
field, the dungeon teleport spell whose icon is the dungeon's art; the forces
values it used to supply now come from Blizzard's criteria data instead. The
long version is under `## Enemy forces` above.

**Wowhead** serves the icon lookups. That traffic is the only network access
this app makes, it is driven by ids out of the user's own log, and it happens at
most once per icon per machine. `MPLUS_OFFLINE=1` turns it off entirely.

[fan]: https://www.blizzard.com/en-us/legal/fan-content-policy

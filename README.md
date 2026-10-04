# wow-mplus-logs

Combat log analysis for Mythic+ keys. Desktop-first, because live-tailing a key
in progress needs filesystem access a browser cannot have.

MIT licensed — see [LICENSE](LICENSE). Downloads for Linux and Windows are on
the [releases page](../../releases); `## Building a release` below covers making
them yourself.

## Layout

```
packages/parser/    portable combat log engine — bytes in, columnar events out
packages/analysis/  segmentation, damage/healing breakdowns, death post-mortems
apps/desktop/       Electron shell: worker-thread parsing, live tail, React UI
packages/data/      enemy-forces tables and the MDT reader
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

## Enemy forces ("count"), and why MDT is read rather than bundled

A key is not finished until the party has killed enough trash: the enemy-forces
bar, which players call **count**. The combat log does not carry it. Every event
says who hit whom for how much; none of them says that killing a Ritual
Chieftain moves the bar by 25 of the 817 Altar of Fangs asks for. That mapping
lives in the game's scenario criteria, and the only practical community source
for it is [Mythic Dungeon Tools][mdt].

**MDT is GPL-2.0.** Bundling its tables — or a JSON file generated from them —
would make this app a GPL-2.0 derivative work. The obligations attach to
*distribution*, so the app instead reads the copy already on the user's disk:
nothing of MDT's is redistributed, and a user without MDT gets a build with no
forces data rather than a build that cannot legally be handed to them.

It is also the better engineering answer. MDT ships updates within days of a
patch; a table baked into a release would be stale by the second week of a
season and would need a release of its own to catch up.

The reader lives in two halves. `packages/data` parses MDT's Lua from a string
and stays browser-portable; `apps/desktop/src/main/mdt.ts` is the part that
touches the filesystem. It finds MDT **next to the log being read** —
`<install>/_retail_/Interface/AddOns/MythicDungeonTools`, derived from
`<install>/_retail_/Logs/WoWCombatLog-*.txt` — because someone with a live and a
PTR install has two MDTs at different versions and the right one is the one
belonging to the client that wrote the log.

[mdt]: https://github.com/Nnoggie/MythicDungeonTools

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

That does mean dungeon art arrives with the forces table and is absent for the
same reason a count is: no MDT beside the log. The key selector falls back to
the dungeon's initials, so those rows still read as deliberate rather than
broken.

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
both an instance id and a challenge-mode id, and only the second appears in MDT
(`mapInfo[dungeonIndex].mapID`). Ruby Life Pools is challenge-mode 399 and
instance 2521; joining on the wrong one matches nothing at all. Confirmed on
real logs: Voidscar Arena 585, Altar of Fangs 588, Den of Nalorakk 586, Murder
Row 587, The Blinding Vale 584 — all matching MDT exactly.

**The Lua is read by brace depth, not by indentation or by regex alone.** The
fields that matter (`id`, `count`, `name`, `isBoss`) sit at one known depth,
while `spells` and `clones` — the bulk of every file, and the parts whose shape
churns — nest deeper and are skipped wholesale. Doing it by indentation would
break the first time MDT reformats; doing it by plain regex reads a clone's
`["id"]` as a creature. The scanner was checked against a real Lua interpreter
on all sixteen current dungeon files and agrees on every npc id, forces value,
boss flag, name, map id and total.

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
- **`_SUPPORT` is credit, not damage.** Augmentation Evoker rows duplicate the
  plain events hit for hit — 38.0M on both sides in a real log — so summing both
  inflates every total. They are tracked as credit, and `creditSupport` moves the
  amount from dealer to supporter, leaving the run total unchanged.
- **`SWING_DAMAGE_LANDED` is not extra melee.** It is the same hits from the
  victim's side. Totals use `SWING_DAMAGE`; the LANDED rows serve only death
  analysis, where their advanced block carries the victim's health.
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
npm run report -- <log> [n]   # segments, breakdowns and death post-mortems
npm run ui-smoke -- <log> [n] # server-render every view against a real run
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

**Mythic Dungeon Tools** is GPL-2.0 and is read from the user's own install at
runtime for exactly that reason — the long version is under `## Enemy forces`
above.

**Wowhead** serves the icon lookups. That traffic is the only network access
this app makes, it is driven by ids out of the user's own log, and it happens at
most once per icon per machine. `MPLUS_OFFLINE=1` turns it off entirely.

[fan]: https://www.blizzard.com/en-us/legal/fan-content-policy

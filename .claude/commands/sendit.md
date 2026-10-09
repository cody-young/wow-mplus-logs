---
description: Bump the version, commit, tag, push, write patch notes, and publish the draft release
argument-hint: "[patch|minor|major|X.Y.Z]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(node:*), Read, Edit
---

Ship a release of this repo end to end. Bump argument: `$ARGUMENTS` (may be empty).

## 1. Preflight

- Must be on `main`, up to date with `origin/main` (`git fetch` then compare). Stop if behind or diverged.
- If the working tree has uncommitted changes, look at the diff, and commit them first as their own
  conventional commit (`feat(scope): …` / `fix(scope): …`, matching `git log` style) — never fold
  feature work into the release commit. If the changes look unfinished or unrelated, stop and ask.
- Run `npm run check:pure`, `npm run typecheck`, and `npm test`. Stop on any failure and show the output.

## 2. Pick the version

- Last release: `git describe --tags --abbrev=0`. Commits since: `git log <tag>..HEAD --oneline`.
- If there are no commits since the last tag, stop: nothing to ship.
- `$ARGUMENTS` of `patch`/`minor`/`major`/`X.Y.Z` wins. Otherwise: any `feat` → minor, else patch.
  Never pick major on your own.

## 3. Bump and commit

- Set the new version in **both** `package.json` and `apps/desktop/package.json` (the release
  workflow fails if the tag and `apps/desktop/package.json` disagree).
- `npm install --package-lock-only --ignore-scripts` so `package-lock.json` records only those two
  version changes. Check `git diff --stat` touches exactly those three files.
- Write the patch notes (see below), then commit as `chore(release): X.Y.Z` with the notes as the
  body, followed by a blank line and
  `Root and desktop manifests move together; the lockfile records only those two.`
  and the Co-Authored-By trailer.
- `git tag vX.Y.Z`, then `git push origin main` and `git push origin vX.Y.Z`.

### Patch notes

Written for players, not developers: what changed for them, in plain sentences, from the commits
since the last tag (read the diffs when a subject line is not enough). A short paragraph, or a few
bullets when there are several unrelated changes. New things first, then fixes. No commit hashes,
file names, or internal refactors that change nothing a user sees. Match the tone of recent
`chore(release)` commit bodies (`git log --grep='chore(release)' -3`).

## 4. Wait for the build

- Find the Release run for the tag (`gh run list --workflow release.yml --limit 3`), then
  `gh run watch <id> --exit-status` (run in the background; Windows and Linux are serialized,
  ~8–10 min).
- If it fails, stop and show the failing job's log (`gh run view <id> --log-failed`). Do not publish.

## 5. Publish

- Confirm the draft exists with all assets: `.deb`, `.AppImage`, `-portable.exe`, `-setup.exe`,
  `.blockmap`, `latest.yml`, `latest-linux.yml` (`gh release view vX.Y.Z --json isDraft,assets`).
  If anything is missing, stop.
- `gh release edit vX.Y.Z --notes-file <notes> --draft=false --latest`.
  Publishing is what ships the update to installed copies — the draft is invisible to them.
- Report the release URL and the version shipped. Mention any older releases still left as drafts
  (`gh release list`), but do not touch them.

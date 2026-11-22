# Release notes

Mira was called Syn3h until the release that renamed it, after v26.11.2206. Notes for versions released as Syn3h keep that name in their heading and GitHub title (`LAST_SYN3H_VERSION` in `tools/release-notes.mjs`); every later version is headed "## Mira vX".

Mira uses the calendar versions, release notes and GitHub releases of the owner's Freed and
Vorteo projects (decided 14 November 2026, `ops/DECISIONS.md`). The GitHub releases tell the
story of the build: one release per chapter, from the first plan to the latest public
release.

## Versions

A version is `v` + `YY.M.DDBB` in Pacific time. YY is the year, M the month and D the day,
with no zero padding. BB is the build of that day, two digits counting from 00.

| Version | Meaning |
|---|---|
| v26.11.1400 | 14 November 2026, first build of the day |
| v26.11.1413 | 14 November 2026, fourteenth build |
| v26.11.100 | 1 November 2026, first build |
| v27.1.100 | 1 January 2027, first build |

The rules are pure functions in `tools/lib/release-version.mjs`, tested by
`node --test tools/lib/release-version.test.mjs`.

## Two channels

- **milestone**: a tagged build that ran on a private preview, or for the first two, never
  ran anywhere (a plan, and the foundation before the first preview link). It was not
  released publicly, and its notes must never suggest it was.
- **production**: a build deployed to https://mira.cc/ by `tools/release.sh`. It also
  has a `release-N` tag, and a row in `../Syn3h-stable/releases.tsv`.

## The history file

`release-notes/history.tsv` lists every version, oldest first. It is the source of versions;
`releases.tsv` stays the source for which builds were deployed. Columns, tab separated:

| Column | Example | Notes |
|---|---|---|
| version | v26.11.1412 | |
| milestone tag | m13.1-steering | the tag the build is cut from |
| commit | ee73e41 | |
| Pacific time | 2026-11-14 19:08 PST | milestones: the tag's commit time; production: when it went live, from `releases.tsv` |
| channel | production | `milestone` or `production` |
| preview | no | optional, default yes: whether a milestone ran on a private preview |

The tool checks that each version falls on the day of its time, that versions and times
only rise, that builds of a day run 00, 01, 02 with no gaps, and that every production row
has a deployed build in `releases.tsv` and the other way round.

The fourteen chapters of 14 November 2026:

| Version | Tag | Channel |
|---|---|---|
| v26.11.1400 | m00-proposal | milestone, no preview |
| v26.11.1401 | m01-foundation | milestone, no preview |
| v26.11.1402 | m02-first-playable | milestone |
| v26.11.1403 | m03-mira-buggy | milestone |
| v26.11.1404 | m04-mira-lobby | milestone |
| v26.11.1405 | m05-king-of-the-hill | milestone |
| v26.11.1406 | m06-island | milestone |
| v26.11.1407 | m07-demo-features | milestone |
| v26.11.1408 | m08-sound-and-spiral-road | milestone |
| v26.11.1409 | m10-nextgen-buggy-golden-hour, with m09-resume-and-ops | milestone |
| v26.11.1410 | m11-rc1 | milestone |
| v26.11.1411 | m12-sticky-lava-planets | milestone |
| v26.11.1412 | m13.1-steering, with m13-night-glow-camera (release-1) | production |
| v26.11.1413 | m14.2-release2, with m14 and m14.1 (release-2) | production |

m14.3-fixes and m14.4-fixes are unshipped candidates and have no version.

## The tool

```sh
node tools/release-notes.mjs next                      # the version for a build made now
node tools/release-notes.mjs versions                  # the history, with release-N for production
node tools/release-notes.mjs draft <version> <from-tag> <to-tag>
node tools/release-notes.mjs render <version> [--assets <dir>]
node tools/release-notes.mjs publish <version> [--assets <dir>] [--latest] --dry-run
node tools/release-notes.mjs publish <version> [--assets <dir>] [--latest] --yes-publish
```

`next` counts past the highest build of the day in `history.tsv`, local `v*` tags and the
notes files. After the fourteen above it prints v26.11.1414 for a build later on 14 November
and v26.11.1500 for one on the 15th.

`versions` reads `../Syn3h-stable/releases.tsv` to pair production rows with `release-N`; set
`MIRA_RELEASES_TSV` to read it from elsewhere, for example in a worktree.

`draft` needs the version's row in `history.tsv` first. It writes
`release-notes/releases/<version>.md` with the sections for its channel and the git log
between the two tags inside an HTML comment. It will not replace a file without `--force`.

`render` prints the GitHub release body. It strips HTML comments and refuses notes that are
not in the shape below, still say TODO, contain an en or em dash, or use a word the wording
rule forbids. With `--assets` it adds the screenshots from that directory's manifest.

`publish` makes the public GitHub release on `terran-labs/syn3h`. It refuses to run without
`--yes-publish`; `--dry-run` prints the commit, the assets, every command and the rendered
body, and changes nothing. A release is not marked Latest unless `--latest` is given, so
publishing a run of versions in order leaves the one you choose on top. A real run:

1. Stops if a manifest file is missing or empty, a file in the directory is not in the
   manifest, the version's commit is not in the repository, an existing `v` tag points
   anywhere but the history's commit, a production version does not match `releases.tsv`,
   or a GitHub release for the version already exists.
2. Creates the annotated tag `v<version>` on the history's commit if it does not exist.
3. Pushes that tag, then runs `gh release create` with the title `Mira v<version>`, the
   rendered body, `--latest` or `--latest=false`, and the manifest's files.
4. Checks that every uploaded file's public download URL answers 200.

## Notes files

`release-notes/releases/v<version>.md`, in Freed's shape adapted to a game. Published release notes carry no "(AI Generated)" line
(the owner's exception for release notes, `ops/DECISIONS.md`); `render` strips one left in an
older source file. Other prefaces remain invalid; the heading, deck and section checks are unchanged.

```markdown
## Mira v26.11.1412

A one line deck naming the most meaningful outcomes, as X, Y and Z

Public release at 7:08pm Pacific on 14 November 2026, live at https://mira.cc/.

### The story so far   required, always first
### Features           required
### Fixes              optional
### Handling           optional: the handling report's top table (npx tsx tools/handling-report.ts)
### Play               production only: https://mira.cc/ and the controls that matter
### Known issues       optional: as they were true of that build when it was made
```

The line under the deck is written by the tool from the history row and checked exactly:

- production: `Public release at <time> Pacific on <date>, live at https://mira.cc/.`
- milestone: `Milestone build at <time> Pacific on <date>. It ran on a private preview and was not released publicly.`
- milestone with preview `no`: `Milestone build at <time> Pacific on <date>. It was not released publicly.`

**The story so far** is three to six plain sentences about that stretch of the day: what
was decided, what went wrong, what changed direction. It is the part a reader comes for.
Tell it from the record: the git log and commit bodies between the previous tag and this
one, the tag messages, `ops/DECISIONS.md`, `ops/STATE.md`, the history of
`ops/KNOWN-ISSUES.md`, `docs/PROPOSAL.md`, `docs/ROADMAP.md` and the role briefs. No hype, no
invented drama, no quotations attributed to anyone, no names of people, and no names of the
earlier projects the game descends from or the engine they used.

Check that a change is in a build with `git merge-base --is-ancestor <commit> <tag>`: work is
often committed on a branch before an earlier tag and merged after it, and release branches
take cherry picked fixes only. Leave out anything the record does not support.

Wording: tag beams, never lasers, fire, shoot, weapon, hit or kill. Vehicles get stuck in
lava; they are never destroyed. No death or violence. Where a tag message used a forbidden
word, rephrase it. Plain sentences, no dashes as punctuation.

## Screenshots

Notes files do not list images. `render --assets <dir>` and `publish --assets <dir>` build the
`### Screenshots` section from `<dir>/manifest.json`, which the capture worker writes:

```json
{ "images": [{ "file": "01-lobby.png", "caption": "The lobby" }], "gif": "mira-showcase.gif" }
```

The GIF, when there is one, comes first. Each image is embedded with its caption as alt text
and the caption on a line beneath. A version with no images and no GIF (v26.11.1400 is a
plan, with nothing to see) gets no Screenshots section, and publishes without `--assets` or
with an empty manifest. `manifest.json` itself is not uploaded.

## Player digests

Players read the published notes through Updates in About, and those notes are written for
the record: test counts, measurements, process. So each production release also has a short
digest written for players, in `release-notes/player/v<version>.md`:

```markdown
Grapple cords drape over hills instead of cutting through

- The Grapple cord follows the ground over ridges and crests instead of passing through them.
- The cord's ends stay where it hooked on.
```

- The first line is a one-line summary under 70 characters. It also appears in the update
  banner.
- Then two to five `- ` bullets of what a player will notice, and nothing else. No test
  counts, no process, no internal names (Daydream, Inspector, the lanes).
- Never invent a feature. If a release changed nothing a player would notice, the summary
  is "Behind-the-scenes fixes." with two bullets naming the areas made more reliable.
- The published notes stay as they are; the digest sits beside them.

`tools/release-feed.mjs` builds `/releases.json` from the digests for the game, and each entry
links its full notes on GitHub. A release without a digest shows its notes' summary line
only, never the notes. A build with `MIRA_RELEASE_VERSION` set (as `tools/release.sh` does)
fails unless that version has a digest in this shape, so write and commit the notes and the
digest before tagging and building a release.

## Replacing the first two GitHub releases

The first two GitHub releases were published as v26.11.1400 (release-1) and v26.11.1401
(release-2). Under the history those versions are now m00 and m01, and release-1 and
release-2 are v26.11.1412 and v26.11.1413. Until the old releases and tags are gone,
`publish` stops on v26.11.1400 and v26.11.1401 because their tags point at the old commits.
For the Foreman, after review:

```sh
gh release delete v26.11.1400 --repo terran-labs/syn3h --yes --cleanup-tag
gh release delete v26.11.1401 --repo terran-labs/syn3h --yes --cleanup-tag
git tag -d v26.11.1400 v26.11.1401
```

Then publish v26.11.1400 to v26.11.1413 in order, with `--latest` on v26.11.1413 only.

## Typical release

0. Write and commit the player digest for the version about to ship (see Player digests);
   the release build stops without it.
1. `tools/release.sh <n> "note"` ships the release (with the hook below, it also adds the
   history row, tags the version and drafts the notes).
2. Rewrite the draft as shipped behaviour and write its story, then commit both files.
3. Capture the GIF and stills from the frozen build into one directory with its manifest.
4. `node tools/release-notes.mjs publish <version> --assets <dir> --latest --dry-run`, read
   it, then run it again with `--yes-publish`.

## Hook for tools/release.sh

The release script computes the calendar version before freezing the build. That label
appears in the lobby and in the frozen build metadata. After successful public network
checks, the script records the history row, creates the calendar tag and drafts notes.
It then captures the showcase from the frozen build.

Drafting and capture failures print warnings without failing a release that is already
live. Their logs and partial artifacts are retained for repair. The hook never publishes
the notes or images; review them before publication. The history row and draft leave the
release checkout dirty so they can be reviewed and committed together.

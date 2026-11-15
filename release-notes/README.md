# Release notes

Syn3h production releases use the calendar versions, release notes and GitHub releases of
the owner's Freed and Vorteo projects (decided 14 November 2026, `ops/DECISIONS.md`).

## Versions

A production release is `v` + `YY.M.DDBB` in Pacific time. YY is the year, M the month and D
the day, with no zero padding. BB is the build of that day, two digits counting from 00.

| Version | Meaning |
|---|---|
| v26.11.1400 | 14 November 2026, first build of the day |
| v26.11.1401 | 14 November 2026, second build |
| v26.11.100 | 1 November 2026, first build |
| v27.1.100 | 1 January 2027, first build |

The `release-N` tags stay. `tools/release.sh`, `tools/rollback.sh` and `tools/domain.sh` use
them, and `../Syn3h-stable/releases.tsv` is keyed by them. Each release has both: the
calendar version is the public name.

| Release | Version | Milestone | Commit | Shipped |
|---|---|---|---|---|
| release-1 | v26.11.1400 | m13.1-steering | ee73e41 | 14 November 2026, 7:08pm PST |
| release-2 | v26.11.1401 | m14.2-release2 | bc8cb48 | 14 November 2026, 8:07pm PST |

The rules are pure functions in `tools/lib/release-version.mjs`, tested by
`node --test tools/lib/release-version.test.mjs`.

## The tool

```sh
node tools/release-notes.mjs next                      # the version for a release made now
node tools/release-notes.mjs versions                  # every known version, with its release-N
node tools/release-notes.mjs draft <version> <from-tag> <to-tag>
node tools/release-notes.mjs render <version>          # the GitHub release body
node tools/release-notes.mjs publish <version> --assets <dir> --dry-run
node tools/release-notes.mjs publish <version> --assets <dir> --yes-publish
```

`next` and `versions` read local `v*` tags, the files in `release-notes/releases/` and
`../Syn3h-stable/releases.tsv` (set `SYN3H_RELEASES_TSV` to read it from elsewhere, for
example in a worktree). Builds count past the highest one used that day in any of them.

`draft` writes `release-notes/releases/<version>.md` with the sections in place and the git
log between the two tags inside an HTML comment. It will not replace an existing file
without `--force`.

`render` strips HTML comments and refuses notes that are not in the shape below, still say
TODO, or contain an en or em dash.

`publish` makes the public GitHub release on `terran-labs/syn3h`. It refuses to run without
`--yes-publish`. With `--dry-run` it prints the commit, the assets, every command it would
run and the rendered body, and changes nothing. A real run:

1. Stops if a screenshot the notes link is missing from the assets directory, if there is
   no commit for the version, or if the version tag and `releases.tsv` disagree.
2. Creates the annotated tag `v<version>` on the release's commit if it does not exist,
   using the commit recorded in `releases.tsv`.
3. Pushes that tag, then runs `gh release create` with the title `Syn3h v<version>`, the
   rendered body and every file in the assets directory.
4. Checks that every asset's public download URL answers 200.

## Notes files

`release-notes/releases/v<version>.md`, in Freed's shape adapted to a game:

```markdown
(AI Generated)

## Syn3h v26.11.1401

A one line deck naming the most meaningful outcomes, as X, Y and Z

### Features
### Fixes
### Play          https://www.syn3h.com/ and the controls that matter
### Known issues  as they were true of that release when it shipped
### Screenshots   syn3h-showcase.gif first, then the stills
```

Write them from the record, not from memory: the git log between the previous release and
this one, the milestone tag messages, `ops/KNOWN-ISSUES.md` as it stood at the ship time,
`ops/STATE.md` and `releases.tsv`. Check that a change is in the release's own commit with
`git merge-base --is-ancestor <commit> <release commit>`: releases are cut from a tag and
take cherry picked fixes, so trunk work after the tag is not in them. Leave out anything
the record does not support.

Wording: tag beams, never lasers, fire, shoot, weapon, hit or kill. Vehicles get stuck in
lava; they are never destroyed. No death or violence. Plain sentences, no dashes as
punctuation, no hype.

Screenshots are uploaded as assets of the release itself, so their links have the form
`https://github.com/terran-labs/syn3h/releases/download/v<version>/<name>`. The stills are
`lobby.png`, `buggy-volcano.png`, `wings-glide.png`, `bots-pursuit.png`, `tag-beam.png`,
`jet-flight.png`, `hovercraft-lava.png`, `lava-night.png`, `king-of-the-hill.png` and
`other-world.png`, captured from that release's frozen build.

## Typical release

1. `tools/release.sh <n> "note"` ships the release (with the hook below, it also tags the
   version and drafts the notes).
2. Rewrite the draft in `release-notes/releases/` as shipped behaviour and commit it.
3. Capture the GIF and stills from the frozen build into one directory.
4. `node tools/release-notes.mjs publish <version> --assets <dir> --dry-run`, read it, then
   run it again with `--yes-publish`.

## Hook for tools/release.sh

Not applied. Proposed for the Foreman to review. It computes the version before the new row
is written to `releases.tsv` (otherwise `next` would count the new release twice), tags it
beside `release-<n>`, and drafts notes from the previous release. A failed draft warns and
never fails a release that is already live. Nothing is pushed.

```diff
--- a/tools/release.sh
+++ b/tools/release.sh
@@
 # --- Record ---------------------------------------------------------------------------------
 WHEN="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')"
+# Calendar version (release-notes/README.md), read before this release's row is added.
+CALVER="$(node tools/release-notes.mjs next)" || fail "could not compute the calendar version"
+PREV="$(tail -1 ../Syn3h-stable/releases.tsv 2>/dev/null | cut -f1)"
 printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "release-$N" "$WHEN" "$URL" "$MILESTONE" "$COMMIT" "$VERSION" "$ID" >> ../Syn3h-stable/releases.tsv
 git tag -a "release-$N" -m "release-$N: $NOTE ($URL, version $VERSION)"
+git tag -a "$CALVER" -m "Syn3h $CALVER (release-$N, $MILESTONE)"
+node tools/release-notes.mjs draft "$CALVER" "${PREV:-m00-proposal}" "release-$N" \
+  || echo "Warning: could not draft release notes for $CALVER; run tools/release-notes.mjs draft by hand."
 echo
-echo "RELEASE OK: release-$N is live at $URL"
+echo "RELEASE OK: release-$N ($CALVER) is live at $URL"
 echo "For ops/RELEASES.md:"
-echo "- release-$N, $WHEN: $URL from $MILESTONE ($COMMIT), Worker version $VERSION, frozen copy $ID. $NOTE"
+echo "- release-$N ($CALVER), $WHEN: $URL from $MILESTONE ($COMMIT), Worker version $VERSION, frozen copy $ID. $NOTE"
```

The draft leaves the working tree dirty after the release, which is the point: the next
step is to rewrite and commit it. The decision also says the release script should write
the version into the build file; the lobby label comes from `git describe --tags` in
`vite.config.ts`, which runs before the version tag exists, so that part needs its own
change in `vite.config.ts` or `tools/promote-stable.sh` and is not in this patch.

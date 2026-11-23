# Why "syn3h" still appears

The game was called Syn3h until the release that renamed it to Mira (decided by the owner on
22 November 2026). Everything a player or a reader of the code sees says Mira. A short list of
names says Syn3h on purpose, because each belongs to something outside the repository, goes
over the wire, or is history. This page lists them with the reason and what changing each
would take.

The rename was applied by `tools/rename-to-mira.mjs`, whose keep-list is the authoritative
version of this page. `node tools/rename-to-mira.mjs --check` lists every remaining "syn3h"
(any case) with the rule that explains it, and fails if one is unexplained.

## Wire and stored identifiers

| Name | Where | Why it stays | To change it |
| --- | --- | --- | --- |
| `buggy-syn3h` | `shared/protocol.ts` `VEHICLE_KINDS`, resume state, `?vehicle=` | The default vehicle kind. Players send it to each other and the room server relays it; pages already open on an older build must keep understanding a new player's buggy. | Add a new kind beside it, ship, wait until no older build can join a room, then retire the old one. Probably never worth it: players never see this string. |
| `x-syn3h-version` | `server/worker.ts`, `tools/frozen-versions.mjs` | Response header on frozen versions, checked by release tooling. Not player-visible. | Send both headers from the Worker for one release, then switch the checks. |

## Outside systems (rename at or after the mira.cc switch)

| Name | Where | Why it stays | To change it |
| --- | --- | --- | --- |
| Worker `syn3h`, `syn3h-staging` | `wrangler.toml`, `wrangler.staging.toml` | A new name is a new Worker: new workers.dev addresses, and a new, empty Durable Object namespace, so every live room and stored world is gone. | Not needed for mira.cc: a custom domain attaches to the existing Worker. |
| `syn3h.af-4e7.workers.dev`, `syn3h-staging.af-4e7.workers.dev` | `tools/release.sh`, public check, STATE | The addresses of those Workers. | Follow the Worker names. |
| Durable Object binding `ROOMS`, class `RoomDO` | `wrangler.toml` | Carry no product name. | Nothing to do. |
| R2 bucket `syn3h-versions` | `wrangler*.toml`, `tools/frozen-versions.mjs` | Holds every frozen version that `?v=` serves. | Create a new bucket, copy every object, switch the binding, verify each version, delete the old bucket. No player benefit. |
| `syn3h.com`, `www.syn3h.com` | release tooling, public check, invite links, `server/worker.ts` frozen links | The live domain. | The mira.cc switch. |
| `terran-labs/syn3h` | GitHub links, `tools/release-notes.mjs`, Actions | The repository's address. | The owner renames the repository; GitHub redirects the old address. Then update the links. |
| `~/.config/syn3h/cloudflare-token` | `tools/cloudflare-token.sh` | The owner's token file, outside the repository. | Move the file and update the default path in one change. |
| `/Users/vtn/dev/Syn3h`, `../Syn3h-stable`, `Syn3h-wt` | release tooling, `paseo.json`, docs | Folders on disk that other tools and agents depend on. | Move the folders and every reference together, on a quiet day. |
| `/tmp/syn3h-*`, above all `/tmp/syn3h-heavy-v2` | `tools/heavy.py`, release tooling, checks | Shared with older worktrees. If the trunk's heavy root moved while older copies kept the old one, release holds would stop holding anyone. | Move once no worktree runs an older copy of the tools. |
| `paseo.json` | Vorteo preview services | Edited by the Foreman on its own branch; its `SYN3H_*` variables still work through the bridge below. | Rename the variables in its commands when convenient. |

## Legacy names kept for one month (remove after 22 December 2026)

- **Environment variables.** Every `SYN3H_<X>` is now `MIRA_<X>`. Scripts read the new name and
  fall back to the old one through one small bridge per language: `tools/lib/legacy-env.mjs`,
  `tools/lib/legacy-env.sh` and `tools/legacy_env.py`. Each copies `SYN3H_<X>` to `MIRA_<X>`
  when `MIRA_<X>` is unset, so harnesses outside the repository keep working.
- **Window hooks.** `window.syn3h` and `window.syn3hNet` read through to `window.mira` and
  `window.miraNet`, assigned in one place, `src/core/legacyWindowNames.ts`.
- **Older pages driven by new tools.** The rollback, public and mixed-version checks can drive a
  build from before the rename, which has only `window.syn3h`. `tools/lib/legacy-page-names.mjs`
  makes `window.mira` read the old hook on such a page. Keep it while a pre-rename release can
  still be rolled back to.
- **Copied world settings.** Settings copied from the inspector before the rename carry
  `"syn3h": "world"`; pasting them still works.

## Not migrated

Browser storage keys (`syn3h.quality.v2`, `syn3h.savedWorlds.v1`, `syn3h.playerName` and the
rest) were renamed to `mira.*` without migration, by the owner's decision: every player starts
once with fresh preferences.

## History

Never renamed: published release notes and player digests for versions released as Syn3h,
their tags and GitHub release titles, frozen version pages, `ops/DECISIONS.md`, handoffs, lab
briefs, `docs/CUTOVER.md` (the record of the syn3h.com cutover), the inventory of the original
Syn3h Unity source, and mentions of the original Syn3h game that this one was ported from.
`ops/STATE.md` is the Orchestrator's to update.

## Pending the new logo

`src/ui/brand/` and the dashboard's logo picture change when the owner picks the Mira wordmark
(branch `brand/mira-logo`).

## Rerunning the rename before the release

Branch from main. Cherry-pick the rename tool's commits from `ops/rename-mira` (the tool and its
bridges, the bytecode cleanup, the Worker-name keep rule), run `node tools/rename-to-mira.mjs`
and commit its output on its own, then cherry-pick the hand fixes. Set `LAST_SYN3H_VERSION` in
`tools/release-notes.mjs` to the last version released as Syn3h; `--check` fails until it is
right. For the domain switch, follow with `ops/mira-domain`'s commits the same way, running
`node tools/rename-to-mira.mjs --domain` in place of its output commit.

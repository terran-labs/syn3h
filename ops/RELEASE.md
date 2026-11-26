# Release protocol: beta first, production on the owner's approval

Set by the owner on 25 November 2026: "We should also now introduce beta versus production
releases for Mira. The next release after this one should be a beta and should not go prod until
I physically approve it for production release. You should add beta.mira.cc for testing beta
builds." It applies to every release after v26.11.2500.

## The two steps

1. **Beta.** The Orchestrator assembles the train on the Foreman's word, runs the train's checks,
   then `tools/ship.sh <n> "note" --beta` (gap, dry run, load gate, then `tools/release.sh <n>
   "note" --beta`). That freezes the build, deploys the frozen copy unedited to the staging
   Worker, checks it there (settle, frozen versions, full two-player smoke) and at
   https://beta.mira.cc/ (certificate, socket, short public check), and records it in
   `release-notes/betas.tsv` (version, milestone, commit, time, frozen id; commit it with the
   beta's record). Production is
   not touched and no production tag is made. The Orchestrator tells the Foreman the version and
   the frozen id; the Foreman tells the owner.
2. **Promote.** Only when the Foreman relays the owner's approval of that version in their own
   words: `tools/ship.sh <n> "note" --promote <frozen-id> --approved <version> --approval "<the
   owner's words>"` (gap and load gate, no dry run, no build). release.sh refuses unless the
   version named is the version inside that frozen copy, the copy shipped as a beta, and
   production has not moved on since the beta was built. It deploys that same frozen copy to
   production, runs the public checks on both addresses, rolls back by itself on any failure,
   and records the owner's words beside the version in `../Syn3h-stable/approvals.tsv`. Then the
   usual record steps (notes time, STATE.md, push main and the three tags, the hosted check,
   publish the notes).

No rebuild between beta and production: the bytes the owner approved are the bytes that ship.

## Rules

- **Versions** are v26.11.DDnn, fixed when the beta is built and promoted unchanged, even on a
  later day. A beta that fails the owner's test is superseded by the next beta number; a
  version number is never reused for different bytes.
- **The beta is the build itself.** The page and the Worker tell beta from production by the
  hostname they are served on (robots and noindex, the beta mark by the version, invites and the
  share card on beta.mira.cc, an Updates notice that never sends testers to production). Nothing
  in the frozen copy is edited for beta. `--staging` (a check-only deploy) still marks its copy
  "[staging]" with a robots file; a beta never does.
- **The owner plays on beta.mira.cc.** Every beta deploy resets occupied beta rooms: tell the
  Foreman before one goes out, so the owner is not dropped mid-test. Automated checks use their
  own room names; a check that fills the public room (the full-room look) runs on a local Worker
  only, never on beta.mira.cc.
- **The fingerprint.** A beta records a sha256 over everything its frozen copy would deploy: each
  file under dist/, both wrangler configs, and the Worker script wrangler bundles from the copy's
  own server code (which takes in the dependencies and bundler too, since a frozen copy links the
  checkout's node_modules). Promote recomputes it and refuses on any difference, so nothing can
  change between the owner's test and production without the tool noticing. Promote deploys
  from the frozen copy itself (its wrangler.toml, server/ and shared/), never from the checkout.
- **Secrets.** A Worker secret is declared in the config's `[secrets] required = [...]` (wrangler
  supports it). Every deploy checks the target Worker has each declared secret first and stops,
  with nothing deployed, if one is missing. A beta checks both Workers, so a new secret must be
  set on production and on staging before the beta that needs it. New bindings and vars are in
  the frozen copy's config and travel with it; a new resource such as an Analytics Engine dataset
  is created by Cloudflare on first write.
- **Beta hosts are checked as they serve.** The beta Worker rewrites https://mira.cc/ in HTML and
  plain text to its own origin and marks HTML noindex, on beta.* and every workers.dev address
  (production's own workers.dev name included). The checkers (tools/lib/served.mjs) compare what a
  host serves against the frozen bytes with that same rewrite on beta hosts, and require noindex;
  production hosts stay byte for byte.
- **Resume, never redeploy.** If a beta's staging deploy happened but its checks or record did not,
  `tools/release.sh <n> "note" --beta --resume <frozen-id> --fingerprint <hash>` (the id and hash
  printed by the failed run) runs only the missing steps against that same copy. It refuses unless
  staging serves exactly that id and the copy still fingerprints to that hash. No second deploy,
  no second room reset, the same version for the same bytes.
- **No direct production release.** A plain `tools/release.sh <n> "note"` (or `--immediate`)
  builds and ships straight to production; it is refused unless `MIRA_DIRECT_RELEASE=<reason>`
  is set, and that is set only on the Foreman's explicit word. The reason is recorded beside the
  release in `../Syn3h-stable/approvals.tsv` as "DIRECT: <reason>".
- **Hotfix.** A fault that breaks production still goes through beta: ship the fix as a beta,
  and the owner may approve it in minutes. The Foreman relays the approval in the owner's own
  words as usual.

## Addresses

- Production: https://mira.cc/ (Worker `syn3h`). <!-- rename-keep: the Worker name -->
- Beta: https://beta.mira.cc/ (Worker `syn3h-staging`, its own rooms; Custom Domain attached on
  25 November 2026 with `MIRA_DOMAIN_WORKER=syn3h-staging tools/domain.sh attach beta.mira.cc
  --owner-approved --zone mira.cc`; rollback from the zone export
  `../Syn3h-stable/dns/20261125-133916-mira.cc`).

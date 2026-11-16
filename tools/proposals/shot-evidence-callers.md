# Proposed caller integration

Implemented in this isolated worktree for source review only. The adjacent patch records the approved caller changes; root callers and historical wrappers remain untouched. It supersedes the fixed log-prefix paths proposed in the earlier shot-evidence contract: repeated release invocations reuse those prefixes.

## File fence and call map

Implementation fence: tools/release.sh, tools/domain.sh and tools/rollback.sh, plus focused mocked coverage in the existing tools/release-hooks.test.mjs. No smoke/helper changes, supervisor, release wrapper, waits, assertions, deployment logic or automatic retry changes.

Four direct call sites exist: release normal (local dry run or workers.dev), release latency (dry only), domain check (validated apex or www host), and rollback verification. Release primary acceptance delegates to domain.sh. Domain attach also delegates to the same domain check. Domain rollback restores DNS and has no smoke invocation. The inspected root copies of all three scripts are byte-identical to this isolated worktree; hashes are pinned alongside the patch.

The preserved train-1519 deploy and retry wrappers call prepared release script copies, then the vehicle matrix, and invoke rollback.sh after a failed acceptance. Those prepared copies contain the same normal/latency call sites but different log prefixes. They remain historical artifacts and are not patched. A future approved wrapper must use the revised caller source or a freshly reviewed copy derived from it; applying this proposal does not retrofit archived scripts. No new wrapper is proposed.

## Unique evidence reservation

Immediately before each smoke invocation, mktemp -d atomically reserves a private external parent. The absent child named evidence is supplied through a command-local environment assignment. net-smoke exclusively creates that child itself. Normal, latency, domain host and rollback prefixes identify the stage; randomness supplies uniqueness independently of release number, dry/deploy mode, retry label or inherited environment. The caller logs the exact path next to its existing target. No directory is reused or removed, including on failure. Existing smoke diagnostics contain the target URL; evidence paths introduce no credentials.

Allocation failure stops before the smoke subprocess. Release/domain use their existing failure functions. Rollback explicitly reports that deployment occurred but verification could not start and exits nonzero. The unchanged outer wrapper then retains its existing rollback-verification failure behavior.

Normal and latency marker pipelines remain identical apart from the command-local environment. Domain filtering and success-marker check remain identical. Rollback retains its direct Node exit-status branch. The accepted smoke implementation withholds NET SMOKE OK on incomplete evidence and exits nonzero. No failed original verdict is rescued. This proposal activates collection at those callers only if separately approved and applied; direct default smoke behavior remains unchanged.

## Bounded mocked validation plan

After implementation and a separate allocation, extend the existing release-hooks tests using their actual-script-slice and PATH-stub approach. Do not execute full release, DNS or deployment bodies. Stub node and mktemp; constrain fixture paths to one temporary test directory. No real browser, network, server or wrangler process.

- Extract the actual four smoke blocks, with explicit unique boundary assertions. Execute each twice with the same release/log inputs. The stub smoke enforces absolute fresh evidence child creation. Assert eight distinct paths, stage/host distinction, parent exists and child is initially absent; an inherited fixed evidence path must be overridden.
- Simulate success, a nonzero smoke result with no success marker, and incomplete evidence with no success marker. Release/domain must fail their original marker checks; rollback must preserve its original exit-status failure branch. Exercise failure with FAIL output so grep success cannot hide it.
- Make mktemp fail. Assert no node invocation and a nonzero caller result for every block. Preserve logs and failure messages.
- Keep existing primary acceptance and rollback propagation cases. Add a mocked outer-wrapper branch check only if an implementation changes that wrapper; none is proposed here.
- Run the existing release-hooks suite with the accepted 24 helper and 14 integration cases in one separately allocated pure gate, using the reviewed supervisor, a fresh evidence directory, 60 seconds execution and 15 seconds cleanup. Record exact hashes and observed-process closure. First failed gate stops without fixes or retries.

Proposed test command after those tests are implemented and reviewed:

```sh
node --test tools/release-hooks.test.mjs tools/shot-evidence.test.mjs tools/shot-evidence-integration.test.mjs
```

The mocked cases are now prepared in release-hooks.test.mjs. Syntax and whitespace checks pass; no tests or caller execution have been performed. A pure mocked gate cannot establish real public gameplay behavior or explain historical failures. Any browser validation or release remains a separate decision.

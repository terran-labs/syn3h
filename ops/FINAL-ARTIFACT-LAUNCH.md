# Final artifact launcher boundary

Source plan for review. No command in this document has been executed. The existing
release script still uses the mutable checkout uploader and must not promote a build.
The final artifact inspector and observation gate are necessary but insufficient.

## Smallest command surface

Use one coordinator-owned launcher for local serving, dry-run validation and production
upload. It accepts an inspected final directory and independently reviewed tool identity;
it does not accept arbitrary Wrangler arguments or an inherited environment object.
The application directory remains immutable and contains only the reviewed final format.
The execution-layout proposal below supersedes running directly from that directory.

The installed Wrangler deploy command supports --no-bundle. Its bin wrapper forwards
process.execArgv to a child; invoke the reviewed CLI entry directly with the reviewed Node
binary and fixed arguments instead. There is no proposed --no-build flag. Custom build
commands are already rejected by exact configuration validation.

All operations specify --config and --no-bundle. Dry-run adds --dry-run and a fresh
external output directory. Local serving adds --local, loopback IP and an explicitly
allocated port. Production adds only reviewed release tag/message and the existing
cutover mode. No environment, compatibility, binding, route, asset or script override
may be supplied as an extra argument.

## Environment and file inputs

Construct the child environment from an allowlist, not process.env. Remove NODE_OPTIONS,
NODE_PATH, CLOUDFLARE_ENV, Wrangler API-environment overrides, custom workerd/esbuild
paths and proxy variables unless separately reviewed and bound. Authentication values
are passed only to production/API operations and never included in logs or digests.
The account identifier is a separately reviewed target, not inferred from a mutable cache.

Installed Wrangler global middleware loads dotenv files even for ordinary commands.
Pass --env-file pointing to an inspected empty regular file outside the artifact; do not
rely on dev-variable flags to disable this global loading. For local serving also set
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false and CLOUDFLARE_INCLUDE_PROCESS_ENV=false.
The final artifact root rejects .env/.dev.vars and configuration redirect files.
Use a dedicated runner home/config/cache directory so account profiles and global
configuration cannot be inherited from the owner's normal environment. Record the
nonsecret environment, cwd, exact arguments and empty env-file digest in the receipt.

## Tool identity and qualification

The identity must cover the actual Node binary, Wrangler CLI and its effective runtime
package/native dependencies. A version string, package lock or hash of only the entry
script is insufficient. Prepare a separate tool snapshot before measurement; preserve
its manifest and verify all selected bytes immediately before each operation. Do not
claim dependency completeness from a hand-written list. The snapshot layout and
transitive package/native closure still need a bounded implementation review before
this launcher is operational. This is tool provenance, separate from game artifact identity.

First validate command/environment construction with synthetic tests. Then allocate one
real no-bundle dry run and compare its executable module bytes to the inspected Worker.
Reject extra modules, rewritten bytes, configuration mismatch and unexpected asset
selection. Local serving must consume that same inspected configuration and module.
Neither a successful dry run nor a bundle-size match establishes deployed-byte identity.

Immediately before production upload, repeat artifact and tool checks. After upload,
fetch the recorded version's actual module content and configuration metadata through
the existing authenticated read path. Compare exact Worker bytes and reviewed effective
bindings, compatibility, migrations and assets behavior. Any mismatch fails acceptance
and invokes the existing release rollback flow. Exact public client bytes, both network
smokes, frozen checks and the vehicle matrix remain required independently.

## Remaining review decisions

Confirm the smallest reproducible tool snapshot closure and its preparation mechanism.
Confirm the exact sanitized environment needed by installed Wrangler without hidden
credential/config discovery. Then implement the pure command planner and runner in
coordinator-owned release tooling, followed by independently allocated dry-run parity.
No production deployment, baseline measurement or installation is authorized by this plan.

## Reviewed snapshot preparation boundary

The first package snapshot will copy the entire resolved node_modules directory as a
conservative superset. Copying the checkout's node_modules symlink is not a snapshot.
Preserve relative package topology, native binaries and data files; manifest each path,
node type, mode, file bytes and symlink target. Reject special files and links that
resolve outside the snapshot. Include the final artifact inspector and its parser.
Verify the snapshot after copying and before use; no npm, npx, install or build may run
during measurement or upload. Package lookup must not fall back to ancestor directories.
This chooses simple preparation over a custom dependency resolver, not minimal disk use.

Node preparation remains a separate blocker. The installed Homebrew executable links
external libnode and other Homebrew libraries, so copying or hashing that executable
alone cannot establish a self-contained runtime. A proposed self-contained distribution
must first receive version, origin and native-link review. Alternatively, retaining the
current runtime requires a reviewed resolved native-library inventory, OS build binding
and rechecks, explicitly described as external dependencies. Neither option is selected
or installed by this document. Pure command construction can proceed while operational
launch remains blocked on that reviewed identity.

The command planner must reject hostile inherited argv/environment, escaping links,
changed tool identities and unreviewed output/port/tag fields in synthetic tests. Those
tests cannot substitute for actual no-bundle output parity, local consumption or deployed
module/configuration verification.

## Execution mirror proposal after scratch-path review

Installed Wrangler derives .wrangler/tmp from the configuration project root and defaults
local persistence to .wrangler/state. HOME, TMPDIR and changing cwd alone do not protect
the frozen artifact. The current pure planner is therefore not ready for an executor.

Proposed layout: create a fresh runner/project directory containing ordinary copied files
for the complete inspected artifact, preserving relative paths and configuration bytes.
No hard links or links back to the accepted snapshot. Independently inspect this copy and
require the same artifact digest before execution. Use runner/project as cwd and select
its absolute wrangler.json; select runner/state explicitly with local --persist-to.
Wrangler scratch remains under runner/project/.wrangler. Every operation, including dry
run and upload, uses this layout to avoid relying on undocumented scratch-free behavior.

The immutable source artifact is checked before and after. The execution copy's original
files must also remain byte-identical; only the exact reviewed scratch subtree may be
added. Do not broaden the artifact inspector to ignore arbitrary new files. Inspect the
original selected files and a separate complete post-run inventory, rejecting other
additions, symlinks or modifications. Scratch is not part of the uploaded asset root.
The preparer must reject pre-existing runner/project, runner/state and scratch paths.

Configuration bytes stay unchanged, so worker and asset paths resolve to equivalent
copied content. This is a proposed equivalence argument, not runtime proof. A separately
allocated no-bundle dry/local check must verify actual upload selection, module bytes and
filesystem side effects before this layout can be accepted. No executor or copy operation
is authorized by this source-plan update; pure planner changes follow source review.

Complete-copy verification must additionally bind provenance, excluded maps and empty
directories, with path/type/mode checks where relevant. The runtime artifact digest omits
some of these and cannot prove complete-copy equality. Verify source/copy file inode
independence and nonsymlink runner ancestors. Postinventory rejects removals or changes
to every original entry and additions outside the exact reviewed scratch subtree. Never
follow scratch symlinks or permit scratch to reach dist. These are preparer/executor
requirements; the pure planner performs no filesystem qualification.

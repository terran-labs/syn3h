# Final artifact launcher boundary

Source plan for review. No command in this document has been executed. The existing
release script still uses the mutable checkout uploader and must not promote a build.
The final artifact inspector and observation gate are necessary but insufficient.

## Smallest command surface

Use one coordinator-owned launcher for local serving, dry-run validation and production
upload. It accepts an inspected final directory and independently reviewed tool identity;
it does not accept arbitrary Wrangler arguments or an inherited environment object.
The application directory remains immutable and contains only the reviewed final format.
Run from that directory with its absolute wrangler.json path explicitly selected.

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

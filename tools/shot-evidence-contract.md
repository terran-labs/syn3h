# Optional shot evidence in network smoke

`MIRA_SHOT_EVIDENCE_DIR` explicitly enables the additional collector. Unset preserves the original smoke checks, values, waits and output. Set it to a fresh absolute external directory whose parent exists. Empty, relative or existing paths fail before browser launch. The directory is exclusively created; evidence is written to `shot-evidence.json`.

Example opt-in invocation, only under an allocated bounded runtime slot:

```sh
MIRA_SHOT_EVIDENCE_DIR=/tmp/syn3h-shot-run-001 node tools/net-smoke.mjs https://mira.cc/
```

Use the existing reviewed supervisor for runtime and observed-process cleanup. This option does not launch a server, retry a failure or deploy anything.

## Preserved contract

The helper is copied byte-for-byte from the collector that passed 24 pure tests and one browser integration run. Its test file is also unchanged. The repository option passed 24 helper and 14 mocked integration tests. Its real-browser composition and the new caller integration require separate validation.

Both six-attempt loops and their local-counter triggers remain. Human 600 ms and bot 500 ms delays remain. These are post-local delays, not a single wall-clock verdict deadline. Original score/audio samples retain their call order and values. With the option enabled, the existing evaluations capture helper snapshots in the same task as each original value. No additional pre-verdict evaluate or wait is introduced. Instrumentation can still perturb scheduling.

The helper records attempted send invocations, not transport delivery. It requires the same emitted shooter/shot/victim in the local report attempt and the remote accepted/applied hit, plus a fresh sound invocation synchronously within that actual hit callback. Text/audio/send wrappers preserve receiver, arguments, return and exceptions. Human score must remain exactly baseline plus one; the bot has no new score requirement. Duplicate and unrelated messages cannot supply missing evidence.

Original verdicts are retained. Additional matched-evidence checks can only reject, never rescue a recorded failure. Score is frozen at its original score evaluation; sound is frozen at Bob's original audio evaluation. Later evidence does not revise either result. Browser monotonic clocks are not compared across pages to claim network latency. The audio spy proves invocation, not audible playback.

## Evidence and cleanup

Failed verdicts persist available frozen samples. Finally persists an initial partial receipt and collects Alice and Bob's human/bot phases with the reviewed concurrent 1500 ms collection bound and 128-event snapshot cap. Missing, timed-out, truncated, overflowed or failed capture and any write failure make `evidenceComplete` false. Carol is not instrumented. Nested browser cleanup remains mandatory; the external supervisor provides the overall bound. A failed write means an older file cannot certify acceptance.

Evidence contains shot identities, score/audio samples and collection status, not connection hello/resume credentials. Keep the caller's base URL free of credentials or secret query parameters, as the existing smoke logs that URL.

## Release caller behavior

`tools/release.sh` invokes `node tools/net-smoke.mjs "$URL"` and checks the `NET SMOKE OK` marker while masking pipeline exit status. Therefore opt-in evidence failure must both exit nonzero and withhold that marker. Default output is unchanged. Root release callers remain unchanged; only this isolated branch contains the caller opt-in implementation.

The isolated caller implementation now reserves a unique mktemp parent for each normal, latency, domain and rollback smoke invocation, then passes its absent evidence child. This supersedes the earlier fixed log-prefix path proposal, which would collide when a release number is reused. Root callers and historical wrappers are untouched. See proposals/shot-evidence-callers.md for the exact file fence and pending mocked validation.

## Prepared mocked integration gate

The adjacent integration test runs the actual smoke imports, option validation, evidence collection, finalization, marker and exit code in bounded subprocesses with mocked browser and filesystem dependencies. It replaces only the long gameplay scenario body with fixture results. It does not validate gameplay or real browser integration.

Fourteen prepared cases cover default behavior, complete opt-in evidence, capture errors, missing clients and phases, truncation, overflow, write failure, collection timeout, browser-close rejection, an original gameplay failure, and invalid output paths. Failure cases require a nonzero result and no success marker. The helper and smoke source remain unchanged. All 14 integration cases and 24 helper cases passed the allocated combined pure gate on the preceding commit; the new caller tests have not run.

Proposed combined pure gate, only after allocation through the reviewed bounded supervisor:

```sh
node --test tools/shot-evidence.test.mjs tools/shot-evidence-integration.test.mjs
```

This combines the 24 previously accepted helper cases with 14 new integration cases. Each fixture subprocess has a five-second timeout; the collection-timeout case retains the actual smoke collection bound. No real browser, network or server is used.

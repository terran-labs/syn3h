# Optional shot evidence in network smoke

`SYN3H_SHOT_EVIDENCE_DIR` explicitly enables the additional collector. Unset preserves the original smoke checks, values, waits and output. Set it to a fresh absolute external directory whose parent exists. Empty, relative or existing paths fail before browser launch. The directory is exclusively created; evidence is written to `shot-evidence.json`.

Example opt-in invocation, only under an allocated bounded runtime slot:

```sh
SYN3H_SHOT_EVIDENCE_DIR=/tmp/syn3h-shot-run-001 node tools/net-smoke.mjs https://www.syn3h.com/
```

Use the existing reviewed supervisor for runtime and observed-process cleanup. This option does not launch a server, retry a failure or deploy anything.

## Preserved contract

The helper is copied byte-for-byte from the collector that passed 24 pure tests and one browser integration run. Its test file is also unchanged. This repository opt-in composition has only received syntax and whitespace checks; it still needs separately allocated pure/default/opt-in integration validation.

Both six-attempt loops and their local-counter triggers remain. Human 600 ms and bot 500 ms delays remain. These are post-local delays, not a single wall-clock verdict deadline. Original score/audio samples retain their call order and values. With the option enabled, the existing evaluations capture helper snapshots in the same task as each original value. No additional pre-verdict evaluate or wait is introduced. Instrumentation can still perturb scheduling.

The helper records attempted send invocations, not transport delivery. It requires the same emitted shooter/shot/victim in the local report attempt and the remote accepted/applied hit, plus a fresh sound invocation synchronously within that actual hit callback. Text/audio/send wrappers preserve receiver, arguments, return and exceptions. Human score must remain exactly baseline plus one; the bot has no new score requirement. Duplicate and unrelated messages cannot supply missing evidence.

Original verdicts are retained. Additional matched-evidence checks can only reject, never rescue a recorded failure. Score is frozen at its original score evaluation; sound is frozen at Bob's original audio evaluation. Later evidence does not revise either result. Browser monotonic clocks are not compared across pages to claim network latency. The audio spy proves invocation, not audible playback.

## Evidence and cleanup

Failed verdicts persist available frozen samples. Finally persists an initial partial receipt and collects Alice and Bob's human/bot phases with the reviewed concurrent 1500 ms collection bound and 128-event snapshot cap. Missing, timed-out, truncated, overflowed or failed capture and any write failure make `evidenceComplete` false. Carol is not instrumented. Nested browser cleanup remains mandatory; the external supervisor provides the overall bound. A failed write means an older file cannot certify acceptance.

Evidence contains shot identities, score/audio samples and collection status, not connection hello/resume credentials. Keep the caller's base URL free of credentials or secret query parameters, as the existing smoke logs that URL.

## Release caller behavior

`tools/release.sh` invokes `node tools/net-smoke.mjs "$URL"` and checks the `NET SMOKE OK` marker while masking pipeline exit status. Therefore opt-in evidence failure must both exit nonzero and withhold that marker. Default output is unchanged. The release script itself is not modified or automatically opted in.

Proposed caller diff for separate approval, if release opt-in is wanted:

```diff
-node tools/net-smoke.mjs "$URL" 2>&1 | tee "$LOG-smoke.log" | grep -E "^(FAIL|NET SMOKE)" || true
+SYN3H_SHOT_EVIDENCE_DIR="$LOG-shot-evidence" node tools/net-smoke.mjs "$URL" 2>&1 | tee "$LOG-smoke.log" | grep -E "^(FAIL|NET SMOKE)" || true
-node tools/net-smoke.mjs "http://127.0.0.1:$PROXY_PORT/" 2>&1 | tee "$LOG-smoke-latency.log" | grep -E "^(FAIL|NET SMOKE)" || true
+SYN3H_SHOT_EVIDENCE_DIR="$LOG-shot-evidence-latency" node tools/net-smoke.mjs "http://127.0.0.1:$PROXY_PORT/" 2>&1 | tee "$LOG-smoke-latency.log" | grep -E "^(FAIL|NET SMOKE)" || true
```

Each proposed directory must be fresh and external; a caller retry needs a new output identity. Do not export one fixed directory across multiple smoke invocations. These caller changes are proposals only.

# Observation evidence extension proposal

Status: review proposal only. No live contract, comparator, collector or tests change
with this document. Existing schema v1 lacks enough underlying observations to establish
its qualification flags. Adopt an explicit v2 envelope after review; do not silently
reinterpret archived v1 data. Existing v1 historical reports remain renderable, but a
future measurement gate must require v2 observation evidence.

Recovered 1518 Worker bytes have now been independently accepted by the Foreman.
That acceptance does not cover full artifact/configuration identity, local serving,
collector behavior or a baseline measurement. Those prerequisites remain held.

## Hash graph and trust boundary

Proposed additions to the exact contract, in TypeScript notation for JSON values:

```ts
type Digest = string; // lowercase SHA-256 hex, 64 characters
type Ref = { sha256: Digest; kind: ObservationKind };
type ObservationKind = 'runtime' | 'requests' | 'clocks' | 'frames' |
  'pacing' | 'startup' | 'conditions' | 'closure';
type ObservationArtifact = { schemaVersion: 1; kind: ObservationKind; payload: object };

// Add to each v2 Run; keep run.id, scene, pair, side and existing metric inputs.
observations: {
  runtime: Ref; requests: Ref; clocks: Ref; frames: Ref;
  pacing: Ref; startup: Ref; conditions: Ref; closure: Ref;
};
// Add to top-level v2 Evidence, shared by calibration and comparison runs.
observationArtifacts: Record<Digest, ObservationArtifact>;
// Add to separately reviewed Expectations.
observationPolicySha256: Digest;
runtimePolicySha256: Digest;
// Embed these policies in Evidence; their hashes must match Expectations.
observationPolicy: ObservationPolicy;
runtimePolicy: RuntimePolicy;
```

Each referenced artifact hashes its entire canonical JSON envelope, without any embedded
self hash. Runs reference those hashes; artifacts identify their run by run.id, not by
rawSha256. Existing run hashing then includes observation references but excludes only
rawSha256. Calibration includes runs and their observation references, not the complete
artifact map. Its hash binds those contents transitively; validation resolves and hashes
all referenced artifacts. There are no back references to calibration/evidence hashes.
Duplicate run IDs across calibration and comparison are rejected. Missing references,
kind mismatches, unresolved blobs or duplicate/conflicting records are nonpassing.

Archive `observation-<sha256>.json` as canonical UTF-8 bytes. Referenced byte blobs, such
as decoded response bodies, use `blob-<sha256>` with SHA-256 over actual bytes, not JSON.
The pure validator receives a coordinator-verified blob manifest `{sha256,size}`; the
coordinator reads or downloads each blob and verifies those bytes independently. A
submitted filename or boolean is not a verified blob manifest. Avoid duplicating large
asset bytes when the coordinator already holds the same content-addressed frozen file.

No hash authenticates a fabricated browser observation. Independent review must approve
the collector, runtime launch and endpoint mapping; the records make that procedure
inspectable. The observation policy is also not a release exception or performance
threshold. It defines methods and required predicates before collection.

## Reviewed policies

```ts
interface ObservationPolicy {
  schemaVersion: 1;
  frameSource: 'game.last-and-quality.frame';
  startupMethod: 'navigation-to-observed-usable-play';
  transferMethod: 'cold-completed-resource-encoded-body-bytes';
  sampleRoundingMs: 0.002; utcRoundingMs: 1.002;
  requiredPredicates: Array<'playing' | 'connected' | 'input-enabled' |
    'not-materializing' | 'not-kinematic' | 'rendered' | 'input-response'>;
  requiredResourcePaths: string[];
  allowedDynamicRoutes: Array<{ path: string; purpose: 'room' | 'presence' | 'status' }>;
  phaseConditionFields: string[]; // explicit exhaustive fixture fingerprint fields
}
interface RuntimePolicy {
  schemaVersion: 1;
  collectorManifestSha256: Digest; browserExecutableSha256: Digest;
  nodeExecutableSha256: Digest; workerRuntimeExecutableSha256: Digest;
  launchArguments: string[]; environmentSha256: Digest;
  baselineDeploymentManifestSha256: Digest; candidateDeploymentManifestSha256: Digest;
  // Exact shape and identity method of deployment manifests remain coordinator-owned.
}
```

Policies cannot loosen existing sample-rounding rules, allow ignored failed requests,
turn unavailable bytes into zero or waive missing startup predicates. Fixture policy
must name the full frozen application resource set and intentional dynamic endpoints.
Optional CPU/GPU instrumentation stays out of this initial extension.

## Original clocks and frame source

```ts
// clocks payload
{
  runId: string,
  runOrigin: { utcMs: number, hostMonotonicMs: number },
  pages: Array<{
    pageId: string, navigationId: string, timeOriginMs: number,
    anchors: Array<{
      performanceBeforeMs: number, dateNowMs: number, performanceAfterMs: number,
      hostSendMonotonicMs: number, hostReceiveMonotonicMs: number
    }>
  }>
}
// frames payload
{
  runId: string,
  phases: Array<{
    kind: 'warmup' | 'steady' | 'transition', pageId: string, navigationId: string,
    leftBoundary: { sequence: number, gameLastMs: number },
    samples: Array<{
      sequence: number, gameLastMs: number, previousGameLastMs: number,
      metricFrameMs: number, callbackObservedMs: number, targetBudgetMs: number,
      hidden: boolean, qualitySnapshotId: string, conditionSnapshotId: string,
      gameTick: number, drawCalls: number
    }>,
    finalSequence: number
  }>,
  overflow: boolean,
  events: Array<{ pageId: string, navigationId: string, atMs: number,
    kind: 'page-error' | 'console-error' | 'renderer-error' | 'visibility' | 'clock-reset',
    detail: string }>
}
```

Store original performance.timeOrigin, performance.now and Date.now samples, not a
cumulative frameMs clock. Map page times to the run origin using
`at = timeOriginMs + gameLastMs - runOrigin.utcMs`. Preserve all operands. Recompute
Run Frame.at from those operands and Frame.frameMs from metricFrameMs.

For every phase, the left boundary is the preceding callback's original game.last.
Sequences are contiguous; previousGameLastMs must equal the prior original timestamp.
Each delta equals metricFrameMs within the existing rounding allowance. The first
sequence follows the left boundary and the final sequence supplies the phase end.
callbackObservedMs must not precede gameLastMs; it is diagnostic and never substitutes
for frame start. No hidden, discarded or overflowed callbacks may be silently removed.

Clock anchors bracket Date.now between two performance.now reads. Verify Date.now lies
within the interval obtained from timeOrigin plus those reads, allowing UTC rounding;
verify host send/receive order and overlap with the corresponding UTC mapping interval.
Require anchors before and after each navigation's observations. Reject backwards time,
clock resets, inconsistent mappings or mappings whose uncertainty prevents proving
ordering. Do not choose an arbitrary synchronization tolerance to make them pass.
Host/page absolute clock provenance and synchronization must be established in preflight.

## Blank controls and global serial execution

```ts
// pacing payload
{
  runId: string,
  before: ControlObservation, after: ControlObservation
}
interface ControlObservation {
  pageId: string; navigationId: string;
  initialCallbackMs: number; callbackTimesMs: number[];
  finalCallbackMs: number;
  visibilityEvents: Array<{ atMs: number; hidden: boolean }>;
  gamePagesOpen: string[]; // must be empty throughout, with page lifecycle log in closure
}
```

Derive each gap from consecutive callbackTimesMs, beginning at initialCallbackMs;
finalCallbackMs must equal the last included callback. Derive duration and UTC endpoints
through the clock mapping. Compare every derived value with the Run pacing fields,
then apply existing coverage and judgePacing checks. Controls need clock records too.
No game pages may remain active during controls. Check before/run/after envelopes for
global nonoverlap across all scenes, including calibration independently, with clock
uncertainty included conservatively. A list of alleged gaps without original callback
times is insufficient for v2.

## Request inventory and resource identity

```ts
// requests payload
{
  runId: string,
  source: { protocol: 'chromium-cdp', version: string },
  navigations: Array<{ pageId: string, navigationId: string,
    startMs: number, url: string, profileId: string }>,
  records: Array<{
    requestId: string, redirectIndex: number, pageId: string, navigationId: string,
    url: string, method: string, resourceType: string, initiatorRequestId: string | null,
    startedMs: number, responseMs: number | null, finishedMs: number | null,
    status: number | null, failure: string | null,
    frozenPath: string | null, decodedBody: { sha256: Digest; size: number } | null,
    headers: { contentType: string | null; contentEncoding: string | null;
      contentLength: string | null; etag: string | null },
    fromDiskCache: boolean, fromMemoryCache: boolean, fromServiceWorker: boolean,
    resourceTiming: { encodedBodySize: number; decodedBodySize: number;
      transferSize: number; responseEndMs: number } | null,
    chunks: Array<{ atMs: number; decodedBytes: number; encodedBytes: number }>,
    loadingFinishedEncodedBytes: number | null
  }>,
  sockets: Array<{ pageId: string; navigationId: string; url: string;
    openedMs: number; closedMs: number | null }>,
  recordingComplete: boolean, droppedEvents: number
}
```

Requests have unique (requestId, redirectIndex), valid navigation ownership and ordered
start/response/finish events. Preserve redirects, failures and dynamic requests, not
just successful asset downloads. Require complete event capture, zero dropped events
and no unexplained external origin, /src module or replacement application response.
Match decoded body digest/size to the coordinator-verified frozen resource manifest.
Verify required resources and the actual build.json body, not a claimed version string.
WebSocket origins and endpoint paths must match the isolated reviewed Worker mapping.
Keep only allowlisted diagnostic headers; never archive authorization/cookie material.

Encoded body bytes are not decoded file size or loadingFinished total, which can include
protocol overhead. Reconcile original dataReceived encoded body counts with Resource
Timing encodedBodySize for completed cold application resources. Retain both records;
if the browser cannot supply an unambiguous body count, report unavailable and block
that metric rather than use a guessed compression ratio. Cache responses may legitimately
have zero wire transfer but must not be counted as zero cold download without proof.

The initial transfer metric requires every counted cold application request to finish
by usable play and every required resource to be present. A resource in flight across
the endpoint makes this method unqualified; do not wait an invented quiet period or
silently count its full body beyond the endpoint. If the real fixture necessarily streams
across usable play, preflight must propose a different reviewed transfer window/method.
Dynamic room/status traffic and WebSocket frames are retained but excluded from the
explicit application-asset body metric. Publish its scope rather than call it all traffic.

## Startup, cache and usable-play records

```ts
// startup payload
{
  runId: string,
  entries: Array<{
    kind: 'cold' | 'warm', pageId: string, navigationId: string, profileId: string,
    navigationStartMs: number, playEventMs: number,
    cacheSetup: { freshProfile: boolean; httpCacheCleared: boolean;
      storageCleared: boolean; serviceWorkersBlocked: boolean;
      sourceEventIds: string[] },
    warmSourceNavigationId: string | null,
    observations: Array<{
      sequence: number, atMs: number, gameTick: number,
      playing: boolean, connected: boolean, inputEnabled: boolean,
      materializing: boolean, kinematic: boolean, drawCalls: number,
      inputEventId: string | null, inputState: object,
      bodyPosition: [number, number, number], bodyVelocity: [number, number, number]
    }>,
    inputEvents: Array<{ id: string; atMs: number; action: object }>,
    usableObservationSequence: number
  }>
}
```

Cold and warm must be distinct navigations in the declared order, with a fresh cold
profile and warm reuse of that same profile. Setup claims bind original browser-command
receipts via sourceEventIds in the closure log; verify cache flags and service-worker
observations in the actual request inventory. Cold does not mean a cold GPU/OS cache.

Resolve usableObservationSequence to an actual observation where all required predicates
hold together. Record the preceding observations and the causally prior input event;
verify input reaches the game and subsequent physics shows the fixture's declared
response, not a stationary held vehicle. The fixture must define that response before
collection, without inventing a performance threshold. Derive navigation-to-usable and
Play-to-usable intervals from these original times. Reject an endpoint before a required
predicate, missing input evidence, wrong vehicle/navigation, or claimed booleans that
contradict observed suspension/materialization. First frame alone never qualifies.

## Conditions and collector/runtime identity

```ts
// conditions payload
{
  runId: string,
  snapshots: Array<{ id: string; pageId: string; navigationId: string; atMs: number;
    values: Conditions; effectiveQuality: object; actualBackend: string;
    actorIdsAndKinds: Array<{ id: string; kind: string; local: boolean }>;
    playerPose: object; cameraPose: object; liquidKind: string | null;
    cameraWaterDepth: number | null; appliedInputEventId: string | null }>
}
// runtime payload
{
  runId: string, collectorManifestSha256: Digest, runtimePolicySha256: Digest,
  deploymentManifestSha256: Digest, beforeIdentitySha256: Digest, afterIdentitySha256: Digest,
  executables: Array<{ role: 'collector' | 'browser' | 'worker'; path: string;
    version: string; sha256: Digest; arguments: string[] }>,
  host: { hardware: string; os: string; powerMode: string; displayRefreshHz: number },
  endpoint: { origin: string; workerBundleSha256: Digest; effectiveConfigSha256: Digest },
  observationEvidence: Ref[] // only separately reviewed noncyclic runtime receipts, if needed
}
```

Runtime receipts must not reference themselves, another run or any ancestor artifact;
reject cycles. Prefer inlining small original receipts to avoid extra reference types.
Collector identity hashes the exact observer/orchestrator source manifest, not a branch
name. Browser and Worker runtime fingerprints and launch arguments must match reviewed
policy, including the final no-rebundle serving path. Pre/post identity must match the
approved deployment manifest. Local runtime equivalence to production remains a disclosed
limitation, not an assertion created by a matching client hash.

Every frame references condition/quality snapshots from that callback. Recompute
qualityStable, actor parity, visibility and the conditions fingerprint from these
records. Reject missing/stale snapshots, quality/backend/backing-size drift or unexpected
actor changes. Pose/input/water records must satisfy the fixture's original scene
postconditions; they cannot be selected after seeing the candidate. Dynamic pose fields
are not compared by exact equality to a static fingerprint.

## Lifecycle and closure evidence

```ts
// closure payload
{
  runId: string,
  events: Array<{ id: string; hostMonotonicMs: number;
    kind: 'command' | 'spawn' | 'page-open' | 'page-close' | 'process-exit' |
      'port-bind' | 'port-check';
    processId: number | null; processStartIdentity: string | null;
    pageId: string | null; port: number | null; detail: object }>,
  ownedProcessGroups: Array<{ leaderPid: number; startIdentity: string;
    descendants: Array<{ pid: number; startIdentity: string }> }>,
  finalProcessChecks: Array<{ pid: number; startIdentity: string; alive: boolean }>,
  finalPortChecks: Array<{ port: number; listening: boolean; ownerPid: number | null }>
}
```

Require matching spawn/exit and page-open/close records for every owned process/page;
PID start identity prevents reuse from masquerading as closure. Final checks occur
after teardown and show no owned survivor or listener on reserved ports. Validate
control periods against page lifecycle records. Process checks are host observations,
not proof that no unrelated machine workload existed; the coordinator still allocates
and enforces the serial slot. Preserve failed teardown and notify rather than killing
unowned processes. Never let cleanup failure disappear behind a passing metric status.

## Proposed adversarial synthetic cases, unrun

- Rehash a forged run aggregate while leaving its raw frame observation unchanged: reject.
- Substitute a response body, redirect, build.json or Worker/config identity: reject.
- Drop a failed request, reuse a request ID, omit a resource or claim complete capture
  with dropped events: reject against original inventory/completeness evidence.
- Claim gzip transfer using decoded bytes or loadingFinished overhead; truncate chunks,
  cross the usable-play endpoint, hide a cache hit or service worker: unavailable/nonpass.
- Invent warm navigation without cold predecessor, reuse another build's profile,
  claim usable play while suspended or before actual input response: reject.
- Alter timeOrigin, offset one callback, shift a startup event between navigations,
  omit a clock anchor or place wall time outside its monotonic bracket: reject.
- Supply plausible pacing gaps with contradictory callback timestamps, leave a game
  page alive, or overlap scene/control envelopes: reject.
- Repeat a stale condition snapshot through a quality change, change actor kinds,
  claim water crossing while actual depth never changes sign: reject.
- Tamper a blob/map/hash reference, introduce cycles or omit calibration observations:
  reject before comparison; no zero metrics or automatic waiver.
- Leave a browser descendant or port listener alive, or substitute a reused PID:
  mark collection incomplete and block acceptance even if frame statistics look good.
- Valid generated observations reproduce identical run aggregates, fingerprints and
  decisions without trusting submitted status/booleans; notes and PR share the report.

## Review decisions before any implementation

Confirm v2 upgrade and coordinator verified-blob input; settle the final deployment
manifest/configuration identity; choose how original command/protocol receipts are
archived and bound without sensitive fields. Resolve transfer endpoint feasibility and
startup input-response semantics in the fixture design. Approve clock anchoring and
runtime snapshot access before using them as evidence. No collector, comparator change,
test run or benchmark is authorized by this proposal itself.

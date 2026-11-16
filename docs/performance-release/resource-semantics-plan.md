# Minimal resource and response semantic stage

Background plan only. The owner has removed performance measurement as a release
blocker. Foreground delivery uses the coordinator's established path with honest
unmeasured notes. This document does not reinstate that gate, authorize execution or
require native-tool work to ship. Further implementation is held after this document.

The existing evidence tooling still must not label unqualified measurements qualified.
This proposed helper always returns qualified:false and promotion:blocked as a partial
tooling result, not as authority to override the owner's release decision.

## Scope and existing boundary

Use the approved v2 requests artifact, explicit references/blobs arrays and separately
coordinator-verified blob input. No new artifact kind or broad framework. Full graph
integrity validation precedes this stage. Resource semantics derive from original
request/response records; recordingComplete, droppedEvents, observedBuild and a claimed
body digest are not independently sufficient evidence.

Exclude transfer accounting, startup readiness, collector implementation, executable
provenance and serving changes. Runtime/configuration identity remains coordinator-owned.
Only cross-reference reviewed runtime/clock/fixture identities needed to identify the
right resources and navigation. A resource match is not proof of usable play or bytes
transferred over the network.

## Proposed typed boundary

The existing requests artifact payload.records narrows to:

```ts
type Digest = string;
type RequestKey = { sessionId: string; requestId: string; redirectIndex: number };
type BodyRef = { sha256: Digest; size: number };
interface ResourceRecords {
  schemaVersion: 1;
  capture: BodyRef; // canonical original protocol capture, declared in artifact.blobs
  runtimeRef: { kind: 'runtime'; sha256: Digest }; // declared in references, same run
  navigations: Array<{ pageId: string; navigationId: string; profileId: string;
    documentRequest: RequestKey; captureStartEventId: string; captureEndEventId: string }>;
  requests: Array<RequestKey & {
    pageId: string; navigationId: string;
    requestEventId: string; responseEventId: string | null;
    terminalEventId: string | null; bodyReceiptId: string | null;
    decodedBody: BodyRef | null;
  }>;
}
interface AllowedInventory {
  schemaVersion: 1; deploymentManifestSha256: Digest;
  resources: Array<{ path: string; decodedSha256: Digest; decodedSize: number;
    mediaTypes: string[]; allowedContentEncodings: string[] }>;
}
interface ResourcePolicy {
  schemaVersion: 1;
  allowedInventorySha256: Digest;
  requiredFetchedResources: string[];
  // Exact route table, independently reviewed for this frozen endpoint.
  routes: Array<{ origin: string; pathname: string; search: string; frozenPath: string }>;
  dynamicRoutes: Array<{ origin: string; pathname: string; purpose: 'room' | 'presence' | 'status' }>;
  captureMethod: 'chromium-cdp-response-body-v1';
}
interface VerifiedCapture {
  sha256: Digest; size: number;
  payload: {
    schemaVersion: 1; runId: string; method: 'chromium-cdp-response-body-v1';
    sessions: Array<{ sessionId: string; pageId: string; navigationId: string }>;
    events: Array<{ id: string; sessionId: string; ordinal: number;
      method: string; params: object }>;
    bodyReceipts: Array<{ id: string; request: RequestKey;
      responseEventId: string; decodedBody: BodyRef; commandEventId: string }>;
    recordingBoundaries: Array<{ sessionId: string; startEventId: string;
      endEventId: string; lastOrdinal: number }>;
  };
}
```

Proposed one pure entry point:

```ts
validateResourceResponses(requestArtifact, {
  observationPolicy, expectedObservationPolicySha256,
  resourcePolicy, // bound under observationPolicy.methods.resources
  allowedInventory, // matches observationPolicy.allowedFrozenInventorySha256
  expectedDeploymentManifestSha256,
  verifiedBlobs, verifiedCapture,
  requiredNavigationIds // independent fixture selection, not submitted subset
}) -> {
  qualified: false, promotion: 'blocked', issues,
  derived: null | {
    identityAvailable: boolean,
    matched: Array<{ request: RequestKey; navigationId: string; frozenPath: string;
      decodedBody: BodyRef; source: 'network' | 'disk-cache' | 'memory-cache' }>,
    requiredCoverage: Array<{ navigationId: string; fetched: string[]; missing: string[] }>,
    repeats: Array<{ navigationId: string; frozenPath: string; requests: RequestKey[] }>,
    unsupported: ['transfer', 'startup', 'cache-lifecycle', 'collector-authenticity',
      'conditions', 'closure', 'measurement-eligibility']
  }
}
```

The exact protocol methods/params adapter must be reviewed before implementation.
Raw protocol records are retained, not turned into a second invented browser protocol.
The coordinator verifies capture bytes and parsing before supplying VerifiedCapture;
the pure helper rehashes canonical payload, binds size/digest to the requests artifact
and resolves every event/body receipt against it. VerifiedCapture is separate trusted
input, not accepted merely because an evidence field has that name. Capture integrity
does not prove authenticity; approved collector behavior remains a prerequisite.

## Inventory versus fetched subset

Hash AllowedInventory and ResourcePolicy against the separately reviewed observation
policy and deployment manifest. Inventory entries have unique canonical paths and
matching content digest/size, including optional assets and carried historical builds.
RequiredFetchedResources is a distinct unique subset. Never require every carried build,
audio file or optional model to download during startup. Required navigation IDs come
from the fixture's independently approved collection inventory.

Each observed static URL resolves through the reviewed exact origin/path/query table.
Do not discard query strings, decode ambiguously, normalize traversal into an allowed
path or substitute a similar build. Reject unexpected origins and development /src
imports. Dynamic room/presence/status routes are identified separately and preserved;
they cannot satisfy a frozen-resource requirement. Runtime artifact binding establishes
which reviewed endpoint mapping applies, without redefining executable provenance here.

## Original request and response invariants

Resolve unique request keys and event IDs within their exact protocol session, page and
navigation. Events must have contiguous recorded ordinals within the declared capture
window; every application request event must appear once in the derived request inventory.
Conversely, no submitted request may lack original events. A missing capture boundary,
unknown session, duplicate ID, failed request, unresolved in-flight request or missing
terminal event prevents complete resource identity coverage for that navigation.

Redirect hops remain explicit with contiguous redirectIndex and linked original events.
Do not count a redirect response as the required final body. The final URL must resolve
to the reviewed route. A successful main document pointing at changed secondary resources
is not a matching artifact.

Initially support complete GET responses with status 200 and retrievable decoded bodies.
Reject errors, opaque responses, 204, partial 206 and unresolved 304 instead of inferring
content. Supporting partial reassembly or revalidated-cache bodies would require a later
bounded method review; it is not hidden inside this slice. The body receipt must bind
the original response/request identity and recorded body-retrieval command, with exact
bytes verified independently and declared in artifact.blobs.

Match decoded digest and size to AllowedInventory. Match observed Content-Type media
type and Content-Encoding to the reviewed policy, preserving original header values.
An absent encoding denotes identity only under the reviewed capture method. Duplicate
or contradictory security-relevant header values are ambiguous, not a guessed match.
Content-Length and ETag alone cannot prove identity; encoded wire length is not decoded
file size. No transfer-byte or compression-efficiency calculation belongs here.

Record disk/memory-cache and service-worker provenance from original protocol response
fields. Require method-specific evidence when a flag is unavailable; do not assume false.
Service-worker substituted responses are unsupported in this initial fixture. A cache
hit with independently verified decoded bytes may establish resource content identity,
but it never establishes cold-cache startup, actual network transfer or warm-cache reuse.
Those remain separate unsupported semantics. A cache hit without a bound body receipt
cannot satisfy required coverage.

Repeated fetches of the same path with different unique request keys are legitimate
observations and are reported, not silently deduplicated or automatically rejected.
Every repeat must resolve to the same reviewed content. Duplicate event/request keys
are invalid. The same path producing changed content within a run is invalid even if
one occurrence matched. Coverage requires at least one fully matched request per
required resource per required navigation; it does not certify when startup became usable.

## Adversarial case plan, no execution

- Valid inventory includes unfetched historical/optional assets while the required subset
  is fully fetched: identity may be available, qualification remains false.
- Omit one required resource/navigation, add a fetched path outside inventory or an
  unreviewed origin/query/source URL: reject.
- Rehash a submitted aggregate after altering URL/status/body but leave original events
  unchanged: reject the contradiction, not just validate the new aggregate hash.
- Delete a failed request from the summary, drop a protocol ordinal or omit capture end:
  reject completeness instead of certifying the remaining successful subset.
- Duplicate a request/event ID, borrow a receipt from another session/navigation/run,
  substitute an unverified blob or change its size: reject.
- A second legitimate request for identical content is reported; changed content under
  the same resource path fails. Redirects cannot hide a wrong final resource.
- Status 404 with matching-looking body, 206 fragment, unsupported 304, opaque or failed
  body retrieval never satisfy required coverage.
- Contradictory MIME/encoding, claimed gzip using decoded length, or ETag-only identity
  cannot self-certify a body; no transfer result is emitted.
- Cache flags altered versus protocol evidence, missing cache provenance or service-worker
  substitution fail. A matched cached body does not set cold/warm startup verified.
- Resource helper success with unsupported startup/transfer/runtime authenticity and
  closure remains explicitly partial and unqualified.

## Remaining review and hold

Review the protocol capture adapter shape, exact route policy and required navigation
inventory before implementation. Final tool/native/config provenance remains with the
coordinator. No collector, transfer model, startup predicate or benchmark allocation is
requested by this plan. Preserve this document and hold additional implementation under
the owner's revised foreground-delivery priority. Production notes may say unmeasured.

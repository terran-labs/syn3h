import type { Evidence, Expectations, Run, Issue, Sha256 } from './contract';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObservationKind = 'runtime' | 'requests' | 'clocks' | 'frames' |
  'pacing' | 'startup' | 'conditions' | 'closure';
export interface ObservationRef { sha256: Sha256; kind: ObservationKind }
export interface BlobRef { sha256: Sha256; size: number }
/** All graph edges are explicit here. Payload semantics remain unsupported. */
export interface ObservationArtifact {
  schemaVersion: 1;
  kind: ObservationKind;
  payload: { runId: string; records: { [key: string]: Json } };
  references: ObservationRef[];
  blobs: BlobRef[];
}
export type ObservedRun = Run & { observations: Record<ObservationKind, ObservationRef> };
export interface ObservationPolicy {
  schemaVersion: 1;
  frameSource: 'game.last-and-quality.frame';
  // Complete allowed inventory and required fetched subset are different identities.
  allowedFrozenInventorySha256: Sha256;
  requiredFetchedResources: string[];
  methods: { [key: string]: Json };
}
export interface RuntimePolicy {
  schemaVersion: 1;
  collectorManifestSha256: Sha256;
  baselineDeploymentManifestSha256: Sha256;
  candidateDeploymentManifestSha256: Sha256;
  executablesAndConfiguration: { [key: string]: Json };
}
export interface EvidenceV2 extends Omit<Evidence, 'schemaVersion' | 'runs' | 'calibration'> {
  schemaVersion: 2;
  runs: ObservedRun[];
  calibration: Omit<Evidence['calibration'], 'runs'> & { runs: ObservedRun[] };
  observationArtifacts: Record<Sha256, ObservationArtifact>;
  observationPolicy: ObservationPolicy;
  runtimePolicy: RuntimePolicy;
}
export interface ExpectationsV2 extends Expectations {
  observationPolicySha256: Sha256;
  runtimePolicySha256: Sha256;
}
/** Separate trusted input, populated only after coordinator verifies actual blob bytes. */
export interface VerifiedBlobs { [sha256: Sha256]: { size: number } }
export interface StructuralResult {
  schemaVersion: 2;
  structureValid: boolean;
  qualified: false;
  status: 'unsupported/not-qualified';
  promotion: 'blocked';
  issues: Issue[];
  unsupported: ['semantic-observation-validation'];
}
export declare const OBSERVATION_KINDS: readonly ObservationKind[];
export declare function validateV2Envelope(input: unknown, expected: ExpectationsV2,
  verifiedBlobs: VerifiedBlobs): StructuralResult;

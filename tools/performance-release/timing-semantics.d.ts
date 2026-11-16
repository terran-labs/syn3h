import type { ObservationArtifact, ObservationRef, RuntimePolicy } from './observation-v2';
export interface Interval { lo: number; hi: number }
export type SourceBounds = { mode: 'unavailable' } | {
  mode: 'bounded'; errorLoMs: number; errorHiMs: number;
  evidenceSha256: string; evidenceDescription: string;
};
export interface ClockProfile {
  schemaVersion: 1; hostClockId: string;
  environment: { [key: string]: string };
  monotonicRelation: 'unit-offset' | 'unavailable';
  epochRelation: 'constant-offset' | 'unavailable';
  sources: Record<'hostMonotonic' | 'hostEpoch' | 'pageMonotonic' | 'pageEpoch' | 'timeOrigin' | 'raf', SourceBounds>;
}
/** At runtimePolicy.executablesAndConfiguration.clockProfiles, bound by reviewed policy hash. */
export interface RuntimeClockRecords {
  clockProfileId: string; runtimePolicySha256: string;
  clockEnvironment: ClockProfile['environment'];
}
export interface PageKey { pageId: string; navigationId: string }
export interface ClockRecords {
  schemaVersion: 1; runtimeRef: ObservationRef; hostClockId: string;
  runOriginHostMs: number; runEndHostMs: number;
  hostEpochAnchors: Array<{ hostBeforeMs: number; utcMs: number; hostAfterMs: number }>;
  pages: Array<PageKey & { timeOriginMs: number; anchors: Array<{
    hostSendMs: number; pageBeforeMs: number; dateNowMs: number;
    pageAfterMs: number; hostReceiveMs: number;
  }> }>;
}
export interface ClockMaps {
  hostClockId: string; runId: string; runOriginHostMs: number; runEndHostMs: number; runCoverage: Interval | null;
  hostEpoch: Interval | null; hostEpochCoverage: Interval | null;
  sources: ClockProfile['sources']; profileId: string; runtimePolicySha256: string;
  pages: Record<string, PageKey & { offset: Interval | null; epoch: Interval | null; pageCoverage: Interval | null }>;
}
export interface PartialResult<T> {
  qualified: false; promotion: 'blocked'; issues: Array<{ code: string; message: string }>;
  derived: T | null;
}
export interface Callback {
  sequence: number; gameLastMs: number; metricFrameMs: number;
  callbackEntryMs: number; callbackExitMs: number; gameTick: number;
  hidden: boolean; paused: boolean; targetBudgetMs: number;
  qualityBeforeSnapshotId: string; qualityAfterSnapshotId: string; conditionSnapshotId: string;
}
export type PhaseKind = 'warmup' | 'steady' | 'transition';
export interface FrameRecords extends PageKey {
  schemaVersion: 1; callbacks: Callback[];
  phases: Array<{ kind: PhaseKind; requestedDurationMs: number; boundarySequence: number; finalSequence: number }>;
  events: Array<{ atMs: number; kind: string; detail: string }>;
  overflow: boolean; droppedCallbacks: number;
}
export interface DerivedPhase {
  kind: PhaseKind; arithmeticValid: true; physicalAvailable: boolean;
  boundarySequence: number; finalSequence: number;
  observedStartMs: number; observedEndMs: number; observedDurationMs: number;
  hostStart: Interval | null; hostEnd: Interval | null; observedCallbackEnd: Interval | null;
  duration: Interval | null;
  frames: Array<{ at: number; frameMs: number; targetBudgetMs: number; hidden: boolean }>;
}
export interface ControlRecords extends PageKey {
  boundarySequence: number; finalSequence: number;
  callbacks: Array<{ sequence: number; rafTimestampMs: number; observedNowMs: number; hidden: boolean }>;
  events: Array<{ atMs: number; kind: string }>;
}
export interface PacingRecords { schemaVersion: 1; expectedIntervalMs: number; before: ControlRecords; after: ControlRecords }
export interface DerivedControl {
  gaps: number[]; durationMs: number; physicalAvailable: boolean;
  judged: { valid: boolean; reasons: string[]; [key: string]: unknown };
  hostStart: Interval | null; hostSampleEnd: Interval | null; hostEnd: Interval | null; utcStart: Interval | null; utcEnd: Interval | null;
}
export interface SerialRun {
  runId: string; hostClockId: string; collection: 'calibration' | 'comparison';
  scene: string; pair: number; position: 0 | 1; side: 'baseline' | 'candidate';
  before: { start: Interval; end: Interval }; run: { start: Interval; end: Interval }; after: { start: Interval; end: Interval };
  utcStart: Interval | null; utcEnd: Interval | null;
}
export declare function validateClockMappings(clockArtifact: ObservationArtifact, context: {
  runtimeArtifact: ObservationArtifact; runtimePolicy: RuntimePolicy; expectedRuntimePolicySha256: string;
}): PartialResult<ClockMaps>;
export declare function deriveFramePhases(records: FrameRecords, clocks: ClockMaps,
  fixtureDurations: Partial<Record<PhaseKind, number>>): PartialResult<{ runId: string; hostClockId: string; phases: DerivedPhase[] }>;
export declare function derivePacingControls(records: PacingRecords, clocks: ClockMaps,
  trustedPacing: { expectedIntervalMs: number; requestedDurationMs: number }): PartialResult<{ runId: string; hostClockId: string; before: DerivedControl; after: DerivedControl }>;
export declare function validateSerialIntervals(runs: SerialRun[], freezeUtc: Interval | null, requiredInventory: { runIds: string[]; scenes: string[] }): PartialResult<{ serialAvailable: boolean; freezeAvailable: boolean }>;
export declare function deriveFrameMetrics(phases: DerivedPhase[]): PartialResult<{
  metrics: Array<{ kind: PhaseKind; physicalAvailable: boolean; label: 'observed-clock-arithmetic-only';
    medianMs: number; p95Ms: number; p99Ms: number; stalls: number; maxStallMs: number; samples: number; durationMs: number }>;
  unsupported: string[];
}>;

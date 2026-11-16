/** JSON-only v1 interchange contract. This file is source preparation, not measured evidence. */
export type Sha256 = string;
export type Build = { version: string; commit: string; artifactSha256: Sha256 };
export type Side = 'baseline' | 'candidate';
export type Scene = 'lobby' | 'drive' | 'mixedbots' | 'water' | 'twohumans';
export type Metric = 'medianMs' | 'p95Ms' | 'p99Ms' | 'stalls' | 'maxStallMs' |
  'coldStartupMs' | 'warmStartupMs' | 'transferBytes';
export type Status = 'improved' | 'unchanged' | 'regressed' | 'mixed' | 'inconclusive' | 'not measured';
export interface Conditions {
  hardware: string; os: string; browser: string; backend: 'webgpu' | 'webgl';
  viewport: [number, number]; backing: [number, number]; dpr: number; refreshHz: number;
  quality: { level: number; auto: false; settings: Record<string, number | boolean | string> };
  seed: string; camera: string; clock: string; actors: { bots: number; remotes: number };
  inputTraceSha256: Sha256; fixtureSha256: Sha256; collectorSha256: Sha256;
  instrumentation: { method: string; overheadMs: number | null; limitation: string | null };
}
export interface Policy {
  id: string; frozenAt: string; calibrationSha256: Sha256;
  // Each cell has its own tolerance. Numeric values are frozen before candidate runs.
  cells: Record<string, Record<Metric, {
    absolute: number; relative: number; noiseMultiplier: number;
  }>>;
}
export interface PacingControl { startedAt: string; endedAt: string; durationMs: number; gaps: number[] }
export interface Frame { at: number; frameMs: number; targetBudgetMs: number; hidden: boolean }
export interface Phase {
  kind: 'warmup' | 'steady' | 'transition';
  startedAtMs: number; endedAtMs: number; expectedDurationMs: number;
  complete: boolean; frames: Frame[];
}
export interface Run {
  id: string; scene: Scene; pair: number; position: 0 | 1; side: Side;
  startedAt: string; endedAt: string;
  observedBuild: Build; conditions: Conditions;
  pacingBefore: PacingControl;
  pacingAfter: PacingControl;
  phases: Phase[];
  startup: {
    coldMs: number | null; warmMs: number | null;
    method: string; coldCacheVerified: boolean; usablePlayVerified: boolean;
  };
  transfer: { bytes: number | null; method: string; manifestSha256: Sha256 };
  errors: string[]; overflow: boolean; qualityStable: boolean;
  // The content-addressed source file containing this run, not an editable URL.
  rawSha256: Sha256;
}
export interface Fixture {
  schemaVersion: 1; description: string;
  scenes: Partial<Record<Scene, {
    conditions: Omit<Conditions, 'fixtureSha256' | 'inputTraceSha256'>;
    inputTrace: unknown; startupMethod: string; transferMethod: string;
    phaseDurations: { warmup: number; steady: number; transition?: number };
  }>>;
}
export interface Calibration { schemaVersion: 1; build: Build; runs: Run[] }
export interface Evidence {
  schemaVersion: 1;
  builds: { baseline: Build; candidate: Build };
  conditions: Partial<Record<Scene, Conditions>>;
  policy: Policy; fixture: Fixture; calibration: Calibration;
  runs: Run[];
  limitations: string[];
}
/** Supplied by the release gate, never taken from the submitted Evidence. */
export interface Expectations {
  baseline: Build; candidate: Build;
  requiredScenes: Scene[];
  reviewedPolicySha256: Sha256;
  // Independently archived calibration and fixture identities approved by the coordinator.
  calibrationSha256: Sha256;
  fixtureSha256: Sha256; collectorSha256: Sha256;
}
export interface Issue { code: string; path: string; message: string }
export interface Validation { valid: boolean; issues: Issue[] }
export interface Comparison {
  scene: Scene; phase: 'steady' | 'transition'; metric: Metric; unit: 'ms' | 'count' | 'bytes';
  baseline: number | null; candidate: number | null;
  delta: number | null; percent: number | null; tolerance: number | null;
  uncertainty: number; calibrationNoise: number;
  pairedDeltas: number[]; status: Status;
}
export interface Report {
  schemaVersion: 1;
  evidenceSha256: Sha256 | null; policySha256: Sha256 | null;
  builds: Evidence['builds']; conditions: Evidence['conditions'];
  status: Status; qualified: boolean;
  // eligible only when qualified and every comparison is unchanged or improved.
  promotion: 'eligible' | 'blocked';
  issues: Issue[]; comparisons: Comparison[];
  runs: Array<{ id: string; scene: Scene; pair: number; side: Side;
    durationMs: number; frames: number; rawSha256: Sha256;
    phases: Array<{ kind: 'warmup' | 'steady' | 'transition'; durationMs: number; frames: number }>;
    startupMethod: string; transferMethod: string }>;
  limitations: string[];
  assets: { report: string; chart: string; raw: string[]; fixture: string; calibration: string };
}
export declare function hashRun(run: Omit<Run, 'rawSha256'> | Run): Sha256;
export declare function classifyPairs(baseline: number[], candidate: number[], calibrationDeltas: number[], policy: { absolute: number; relative: number; noiseMultiplier: number }): Pick<Comparison, 'baseline' | 'candidate' | 'delta' | 'percent' | 'tolerance' | 'uncertainty' | 'calibrationNoise' | 'pairedDeltas' | 'status'>;
export declare function validateEvidence(input: unknown, expected: Expectations): Validation;
/** Always revalidates and recomputes; no input status, aggregate or waiver is authoritative. */
export declare function compareEvidence(input: unknown, expected: Expectations): Report;
/** Deterministic SVG and Markdown use the same report numbers. No network or filesystem access. */
export declare function renderChart(report: Report): string;
export declare function renderPerformance(report: Report, options: {
  version: string; assetBaseUrl: string;
}): string;
/** Canonical JSON: recursively sorted object keys, preserved array order, finite numbers only. */
export declare function canonicalJson(value: unknown): string;
export declare function sha256(value: unknown): Sha256;

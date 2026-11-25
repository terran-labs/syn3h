import { RECIPE_IDS, type RecipeId } from './recipes'

export interface UniverseLifecycleDefaults {
  readonly planetCap: number
  readonly seatsPerPlanet: number
  readonly growthFraction: number
  readonly creationCooldownMs: number
  readonly minimumLifetimeMs: number
  readonly minimumEmptyMs: number
  readonly reportFreshnessMs: number
}

// Server policy defaults. These are neither world parameters nor rig parameters.
export const UNIVERSE_LIFECYCLE_DEFAULTS: UniverseLifecycleDefaults = Object.freeze({
  planetCap: 12,
  seatsPerPlanet: 12,
  growthFraction: 0.25,
  creationCooldownMs: 10_000,
  minimumLifetimeMs: 10 * 60_000,
  minimumEmptyMs: 5 * 60_000,
  reportFreshnessMs: 90_000,
})

export interface UniverseDrain {
  readonly attempt: number
  readonly requestedAt: number
  readonly afterSequence: number
}

export interface UniverseRoomReport {
  readonly generation: number
  readonly sequence: number
  readonly observedAt: number
  readonly connectedHumans: number
  readonly held: number
  readonly reservations: number
  /** The room's continuous interval with no humans, held places, or reservations. */
  readonly emptySince: number | null
  /** Echo only after the room has closed admission for this drain and checked occupancy. */
  readonly drain?: UniverseDrain
}

export interface UniversePlanet {
  readonly id: string
  /** Increase on recreation of this ID. Room reports use this same generation. */
  readonly generation: number
  readonly biome: RecipeId
  readonly kind: 'anchor' | 'overflow'
  readonly createdAt: number
  readonly report?: UniverseRoomReport
  /** Persist the last drain attempt even when it is cancelled. */
  readonly lastDrainAttempt?: number
  readonly drain?: UniverseDrain
}

export interface UniverseSnapshot {
  readonly planets: readonly UniversePlanet[]
  /** Retain the latest creation time per biome even after a planet is removed. */
  readonly lastCreatedAt: Readonly<Partial<Record<RecipeId, number>>>
}

type PlanetTarget = Pick<UniversePlanet, 'id' | 'generation'>
export type UniverseAction =
  | { readonly type: 'create'; readonly biome: RecipeId; readonly kind: UniversePlanet['kind'] }
  | ({ readonly type: 'drain' | 'cancel-drain'; readonly drain: UniverseDrain } & PlanetTarget)
  | ({ readonly type: 'delete'; readonly drain: UniverseDrain; readonly confirmedSequence: number } & PlanetTarget)

const policy = UNIVERSE_LIFECYCLE_DEFAULTS
const growthThreshold = policy.seatsPerPlanet * policy.growthFraction

function isEmpty(report: UniverseRoomReport): boolean {
  return report.connectedHumans === 0 && report.held === 0 && report.reservations === 0
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** Reduce a room observation into the snapshot. Replays leave the original object intact. */
export function recordUniverseRoomReport(planet: UniversePlanet, report: UniverseRoomReport, now: number): UniversePlanet {
  const previous = planet.report
  if (report.generation !== planet.generation || !validCount(report.sequence)
    || (previous && (report.sequence <= previous.sequence || report.observedAt < previous.observedAt))
    || !Number.isFinite(report.observedAt) || report.observedAt < planet.createdAt || report.observedAt > now
    || !validCount(report.connectedHumans) || !validCount(report.held) || !validCount(report.reservations)) return planet

  let emptySince = report.emptySince
  if (!isEmpty(report) || emptySince === null || !Number.isFinite(emptySince) || emptySince > report.observedAt) {
    emptySince = null
  } else {
    const earliest = previous && !isEmpty(previous) ? previous.observedAt : previous?.emptySince
    emptySince = Math.max(planet.createdAt, emptySince, earliest ?? planet.createdAt)
  }
  return { ...planet, report: { ...report, emptySince } }
}

function freshReport(planet: UniversePlanet, now: number): UniverseRoomReport | undefined {
  const report = planet.report
  if (report?.generation === planet.generation && report.observedAt >= planet.createdAt
    && report.observedAt <= now && now - report.observedAt < policy.reportFreshnessMs) return report
}

function retirementReady(planet: UniversePlanet, report: UniverseRoomReport, now: number): boolean {
  return isEmpty(report) && report.emptySince !== null
    && now - planet.createdAt >= policy.minimumLifetimeMs
    && now - report.emptySince >= policy.minimumEmptyMs
}

function needsSpare(planet: UniversePlanet, active: readonly UniversePlanet[], now: number): boolean {
  const others = active.filter(other => other.id !== planet.id && other.biome === planet.biome)
  if (others.length === 0) return true

  // A single join can cross the threshold on one planet. Unknown counts may already
  // be above it, so only fresh observations can prove the spare is unnecessary.
  let joinsToGrow = 0
  for (const other of others) {
    const report = freshReport(other, now)
    if (report) joinsToGrow += Math.max(0, Math.floor(growthThreshold) + 1 - report.connectedHumans)
  }
  return joinsToGrow <= 1
}

function confirmsDrain(report: UniverseRoomReport, drain: UniverseDrain): boolean {
  return report.sequence > drain.afterSequence && report.observedAt >= drain.requestedAt
    && report.drain?.attempt === drain.attempt && report.drain.requestedAt === drain.requestedAt
    && report.drain.afterSequence === drain.afterSequence
}

/**
 * Return one action per evaluation. Apply it against the same snapshot before evaluating again.
 * A drain must close room admission until cancelled or deleted. The caller must reject actions
 * derived from a superseded snapshot and supply new observations before deleting.
 */
export function decideUniverseLifecycle(snapshot: UniverseSnapshot, now: number): UniverseAction | null {
  const { planets } = snapshot
  const hasCapacity = planets.length < policy.planetCap
  if (hasCapacity) {
    const missing = RECIPE_IDS.find(biome => !planets.some(planet => planet.kind === 'anchor' && planet.biome === biome))
    if (missing) return { type: 'create', biome: missing, kind: 'anchor' }
  }

  const active = planets.filter(planet => !planet.drain)
  const overflow = planets.filter(planet => planet.kind === 'overflow').sort((a, b) =>
    a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const planet of overflow) {
    const { id, generation, drain } = planet
    if (!drain) continue
    const report = freshReport(planet, now)
    if (needsSpare(planet, active, now) || (report && !isEmpty(report))) {
      return { type: 'cancel-drain', id, generation, drain }
    }
    if (report && retirementReady(planet, report, now) && confirmsDrain(report, drain)) {
      return { type: 'delete', id, generation, drain, confirmedSequence: report.sequence }
    }
  }

  for (const planet of overflow) {
    const { id, generation } = planet
    const report = freshReport(planet, now)
    if (!planet.drain && report && retirementReady(planet, report, now) && !needsSpare(planet, active, now)) {
      return {
        type: 'drain', id, generation,
        drain: { attempt: (planet.lastDrainAttempt ?? 0) + 1, requestedAt: now, afterSequence: report.sequence },
      }
    }
  }

  if (!hasCapacity) return null
  for (const biome of RECIPE_IDS) {
    const sameBiome = planets.filter(planet => planet.biome === biome)
    const latestCreation = Math.max(snapshot.lastCreatedAt[biome] ?? -Infinity, ...sameBiome.map(planet => planet.createdAt))
    if (now - latestCreation < policy.creationCooldownMs) continue
    if (sameBiome.length > 0 && sameBiome.every(planet =>
      !planet.drain && (freshReport(planet, now)?.connectedHumans ?? 0) > growthThreshold)) {
      return { type: 'create', biome, kind: 'overflow' }
    }
  }
  return null
}

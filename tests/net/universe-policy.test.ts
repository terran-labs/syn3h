import { describe, expect, it } from 'vitest'
import { RECIPE_IDS, type RecipeId } from '../../shared/recipes'
import {
  UNIVERSE_LIFECYCLE_DEFAULTS as defaults,
  decideUniverseLifecycle,
  recordUniverseRoomReport,
  type UniversePlanet,
  type UniverseRoomReport,
  type UniverseSnapshot,
} from '../../shared/universe'

function planet(biome: RecipeId, id: string = biome, createdAt = 0): UniversePlanet {
  return { id, biome, generation: 1, kind: id === biome ? 'anchor' : 'overflow', createdAt }
}

function observe(planet: UniversePlanet, now: number, changes: Partial<UniverseRoomReport> = {}): UniversePlanet {
  return recordUniverseRoomReport(planet, {
    generation: planet.generation,
    sequence: (planet.report?.sequence ?? 0) + 1,
    observedAt: now,
    connectedHumans: 0,
    held: 0,
    emptySince: planet.report ? planet.report.emptySince ?? now : planet.createdAt,
    ...changes,
  }, now)
}

function snapshot(...overrides: UniversePlanet[]): UniverseSnapshot {
  const anchors = RECIPE_IDS.filter(biome => !overrides.some(planet => planet.id === biome)).map(biome => planet(biome))
  return { planets: [...anchors, ...overrides], lastCreatedAt: {} }
}

const oldEnough = defaults.minimumLifetimeMs
const volcano = (humans: number, now: number) => observe(planet('volcanic'), now, { connectedHumans: humans })
const spare = (id = 'spare') => planet('volcanic', id)

describe('universe lifecycle', () => {
  it('bootstraps exactly the nine recipe anchors in recipe order and never retires an anchor', () => {
    const planets: UniversePlanet[] = []
    for (const biome of RECIPE_IDS) {
      expect(decideUniverseLifecycle({ planets: [...planets].reverse(), lastCreatedAt: {} }, 0))
        .toEqual({ type: 'create', biome, kind: 'anchor' })
      planets.push(observe(planet(biome), oldEnough))
    }
    expect(planets).toHaveLength(9)
    expect(decideUniverseLifecycle({ planets, lastCreatedAt: {} }, oldEnough)).toBeNull()
  })

  it('grows only above 25% connected humans on every active planet in the biome', () => {
    const now = defaults.creationCooldownMs
    const saturated = volcano(4, now)
    expect(decideUniverseLifecycle(snapshot(volcano(3, now)), now)).toBeNull()
    expect(decideUniverseLifecycle(snapshot(observe(volcano(0, now), now, {
      connectedHumans: 3, held: 6,
    })), now)).toBeNull()
    expect(decideUniverseLifecycle(snapshot(saturated, observe(spare(), now, { connectedHumans: 3 })), now)).toBeNull()
    expect(decideUniverseLifecycle(snapshot(saturated, spare()), now)).toBeNull()
    expect(decideUniverseLifecycle(snapshot(saturated, observe(spare(), now, { connectedHumans: 4 })), now))
      .toEqual({ type: 'create', biome: 'volcanic', kind: 'overflow' })
  })

  it('can grow past twelve planets and chooses eligible biomes independently of array order', () => {
    const now = defaults.creationCooldownMs
    const desert = observe(planet('desert'), now, { connectedHumans: 4 })
    const world = snapshot(volcano(4, now), desert)
    expect(decideUniverseLifecycle({ ...world, planets: [...world.planets].reverse() }, now))
      .toEqual({ type: 'create', biome: 'volcanic', kind: 'overflow' })
    const full = snapshot(volcano(4, now), desert, ...['a', 'b', 'c'].map(id =>
      observe(spare(id), now, { connectedHumans: 4 })))
    expect(full.planets).toHaveLength(12)
    expect(decideUniverseLifecycle(full, now)).toEqual({ type: 'create', biome: 'volcanic', kind: 'overflow' })
  })

  it('allows growth at exactly ten seconds and remembers a deleted creation per biome', () => {
    const creation = 10_000
    const boundary = creation + defaults.creationCooldownMs
    const world = { ...snapshot(volcano(4, boundary - 1)), lastCreatedAt: { volcanic: creation } }
    expect(decideUniverseLifecycle(world, boundary - 1)).toBeNull()
    expect(decideUniverseLifecycle(world, boundary)).toEqual({ type: 'create', biome: 'volcanic', kind: 'overflow' })
    const desert = observe(planet('desert'), boundary - 1, { connectedHumans: 4 })
    expect(decideUniverseLifecycle({ ...snapshot(volcano(4, boundary - 1), desert), lastCreatedAt: world.lastCreatedAt }, boundary - 1))
      .toEqual({ type: 'create', biome: 'desert', kind: 'overflow' })
  })

  it('requires both retirement gates at their exact boundaries', () => {
    const emptyStart = oldEnough - defaults.minimumEmptyMs
    const younger = observe(spare(), oldEnough - 1, { emptySince: 0 })
    expect(decideUniverseLifecycle(snapshot(volcano(2, oldEnough - 1), younger), oldEnough - 1)).toBeNull()
    expect(decideUniverseLifecycle(snapshot(volcano(2, oldEnough), observe(spare(), oldEnough, {
      emptySince: emptyStart + 1,
    })), oldEnough)).toBeNull()
    const eligible = observe(spare(), oldEnough, { emptySince: emptyStart })
    expect(decideUniverseLifecycle(snapshot(volcano(2, oldEnough), eligible), oldEnough)?.type).toBe('drain')
  })

  it('protects held places and restarts the empty interval after occupancy', () => {
    for (const occupancy of [{ held: 1 }, { connectedHumans: 1 }]) {
      const occupied = observe(spare(), oldEnough, occupancy)
      expect(decideUniverseLifecycle(snapshot(volcano(2, oldEnough), occupied), oldEnough)).toBeNull()
      const recent = observe(occupied, oldEnough + 1, { emptySince: oldEnough + 1 })
      const before = oldEnough + defaults.minimumEmptyMs
      expect(decideUniverseLifecycle(snapshot(volcano(2, before), observe(recent, before)), before)).toBeNull()
      const at = before + 1
      expect(decideUniverseLifecycle(snapshot(volcano(2, at), observe(recent, at)), at)?.type).toBe('drain')
    }
  })

  it('protects allocator reservations even when the latest room report says empty', () => {
    const expires = oldEnough + 10_000
    const candidate = { ...spare(), lastReservationExpiresAt: expires }
    const decisionAt = (now: number) =>
      decideUniverseLifecycle(snapshot(volcano(2, now), observe(candidate, now)), now)
    expect(decisionAt(oldEnough)).toBeNull()
    expect(decisionAt(expires + defaults.minimumEmptyMs - 1)).toBeNull()
    expect(decisionAt(expires + defaults.minimumEmptyMs)?.type).toBe('drain')
    expect(decideUniverseLifecycle(snapshot({ ...volcano(3, oldEnough), lastReservationExpiresAt: expires }), oldEnough))
      .toBeNull()
  })

  it('reaches the same decision from duplicated and reordered reports', () => {
    const empty = spare()
    const now = oldEnough + defaults.minimumEmptyMs
    const before = observe(empty, oldEnough - 1, { connectedHumans: 1 }).report!
    const after = observe(empty, now, { sequence: 2, emptySince: oldEnough }).report!
    for (const reports of [[before, after], [after, before, after], [before, before, after, after]]) {
      const result = reports.reduce((p, r) => recordUniverseRoomReport(p, r, now), empty)
      expect(result.report).toEqual(after)
      expect(decideUniverseLifecycle(snapshot(volcano(2, now), result), now)?.type).toBe('drain')
    }
  })

  it('requires a fresh empty report even to start draining', () => {
    const stale = observe(spare(), oldEnough - defaults.reportFreshnessMs)
    const unknown = observe(spare(), oldEnough, { emptySince: null })
    for (const candidate of [spare(), stale, unknown]) {
      expect(decideUniverseLifecycle(snapshot(volcano(2, oldEnough), candidate), oldEnough)).toBeNull()
    }
  })

  it('requires a fresh empty confirmation of the same drain and a later sequence to delete', () => {
    const anchor = volcano(2, oldEnough)
    const empty = observe(spare(), oldEnough)
    const request = decideUniverseLifecycle(snapshot(anchor, empty), oldEnough)
    if (request?.type !== 'drain') throw new Error('expected drain')
    const draining = { ...empty, drain: request.drain }
    const decision = (candidate: UniversePlanet, now = oldEnough + 1) =>
      decideUniverseLifecycle(snapshot(observe(anchor, now, { connectedHumans: 2 }), candidate), now)

    expect(decision(draining)).toBeNull()
    expect(decision(observe(draining, oldEnough + 1))).toBeNull()
    expect(decision(observe(draining, oldEnough + 1, { drain: { ...request.drain, requestedAt: oldEnough - 1 } }))).toBeNull()
    expect(decision({ ...observe(draining, oldEnough + 1, { drain: request.drain }), lastReservationExpiresAt: oldEnough + 10_000 })?.type)
      .toBe('cancel-drain')
    const confirmed = observe(draining, oldEnough + 1, { drain: request.drain })
    expect(decision(confirmed, oldEnough + 1 + defaults.reportFreshnessMs)).toBeNull()
    expect(decision(confirmed)).toEqual({
      type: 'delete', id: empty.id, generation: empty.generation, drain: request.drain,
      confirmedSequence: confirmed.report?.sequence,
    })
  })

  it('rejects a delayed acknowledgment of a cancelled drain even when the retry starts in the same millisecond', () => {
    const anchor = volcano(2, oldEnough)
    const empty = observe(spare(), oldEnough)
    const first = decideUniverseLifecycle(snapshot(anchor, empty), oldEnough)
    if (first?.type !== 'drain') throw new Error('expected drain')
    const cancelled = { ...empty, lastDrainAttempt: first.drain.attempt }
    const retry = decideUniverseLifecycle(snapshot(anchor, cancelled), oldEnough)
    if (retry?.type !== 'drain') throw new Error('expected drain retry')
    const delayed = observe({ ...cancelled, drain: retry.drain }, oldEnough, { drain: first.drain })
    expect(decideUniverseLifecycle(snapshot(anchor, delayed), oldEnough)).toBeNull()
  })

  it('ignores duplicate, out-of-order and wrong-generation reports even if they arrive later', () => {
    const current = observe({ ...spare(), generation: 2 }, 100, { sequence: 5, connectedHumans: 1 })
    for (const changes of [
      { generation: 1, sequence: 99 }, { generation: 3, sequence: 99 },
      { sequence: 5 }, { sequence: 4 }, { sequence: 6, observedAt: 99 },
      { sequence: 6, observedAt: 102 },
    ]) {
      expect(observe(current, 101, changes)).toBe(current)
    }
    const newer = observe(current, 101, { emptySince: 101 })
    expect(newer.report).toMatchObject({ generation: 2, sequence: 6, emptySince: 101 })
  })

  it('drains a surplus empty planet in a stable order and keeps the last spare at three', () => {
    const a = observe(spare('a'), oldEnough)
    const b = observe(spare('b'), oldEnough)
    const anchor = volcano(3, oldEnough)
    expect(decideUniverseLifecycle(snapshot(anchor, b, a), oldEnough)).toMatchObject({ type: 'drain', id: 'a' })
    expect(decideUniverseLifecycle(snapshot(anchor, a, b), oldEnough)).toMatchObject({ type: 'drain', id: 'a' })
    expect(decideUniverseLifecycle(snapshot(anchor, b), oldEnough)).toBeNull()
  })

  it('keeps one spare through forty minutes of swings between three and four humans', () => {
    const createdAt = defaults.creationCooldownMs
    expect(decideUniverseLifecycle(snapshot(volcano(4, createdAt)), createdAt))
      .toEqual({ type: 'create', biome: 'volcanic', kind: 'overflow' })
    let anchor = volcano(4, createdAt)
    let overflow = planet('volcanic', 'spare', createdAt)
    for (let minute = 0; minute <= 40; minute++) {
      const now = createdAt + minute * 60_000
      anchor = observe(anchor, now, { connectedHumans: minute % 2 === 0 ? 3 : 4 })
      overflow = observe(overflow, now)
      expect(decideUniverseLifecycle(snapshot(anchor, overflow), now)).toBeNull()
    }
  })

  it('cancels an acknowledged drain if the biome returns to three humans before deletion', () => {
    const empty = observe(spare(), oldEnough)
    const request = decideUniverseLifecycle(snapshot(volcano(2, oldEnough), empty), oldEnough)
    if (request?.type !== 'drain') throw new Error('expected drain')
    const now = oldEnough + 1
    const confirmed = observe({ ...empty, drain: request.drain }, now, { drain: request.drain })
    expect(decideUniverseLifecycle(snapshot(volcano(3, now), confirmed), now))
      .toEqual({ type: 'cancel-drain', id: empty.id, generation: empty.generation, drain: request.drain })
  })
})

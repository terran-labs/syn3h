/**
 * A bot can still climb the volcano road in the recommended wind. Real generated island,
 * real Rapier, the bots' own ground pilot, the weather system as the game runs it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { FIXED_DT, createWorld, initPhysics } from '../../src/core/physics'
import { createPilot } from '../../src/bots/pilot'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import { params } from '../../shared/params'
import { RECOMMENDED_STORMINESS, WeatherSystem, setWeatherClock, storminess } from '../../src/world/weather'
import { island } from '../bots/island'

beforeAll(initPhysics)
afterEach(() => { params.set(storminess.def.id, storminess.def.default); setWeatherClock(() => Date.now() / 1000) })

/** Fraction of the volcano road reached in `seconds`, and the highest point. */
function climb(storm: number, seconds: number) {
  params.set(storminess.def.id, storm)
  let t = 1_794_700_000
  setWeatherClock(() => t)
  const world = createWorld(9.81)
  const terrain = island(world, 1)
  const road = terrain.roadPaths!().find((r) => r.kind === 'volcano')!
  const pts = road.points
  const a = pts[2], b = pts[4]
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const v = new MiraBuggy(game, terrain, new Vector3(a.x, a.y + 1.5, a.z), Math.atan2(-(b.x - a.x), -(b.z - a.z)))
  v.isLocal = false
  const pilot = createPilot(v, terrain)!
  const weather = new WeatherSystem(() => terrain, () => [v])
  let index = 2, top = a.y, maxWind = 0
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    const p = v.body.translation()
    // Advance along the centreline past anything within 10 m, then aim 14 m further on.
    while (index < pts.length - 1 && Math.hypot(pts[index].x - p.x, pts[index].z - p.z) < 10) index++
    const aim = pts[Math.min(pts.length - 1, index + 3)]
    pilot.drive({ x: aim.x, z: aim.z, speed: 12 }, v.input, FIXED_DT)
    weather.fixedUpdate()
    maxWind = Math.max(maxWind, v.wind.length())
    v.fixedUpdate(FIXED_DT); world.step(); v.postPhysics(FIXED_DT)
    t += FIXED_DT
    top = Math.max(top, p.y)
    if (index >= pts.length - 2) break
  }
  world.free()
  return { progress: index / (pts.length - 1), top, rim: pts[pts.length - 1].y, maxWind }
}

describe('a bot on the volcano road in wind', () => {
  it('reaches the top as well as in still air at the recommended storminess', () => {
    const still = climb(0, 240)
    const windy = climb(RECOMMENDED_STORMINESS, 240)
    console.log('volcano road climb', JSON.stringify({ still, windy }))
    expect(windy.maxWind).toBeGreaterThan(0)
    expect(windy.progress).toBeGreaterThanOrEqual(Math.min(0.95, still.progress * 0.95))
  }, 120_000)
})

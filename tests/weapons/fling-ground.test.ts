/**
 * A Yoink fling or gust may point straight into the ground; the room bounds its speed, not its
 * direction. Here the hardest velocity change any slider setting allows is driven into hilly
 * ground, and every vehicle must stay on the surface, with the Vehicles lane's ground guard as
 * the backstop. The land is built the same way as tests/vehicles2/ground-guard.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { FIXED_DT, createWorld, initPhysics } from '../../src/core/physics'
import { emptyInput } from '../../src/core/Input'
import { heightfieldDesc } from '../../src/world/terrain/collider'
import type { TerrainData } from '../../src/world/terrain/generate'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
import { createVehicle } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { params } from '../../shared/params'
import { flingLimit } from '../../src/weapons/yoink/Yoink'
import { yoinkFling, yoinkPunt } from '../../src/weapons/yoink/params'

beforeAll(initPhysics)
const N = 257, CELL = 4, SIZE = (N - 1) * CELL
const hill = (x: number, z: number) => 18 * Math.sin(x / 37) * Math.cos(z / 41) + 9 * Math.sin(x / 11 + z / 13)

function land() {
  const world = createWorld(9.81), heights = new Float32Array(N * N)
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) heights[iz * N + ix] = hill(-SIZE / 2 + ix * CELL, -SIZE / 2 + iz * CELL)
  const data = { resolution: N, cell: CELL, size: SIZE, heights } as unknown as TerrainData
  world.createCollider(heightfieldDesc(data, 0))
  const heightAt = (x: number, z: number) => {
    const fx = Math.min(N - 1.001, Math.max(0, (x + SIZE / 2) / CELL)), fz = Math.min(N - 1.001, Math.max(0, (z + SIZE / 2) / CELL))
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz
    const h = (a: number, b: number) => heights[b * N + a]
    return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz
  }
  const normalAt = (x: number, z: number, out: T.Vector3) => out.set(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1)).normalize()
  const game = { world, scene: new T.Scene(), input: { state: emptyInput() } } as unknown as Game
  const terrain = { size: SIZE, heightAt, normalAt, spawnPoint: () => ({ position: new T.Vector3(0, heightAt(0, 0) + 2, 0), heading: 0 }), dispose() {} } as unknown as Terrain
  world.step()
  return { world, game, terrain, heightAt }
}

const step = (l: ReturnType<typeof land>, v: Vehicle) => { v.fixedUpdate(FIXED_DT); l.world.step(); v.postPhysics(FIXED_DT) }

describe('a Yoink fling into the ground', () => {
  it('leaves every vehicle on the surface at the hardest setting the sliders allow', () => {
    params.set(yoinkFling.def.id, yoinkFling.def.max)
    params.set(yoinkPunt.def.id, yoinkPunt.def.max)
    const most = flingLimit()
    expect(most).toBeLessThan(150)
    for (const kind of ['buggy', 'jet', 'hovercraft', 'tank'] as const) {
      for (const dir of [[0, -1, 0], [0, -0.7, -0.7], [0.3, -0.9, 0.3]]) {
        const l = land()
        const v = createVehicle(l.game, l.terrain, kind, new T.Vector3(3, l.heightAt(3, 100) + 1.5, 100), 0)
        v.isLocal = false
        for (let i = 0; i < 60; i++) step(l, v)
        const n = Math.hypot(dir[0], dir[1], dir[2]), m = v.body.mass() * most / n
        // Exactly what Yoink.applyFling does with the largest allowed velocity change.
        v.body.applyImpulse({ x: dir[0] * m, y: dir[1] * m, z: dir[2] * m }, true)
        let lowest = Infinity
        for (let i = 0; i < 150; i++) {
          step(l, v)
          const p = v.body.translation()
          expect(Number.isFinite(p.y)).toBe(true)
          if (Math.abs(p.x) < SIZE / 2 - 8 && Math.abs(p.z) < SIZE / 2 - 8) lowest = Math.min(lowest, p.y - l.heightAt(p.x, p.z))
        }
        expect(lowest, `${kind} ${dir}`).toBeGreaterThan(-0.5)
        v.dispose(); l.world.free()
      }
    }
    params.set(yoinkFling.def.id, yoinkFling.def.default)
    params.set(yoinkPunt.def.id, yoinkPunt.def.default)
  }, 120000)
})

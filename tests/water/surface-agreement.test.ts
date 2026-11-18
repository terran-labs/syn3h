/**
 * One water surface: what physics floats things at (lavaSurfaceAt with the draped water rivers,
 * as ProceduralTerrain.liquidBodyAt calls it) is what the game draws (the river ribbons and lake
 * rings volcanics.ts builds), and the camera's waterline is that surface meeting the lens. The
 * owner, on v26.11.1713: a vehicle floating down a river "a foot or more above the actual surface
 * of the water", and the foam line drawn away from where the water plane hits the camera.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import '../../src/world/terrain/settings'
import '../../src/core/quality'
import { beforeAll } from 'vitest'
import { initPhysics, RAPIER, createWorld } from '../../src/core/physics'
import { applyWaterForces } from '../../src/vehicles/buoyancy'
import type { Terrain } from '../../src/world/Terrain'
import { applyPlanet } from '../../src/world/planets'
import { currentTerrainSettings } from '../../src/world/terrain/settings'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler, sealSeam } from '../../src/world/terrain/sampler'
import { lavaSurfaceAt } from '../../src/world/terrain/lava'
import { drapedRivers, receivingWater, riverPieces } from '../../src/world/water/falls'
import { buildRiverSurface, buildStillSurface } from '../../src/world/water/surface'
import { waterlinePlane } from '../../src/world/water/waterline'

beforeAll(initPhysics)
afterEach(() => { applyPlanet('volcanic', 1, { nameSeed: 0 }); for (const id of ['gfx.quality', 'terrain.planetSize']) params.set(id, params.get(id)!.def.default) })

function world(planet: string, seed: number, planetSize = 1) {
  applyPlanet(planet, seed, { nameSeed: 1 })
  params.set('terrain.planetSize', planetSize)
  const data = generateTerrain(seed, currentTerrainSettings()); sealSeam(data)
  return { data, ground: new HeightSampler(data) }
}
const WORLDS = [['desert', 4], ['alpine', 4], ['swamp', 4]] as const

describe('water rivers: physics floats on the river that is drawn', () => {
  it('the draped line is a pure function of the world: the same for every client, whatever its quality or order', () => {
    const a = world('desert', 77)
    params.set('gfx.quality', 0)
    const first = drapedRivers(a.data.lava, a.ground, 2).map((r) => r.map((p) => [p.x, p.y, p.z]))
    // Another world in between, then the same world built afresh at another quality.
    const other = world('alpine', 9); drapedRivers(other.data.lava, other.ground, 2)
    params.set('gfx.quality', 5)
    const b = world('desert', 77)
    const second = drapedRivers(b.data.lava, b.ground, 2).map((r) => r.map((p) => [p.x, p.y, p.z]))
    expect(first.flat().length).toBeGreaterThan(10)
    expect(second).toEqual(first)
  })

  it('the drawn ribbon lies on the physics surface along every centre line, at two sea levels and two planet sizes', () => {
    for (const [planet, seed] of WORLDS) for (const size of [1, Math.log2(3)]) for (const sea of [0, 3]) {
      const { data, ground } = world(planet, seed, size)
      const lava = data.lava, lines = drapedRivers(lava, ground, sea), waterAt = receivingWater(lava, sea)
      let compared = 0
      lava.rivers.forEach((r, ri) => {
        if (r.points.length < 2) return
        // Exactly as volcanics.ts builds the drawn river.
        const pieces = riverPieces(ground, r.points, r.width, waterAt, 9.81, 4, lines[ri])
        if (pieces.points.length < 2) return
        const geo = buildRiverSurface(ground, pieces.points, r.width + 1.5, () => 1, 3)
        const pos = geo.getAttribute('position'), cols = Math.max(3, 2 * Math.round((r.width + 1.5) / 3 / 2) + 1)
        // This river alone, so a confluence or the lake it runs into does not count against it.
        const alone = { lake: null, pools: [], rivers: [r] }
        for (let i = (cols - 1) / 2; i < pos.count; i += cols) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
          expect(lavaSurfaceAt(alone, x, z, -Infinity, [lines[ri]])).toBeCloseTo(y, 3)
          // With everything else too, the water there is never lower than what is drawn.
          expect(lavaSurfaceAt(lava, x, z, -Infinity, lines)).toBeGreaterThanOrEqual(y - 1e-3)
          compared++
        }
      })
      expect(compared, `${planet} ${seed}`).toBeGreaterThan(20)
    }
  })

  it('a floating hull carried over the steepest fall is tipped over it, never flung', () => {
    for (const [planet, seed] of WORLDS) {
      const { data, ground } = world(planet, seed)
      const lines = drapedRivers(data.lava, ground, 0)
      // The steepest drop of any river: where the surface is steepest, so its slope is largest.
      let worst = { drop: 0, line: lines[0], i: 1 }
      lines.forEach((line) => { for (let i = 1; i < line.length; i++) { const d = (line[i - 1].y - line[i].y) / Math.max(0.1, Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z)); if (d > worst.drop) worst = { drop: d, line, i } } })
      if (worst.drop < 1) continue
      const a = worst.line[Math.max(0, worst.i - 3)], b = worst.line[worst.i]
      const terrain = { liquidHeightAt: (x: number, z: number) => lavaSurfaceAt(data.lava, x, z, -Infinity, lines), liquidKindAt: () => 'water', heightAt: (x: number, z: number) => ground.heightAt(x, z) } as unknown as Terrain
      const w = createWorld(9.81)
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(a.x, a.y, a.z))
      w.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.5, 1.2), body)
      const along = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize().multiplyScalar(3)
      body.setLinvel({ x: along.x, y: 0, z: along.z }, true)
      let fastest = 0
      for (let i = 0; i < 240; i++) {
        body.resetForces(true); body.resetTorques(true)
        applyWaterForces(body, w, terrain, 'hovercraft', 1 / 60)
        w.step()
        const v = body.linvel()
        fastest = Math.max(fastest, Math.hypot(v.x, v.z), v.y)
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
      }
      w.free()
      // Falling and the water's push carry it on, but never faster than its start plus a free
      // fall off the whole drop: the water adds no kick of its own at the lip.
      expect(fastest, `${planet} ${seed}`).toBeLessThan(3 + Math.sqrt(2 * 9.81 * Math.max(1, a.y - b.y)))
    }
  })

  it('lakes and pools are drawn at the height physics floats on, river mouths included', () => {
    for (const [planet, seed] of WORLDS) {
      const { data, ground } = world(planet, seed)
      const lava = data.lava, lines = drapedRivers(lava, ground, 0)
      for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) {
        const pos = buildStillSurface(ground, b.x, b.surface, b.z, b.radius, 3).getAttribute('position')
        // The lake itself is exact; a river running in may be drawn over its edge, and floats
        // things there, so with the rivers the water is never lower than the ring.
        const still = { lake: lava.lake, pools: lava.pools, rivers: [] }
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), lake = lavaSurfaceAt(still, x, z, -Infinity)
          // The outer ring lies on the shore line itself, where physics already says dry.
          if (!Number.isFinite(lake)) continue
          // Vertex heights are 32 bit floats.
          expect(lake).toBeCloseTo(y, 4)
          expect(lavaSurfaceAt(lava, x, z, -Infinity, lines)).toBeGreaterThanOrEqual(y - 1e-5)
        }
      }
    }
  })
})

describe('the camera waterline is the surface meeting the lens', () => {
  it('marks exactly the points of the sheet that lie on the water surface, tilted or flat', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000)
    const forward = new THREE.Vector3(), out = new THREE.Vector3(), point = new THREE.Vector3()
    for (const [height, pitch, roll, sx, sz] of [[0.02, 0.1, 0, 0, 0], [-0.03, -0.4, 0.3, 0.2, -0.1], [0, 0.8, -0.6, -0.5, 0.4]]) {
      camera.position.set(3, 10, -4)
      camera.rotation.set(pitch, 1.1, roll, 'YXZ')
      camera.updateMatrixWorld(true)
      camera.getWorldDirection(forward)
      const e = camera.matrixWorld.elements, d = camera.near * 1.5
      const halfH = d * Math.tan((camera.fov * Math.PI) / 360) * 1.05, halfW = halfH * camera.aspect
      const surfaceAtLens = camera.position.y - height
      waterlinePlane(height, forward, [e[0], e[1], e[2]], [e[4], e[5], e[6]], d, halfW, halfH, sx, sz, out)
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [-0.7, 0.4], [0.9, -0.9]]) {
        // The sheet point in the world, and its height above the plane through the lens' surface point.
        point.copy(camera.position).addScaledVector(forward, d)
          .addScaledVector(new THREE.Vector3(e[0], e[1], e[2]), u * halfW).addScaledVector(new THREE.Vector3(e[4], e[5], e[6]), v * halfH)
        const surface = surfaceAtLens + sx * (point.x - camera.position.x) + sz * (point.z - camera.position.z)
        expect(out.x + out.y * u + out.z * v).toBeCloseTo(point.y - surface, 9)
      }
    }
  })
})

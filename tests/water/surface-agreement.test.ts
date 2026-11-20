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

const built = new Map<string, { data: ReturnType<typeof generateTerrain>, ground: HeightSampler }>()
/**
 * A planet's world, generated once per planet, seed and size for this file (generation is a pure
 * function of those; the draped-line test builds afresh to prove it). Shared: read it, never write.
 */
function world(planet: string, seed: number, planetSize = 1, fresh = false) {
  applyPlanet(planet, seed, { nameSeed: 1 })
  params.set('terrain.planetSize', planetSize)
  const key = `${planet}|${seed}|${planetSize}`
  if (!fresh && built.has(key)) return built.get(key)!
  const data = generateTerrain(seed, currentTerrainSettings()); sealSeam(data)
  const out = { data, ground: new HeightSampler(data) }
  built.set(key, out)
  return out
}
const WORLDS = [['desert', 4], ['alpine', 4], ['swamp', 4]] as const

describe('water rivers: physics floats on the river that is drawn', () => {
  it('the draped line is a pure function of the world: the same for every client, whatever its quality or order', () => {
    const a = world('desert', 77, 1, true)
    params.set('gfx.quality', 0)
    const first = drapedRivers(a.data.lava, a.ground, 2).map((r) => r.map((p) => [p.x, p.y, p.z]))
    // Another world in between, then the same world built afresh at another quality.
    const other = world('alpine', 9, 1, true); drapedRivers(other.data.lava, other.ground, 2)
    params.set('gfx.quality', 5)
    const b = world('desert', 77, 1, true)
    const second = drapedRivers(b.data.lava, b.ground, 2).map((r) => r.map((p) => [p.x, p.y, p.z]))
    expect(first.flat().length).toBeGreaterThan(10)
    expect(second).toEqual(first)
    // Generates three worlds.
  })

  it('the drawn ribbon lies on the physics surface along every centre line, at two sea levels and two planet sizes', () => {
    for (const [planet, seed] of WORLDS) for (const size of [1, Math.log2(3)]) {
      const { data, ground } = world(planet, seed, size)
      for (const sea of [0, 3]) {
      const lava = data.lava, lines = drapedRivers(lava, ground, sea), waterAt = receivingWater(lava, sea)
      let compared = 0
      lava.rivers.forEach((r, ri) => {
        if (r.points.length < 2) return
        // Exactly as volcanics.ts builds the drawn river.
        const pieces = riverPieces(ground, r.points, r.width, waterAt, 9.81, 4, lines[ri])
        if (pieces.points.length < 2) return
        // This river alone, so a confluence or the lake it runs into does not count against it.
        const alone = { lake: null, pools: [], rivers: [r] }
        // Across the width too, at a coarse and a fine mesh (quality sets the spacing): the water
        // inside the river is level, as physics has it. On a bend a vertex's nearest stretch of
        // centre line can be the next one, so it may differ by the river's own fall across its
        // width, never more.
        const line = lines[ri]
        let fall = 0
        for (let i = 1; i < line.length; i++) fall = Math.max(fall, (line[i - 1].y - line[i].y) / Math.max(0.1, Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z)))
        // The width check once per world (sea level only moves where a river stops).
        if (sea === 0) for (const step of [2.5, 1]) {
          const across = buildRiverSurface(ground, pieces.points, r.width + 1.5, () => 1, step).getAttribute('position')
          for (let i = 0; i < across.count; i++) {
            const phys = lavaSurfaceAt(alone, across.getX(i), across.getZ(i), -Infinity, [line])
            if (Number.isFinite(phys)) expect(Math.abs(phys - across.getY(i))).toBeLessThanOrEqual(0.02 + fall * (r.width + 1.5))
          }
        }
        const geo = buildRiverSurface(ground, pieces.points, r.width + 1.5, () => 1, 3)
        const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv')
        for (let i = 0; i < pos.count; i++) {
          if (uv.getX(i) !== 0) continue
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
          expect(lavaSurfaceAt(alone, x, z, -Infinity, [lines[ri]])).toBeCloseTo(y, 3)
          // With everything else too, the water there is never lower than what is drawn.
          expect(lavaSurfaceAt(lava, x, z, -Infinity, lines)).toBeGreaterThanOrEqual(y - 1e-3)
          compared++
        }
      })
      expect(compared, `${planet} ${seed}`).toBeGreaterThan(20)
      }
    }
    // Six worlds, two at the larger planet size: 28 s seen at a load of 36. A hang limit, not a speed one.
  }, 180_000)

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

/** The highest drawn water at (x, z) among `meshes` (world-space triangles), or -Infinity. */
function drawnAt(meshes: THREE.BufferGeometry[], x: number, z: number): number {
  let best = -Infinity
  for (const g of meshes) {
    const box = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!)
    if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue
    const pos = g.getAttribute('position'), idx = g.getIndex()!
    for (let k = 0; k < idx.count; k += 3) {
      const a = idx.getX(k), b = idx.getX(k + 1), c = idx.getX(k + 2)
      const ax = pos.getX(a), az = pos.getZ(a), bx = pos.getX(b), bz = pos.getZ(b), cx = pos.getX(c), cz = pos.getZ(c)
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(d) < 1e-12) continue
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue
      best = Math.max(best, u * pos.getY(a) + v * pos.getY(b) + (1 - u - v) * pos.getY(c))
    }
  }
  return best
}

describe('physics is the water that is drawn, wherever it is sampled', () => {
  it('in rivers, across them and in the lakes they run into, at a coarse and a fine mesh', () => {
    for (const [planet, seed] of WORLDS) for (const step of [3, 1]) {
      const { data, ground } = world(planet, seed)
      const lava = data.lava, lines = drapedRivers(lava, ground, 0), waterAt = receivingWater(lava, 0)
      // Everything volcanics.ts draws for water rivers, lakes and pools, but the fall sheets.
      const meshes: THREE.BufferGeometry[] = []
      lava.rivers.forEach((r, ri) => {
        if (r.points.length < 2) return
        const pieces = riverPieces(ground, r.points, r.width, waterAt, 9.81, 4, lines[ri])
        if (pieces.points.length >= 2) meshes.push(buildRiverSurface(ground, pieces.points, r.width + 1.5, () => 1, step))
      })
      for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) meshes.push(buildStillSurface(ground, b.x, b.surface, b.z, b.radius, step))
      // Points down every river, on its line and either side, and round every lake and pool.
      const points: [number, number][] = []
      for (const r of lava.rivers) for (let i = 0; i + 1 < r.points.length; i += 2) {
        const a = r.points[i], c = r.points[i + 1], l = Math.hypot(c.x - a.x, c.z - a.z) || 1, nx = -(c.z - a.z) / l, nz = (c.x - a.x) / l
        for (const f of [0, -0.45, 0.45]) points.push([a.x + nx * r.width * f, a.z + nz * r.width * f])
      }
      for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) for (let k = 0; k < 12; k++) points.push([b.x + Math.cos(k) * b.radius * 0.6, b.z + Math.sin(k) * b.radius * 0.6])
      let compared = 0, agree = 0
      for (const [x, z] of points) {
        const physics = lavaSurfaceAt(lava, x, z, -Infinity, lines), drawn = drawnAt(meshes, x, z)
        if (!Number.isFinite(physics) || !Number.isFinite(drawn) || physics <= ground.heightAt(x, z)) continue
        compared++
        // The ribbon lays a joint's cross-section through its resample points' neighbours, a little
        // off the exact bisector physics uses: on a sloping stretch that is a few centimetres.
        if (Math.abs(physics - drawn) < 0.1) agree++
      }
      expect(compared, `${planet} ${seed}`).toBeGreaterThan(50)
      expect(agree / compared, `${planet} ${seed} at ${step} m`).toBe(1)
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

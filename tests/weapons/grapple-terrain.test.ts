import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game } from '../../src/core/Game'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { Bungee } from '../../src/weapons/bungee/Bungee'

beforeAll(initPhysics)
afterEach(() => vi.unstubAllGlobals())
it('keeps a slack ground cord above the flat ground it attached to', () => {
  params.set('bungee.allowed', true)
  const world = createWorld(0)
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0))
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0))
  world.createCollider(RAPIER.ColliderDesc.ball(1), body)
  const object = new THREE.Group(); object.position.set(0, 3, 0)
  const camera = new THREE.PerspectiveCamera(); camera.position.set(10, 10, 10)
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  const game = { world, scene: new THREE.Scene(), camera, canvas: {}, time: 0,
    input: { state: { fire: false } } } as unknown as Game
  const bungee = new Bungee(game, {
    surface: { heightAt: () => 0, cellSize: () => 1, origin: () => 0 },
    self: () => 1, vehicleOf: () => ({ body, object }), idOfBody: () => null,
    owns: () => true, lagOf: () => 0, wrapSize: () => 0, now: () => game.time, inHand: () => true,
  }, { addEventListener() {} } as unknown as Window)
  try {
    world.step()
    expect(bungee.launch([0, -1, -2])).toBe(true)
    for (let i = 0; i < 100 && !bungee.attached; i++) { bungee.fixedUpdate(0.02); game.time += 0.02 }
    expect(bungee.attached).toBe(true)
    const c = bungee.mine!
    c.rest = 40
    bungee.update(0.02)
    const points = (bungee as any).points as THREE.Vector3[]
    const min = Math.min(...points.slice(0, (bungee as any).look.segments + 1).map(p => p.y))
    console.log(JSON.stringify({ case: 'flat-ground-slack', anchor: c.at?.toArray(), minimumCordHeight: min }))
    expect(min).toBeGreaterThanOrEqual(-0.01)
  } finally { bungee.dispose(); world.free() }
})

import { createTerrainMeshes } from '../../src/world/terrain/mesh'
import type { TerrainData } from '../../src/world/terrain/generate'
import { LEVELS, legacyTier } from '../../src/core/quality'
import { CORD_CLEARANCE, drapeCord, type CordSurface } from '../../src/weapons/bungee/drape'
import { TetherLook } from '../../src/weapons/bungee/tether'
import { curveParam, updateCurve, curveOffset } from '../../src/world/curve'
import { wrapCoord } from '../../shared/wrap'

const profiles = {
  volcano: (x: number, z: number) => Math.max(0, 85 - Math.hypot(x, z) * 2.2),
  dune: (x: number, z: number) => 12 + 10 * Math.cos(x * Math.PI / 32) * Math.cos(z * Math.PI / 128),
  shoreline: (x: number, _z: number) => x * 0.15,
  wrap: (x: number, z: number) => 20 + 18 * Math.cos((wrapCoord(x, 256) + 128) * Math.PI / 64) * Math.cos(z * Math.PI / 128),
}

function terrain(profile: (x: number, z: number) => number) {
  const resolution = 65, size = 256, cell = 4
  const heights = new Float32Array(resolution * resolution)
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) heights[z * resolution + x] = profile(-128 + x * cell, -128 + z * cell)
  const data = { resolution, size, cell, heights, volcanic: new Float32Array(heights.length), roadDist: new Float32Array(heights.length) } as TerrainData
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const meshes = createTerrainMeshes(data, material)
  return { meshes, material }
}

for (const [profile, height] of Object.entries(profiles)) for (let level = 0; level < LEVELS.length; level++) {
  it(`drapes every ribbon edge and bead over ${profile} at quality ${level}`, () => {
    const { meshes, material } = terrain(height)
    const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 70, 180)
    const q = LEVELS[level]
    meshes.setLodDistances(250 * q.detail ** 2, Math.max(250 * q.detail ** 2, Math.min(900 * q.detail, q.drawDistance * 0.6)))
    meshes.updateLod(camera.position)
    meshes.group.updateMatrixWorld(true)
    const surface: CordSurface = { heightAt: (x, z) => Math.max(meshes.heightAt(x, z), profile === 'shoreline' ? 0 : -Infinity), cellSize: () => 4, origin: () => -128 }
    params.set('gfx.level', legacyTier(level as 0 | 1 | 2 | 3 | 4 | 5))
    const game = { scene: new THREE.Scene(), camera } as unknown as Game
    const look = new TetherLook(game)
    const slot = look.takeCord()
    try {
      look.begin(camera, 0)
      const n = look.segments
      const from = profile === 'wrap' ? 105 : -65, to = profile === 'wrap' ? 151 : 65
      for (const slack of [false, true]) {
        const points = Array.from({ length: n + 1 }, (_, i) => {
          const t = i / n, x = from + (to - from) * t
          const y = THREE.MathUtils.lerp(surface.heightAt(from, 3), surface.heightAt(to, 3), t) + 1 - (slack ? 15 * 4 * t * (1 - t) : 0)
          return new THREE.Vector3(x, y, 3)
        })
        drapeCord(points, n + 1, surface)
        look.writeCord(slot, points, slack ? 0 : 1, 0, [1, 1, 1], surface)
        const positions = look.cord.geometry.getAttribute('position')
        // Actual rendered ribbon: both edges and centre, sampled between every vertex.
        for (let i = 1; i <= n; i++) for (const across of [0, 0.5, 1]) {
          const point = (j: number) => new THREE.Vector3().fromBufferAttribute(positions, j * 2).lerp(new THREE.Vector3().fromBufferAttribute(positions, j * 2 + 1), across)
          const a = point(i - 1), b = point(i)
          for (let k = 0; k <= 40; k++) {
            const p = a.clone().lerp(b, k / 40)
            expect(p.y - surface.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(-0.01)
          }
        }
      }
      expect(look.segments).toBe(level === 0 ? 12 : 24)
      expect(game.scene.children.filter(o => o === look.cord || o === look.sparks)).toHaveLength(2)
    } finally { look.dispose(); meshes.dispose(); material.dispose() }
  })
}

it('samples the actual visible LOD triangles and repeats across the wrap seam', () => {
  const { meshes, material } = terrain(profiles.dune)
  try {
    for (const distance of [0, 400, 1200]) {
      meshes.updateLod(new THREE.Vector3(0, 10, distance)); meshes.group.updateMatrixWorld(true)
      const visible = meshes.group.children.filter(o => o.visible)
      for (const x of [-90.3, -15.5, 60.1]) {
        const z = distance === 0 ? 12.3 : 12.3 + 256 * Math.round(distance / 256)
        const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0))
        const hit = ray.intersectObjects(visible, false)[0]
        expect(hit).toBeDefined()
        expect(meshes.heightAt(x, z)).toBeCloseTo(hit.point.y, 4)
        expect(meshes.heightAt(x + 256, z - 256)).toBeCloseTo(hit.point.y, 4)
      }
    }
  } finally { meshes.dispose(); material.dispose() }
})

it('reserves clearance for a straight ribbon edge bent into a planet chord', () => {
  const saved = curveParam.value
  try {
    params.set('world.curve', 1)
    updateCurve(new THREE.Vector3(0, 10, 0), 256)
    // A contact-preserving curved span needs an interior support vertex.
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 0)]
    expect(drapeCord(points, points.length, { heightAt: () => 0, cellSize: () => 4, origin: () => -128 })).toBe(true)
    expect(points[0]).toEqual(new THREE.Vector3(0, 0, 0))
    expect(points[2]).toEqual(new THREE.Vector3(20, 0, 0))
    const bent = points.map(p => { const d = new THREE.Vector3(); curveOffset(p.x, p.y, p.z, d); return p.clone().add(d) })
    const radius = 256 / (2 * Math.sqrt(Math.PI))
    for (let i = 1; i < bent.length; i++) for (let k = 0; k <= 100; k++) {
      const p = bent[i - 1].clone().lerp(bent[i], k / 100)
      expect(Math.hypot(p.x, p.y + radius, p.z)).toBeGreaterThanOrEqual(radius)
    }
  } finally { params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', saved) }
})


it('keeps clear vehicle and anchor endpoints fixed while lifting an intervening ridge', () => {
  const points = [new THREE.Vector3(0, 2, 0), new THREE.Vector3(10, -4, 0), new THREE.Vector3(20, -4, 0), new THREE.Vector3(30, 2, 0)]
  const surface: CordSurface = { heightAt: x => Math.max(0, 8 - Math.abs(x - 5) * 2, 8 - Math.abs(x - 25) * 2), cellSize: () => 1, origin: () => 0 }
  const first = points[0].clone(), last = points.at(-1)!.clone()
  drapeCord(points, points.length, surface)
  expect(points[0]).toEqual(first); expect(points.at(-1)).toEqual(last)
  for (let i = 1; i < points.length; i++) for (let k = 0; k <= 100; k++) {
    const p = points[i - 1].clone().lerp(points[i], k / 100)
    expect(p.y).toBeGreaterThanOrEqual(surface.heightAt(p.x, p.z))
  }
})

it('bounds sampling for a 500 metre cord without adding segments or draws', async () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(50, 50, 150)
  const game = { scene: new THREE.Scene(), camera } as unknown as Game
  const look = new TetherLook(game), slot = look.takeCord()
  let calls = 0
  const surface: CordSurface = { heightAt: () => { calls++; return 0 }, cellSize: () => 4, origin: () => -1024 }
  try {
    look.begin(camera, 0)
    const n = look.segments, points = Array.from({ length: n + 1 }, () => new THREE.Vector3())
    const render = () => {
      for (let i = 0; i <= n; i++) points[i].set(500 * i / n, 1 - 10 * Math.sin(i / n * Math.PI), 0)
      drapeCord(points, n + 1, surface)
      look.writeCord(slot, points, 0, 0, [1, 1, 1], surface)
    }
    render(); const perCord = calls
    expect(perCord).toBeLessThan(6000)
    const start = performance.now()
    for (let i = 0; i < 100; i++) render()
    const report = { span: 500, segments: n, heightQueries: perCord, millisecondsPerCord: (performance.now() - start) / 100, iterations: 100, sampler: 'flat function, not procedural terrain' }
    if (process.env.SYN3H_DRAPE_METRICS) (await import('node:fs')).writeFileSync(process.env.SYN3H_DRAPE_METRICS, JSON.stringify(report, null, 2))
  } finally { look.dispose() }
})


// Acceptance regression, intentionally expected to fail on 4e7fec29. The original
// endpoint test starts 2 m above ground, hiding the first-pass endpoint lift.
// Do not mark expected-failure or relax the attachment tolerance to accept the bug.
it('keeps the drawn ground endpoint joined to its actual anchor after first-pass draping', () => {
  const saved = curveParam.value
  params.set('world.curve', 0)
  updateCurve(new THREE.Vector3(), 256)
  const camera = new THREE.PerspectiveCamera(); camera.position.set(5, 8, 20)
  const game = { scene: new THREE.Scene(), camera } as unknown as Game
  const look = new TetherLook(game), slot = look.takeCord()
  const surface: CordSurface = { heightAt: () => 0, cellSize: () => 4, origin: () => -128 }
  try {
    look.begin(camera, 0)
    const anchor = new THREE.Vector3(12, 0, 0), hitch = new THREE.Vector3(0, 2, 0)
    const n = look.segments
    const points = Array.from({ length: n + 1 }, (_, i) => hitch.clone().lerp(anchor, i / n))
    drapeCord(points, points.length, surface)
    look.writeCord(slot, points, 0, 0, [1, 1, 1], surface)
    const positions = look.cord.geometry.getAttribute('position')
    const end = new THREE.Vector3().fromBufferAttribute(positions, n * 2)
      .lerp(new THREE.Vector3().fromBufferAttribute(positions, n * 2 + 1), 0.5)
    // Observe actual output geometry, not a substituted corrected anchor.
    expect(end.distanceTo(anchor)).toBeLessThanOrEqual(0.02)
    for (let i = 0; i <= n * 2 + 1; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i)
      expect(point.y - surface.heightAt(point.x, point.z)).toBeGreaterThanOrEqual(-0.01)
    }
  } finally {
    look.dispose(); params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', saved)
  }
})


// These inspect the actual two indexed triangles per ribbon segment, including
// the contact-adjacent triangles. Sampling is evidence, not a continuum proof.
for (const level of [0, 3]) for (const view of [
  [5, 8, 20], [5, 8, -20], [5, 30, 8], [5, 80, 200],
]) it(`keeps both contact ends and adjoining ribbon triangles clear at tier ${level}, camera ${view}`, () => {
  const savedCurve = curveParam.value, savedQuality = params.get('gfx.quality')!.value
  params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256)
  params.set('gfx.quality', level)
  const camera = new THREE.PerspectiveCamera(); camera.position.fromArray(view)
  const game = { scene: new THREE.Scene(), camera } as unknown as Game
  const look = new TetherLook(game), slot = look.takeCord()
  const surface: CordSurface = { heightAt: () => 0, cellSize: () => 4, origin: () => -128 }
  try {
    look.begin(camera, 0)
    const n = look.segments, first = new THREE.Vector3(0, 0, 0), last = new THREE.Vector3(12, 0, 0)
    const points = Array.from({ length: n + 1 }, (_, i) => first.clone().lerp(last, i / n)
      .add(new THREE.Vector3(0, -3 * Math.sin(Math.PI * i / n), 0)))
    // Avoid a floating-point sine residue at the exact end of this contact fixture.
    points[0].copy(first); points[n].copy(last)
    const positions = look.cord.geometry.getAttribute('position'), index = look.cord.geometry.getIndex()!
    const vertexCount = positions.count, indexCount = index.count
    const material = look.cord.material, sparkMaterial = look.sparks.material
    expect(drapeCord(points, points.length, surface)).toBe(true)
    expect(points[0]).toEqual(first); expect(points[n]).toEqual(last)
    expect(Math.max(...points.map(p => p.y))).toBeLessThanOrEqual(CORD_CLEARANCE + 1e-6)
    look.writeCord(slot, points, 0, 0, [1, 1, 1], surface)
    const at = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, i)
    for (const [i, endpoint] of [[0, first], [n, last]] as const) {
      expect(at(i * 2).distanceTo(endpoint)).toBeLessThanOrEqual(0.02)
      expect(at(i * 2 + 1).distanceTo(endpoint)).toBeLessThanOrEqual(0.02)
    }
    for (let i = 0; i < n * 6; i += 3) {
      const a = at(index.getX(i)), b = at(index.getX(i + 1)), c = at(index.getX(i + 2))
      for (let u = 0; u <= 8; u++) for (let v = 0; v <= 8 - u; v++) {
        const p = a.clone().multiplyScalar(1 - (u + v) / 8).addScaledVector(b, u / 8).addScaledVector(c, v / 8)
        expect(p.y - surface.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(-0.01)
      }
    }
    // Clamping ribbon edges can add at most their ordinary half-width here, not
    // the giant deficit/share spike caused by inconsistent endpoint clearance.
    const halfWidth = Math.max(...points.map(p => Math.max(look.width, camera.position.distanceTo(p) * look.width * 0.03) / 2))
    for (let i = 0; i < (n + 1) * 2; i++) expect(at(i).y).toBeLessThanOrEqual(CORD_CLEARANCE + halfWidth + 1e-5)
    if (view[2] === 200) expect(camera.position.distanceTo(points[1]) * 0.03).toBeGreaterThan(1)
    expect(positions.count).toBe(vertexCount); expect(index.count).toBe(indexCount)
    expect(look.cord.material).toBe(material); expect(look.sparks.material).toBe(sparkMaterial)
    expect(game.scene.children.filter(o => o === look.cord || o === look.sparks)).toHaveLength(2)
  } finally {
    look.dispose(); params.set('gfx.quality', savedQuality)
    params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', savedCurve)
  }
})

it('leaves airborne ribbons identical and does not taper a no-surface ribbon', () => {
  const saved = curveParam.value
  params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256)
  const camera = new THREE.PerspectiveCamera(); camera.position.set(5, 8, 20)
  const game = { scene: new THREE.Scene(), camera } as unknown as Game
  const look = new TetherLook(game), slot = look.takeCord()
  const surface: CordSurface = { heightAt: () => 0, cellSize: () => 4, origin: () => -128 }
  try {
    look.begin(camera, 0)
    const points = Array.from({ length: look.segments + 1 }, (_, i) => new THREE.Vector3(12 * i / look.segments, 20, 0))
    const original = points.map(p => p.clone())
    look.writeCord(slot, points, 0, 0, [1, 1, 1])
    const positions = look.cord.geometry.getAttribute('position')
    const before = Array.from(positions.array)
    expect(drapeCord(points, points.length, surface)).toBe(true)
    expect(points).toEqual(original)
    look.writeCord(slot, points, 0, 0, [1, 1, 1], surface)
    expect(Array.from(positions.array)).toEqual(before)
    // With no sampler even a ground-height endpoint keeps the original width.
    for (const p of points) p.y = 0
    look.writeCord(slot, points, 0, 0, [1, 1, 1])
    const a = new THREE.Vector3().fromBufferAttribute(positions, 0)
    const b = new THREE.Vector3().fromBufferAttribute(positions, 1)
    expect(a.distanceTo(b)).toBeCloseTo(look.width, 5)
    expect(a.clone().lerp(b, 0.5).distanceTo(points[0])).toBeLessThan(1e-6)
  } finally { look.dispose(); params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', saved) }
})

for (const reverse of [false, true]) for (const slack of [false, true])
it(`renders buried-endpoint fallback above an interior ridge, reverse=${reverse}, slack=${slack}`, () => {
  const saved = curveParam.value
  params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256)
  const camera = new THREE.PerspectiveCamera(); camera.position.set(5, 8, 20)
  const game = { scene: new THREE.Scene(), camera } as unknown as Game
  const look = new TetherLook(game), slot = look.takeCord()
  const surface: CordSurface = { heightAt: x => Math.max(0, 4 - Math.abs(x - 6)), cellSize: () => 1, origin: () => 0 }
  // Physical anchors are separate from the disposable visual point array.
  const anchors = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(12, -0.2, 0)]
  if (reverse) anchors.reverse()
  const unchanged = anchors.map(p => p.clone())
  try {
    look.begin(camera, 0)
    const n = look.segments
    const points = Array.from({ length: n + 1 }, (_, i) => anchors[0].clone().lerp(anchors[1], i / n)
      .add(new THREE.Vector3(0, slack ? -6 * Math.sin(Math.PI * i / n) : 0, 0)))
    expect(drapeCord(points, points.length, surface)).toBe(false)
    // The same final-ribbon path used by callers that ignore the return value.
    look.writeCord(slot, points, slack ? 0 : 1, 0, [1, 1, 1], surface)
    const positions = look.cord.geometry.getAttribute('position'), index = look.cord.geometry.getIndex()!
    const at = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, i)
    for (let i = 0; i < n * 6; i += 3) {
      const a = at(index.getX(i)), b = at(index.getX(i + 1)), c = at(index.getX(i + 2))
      for (let u = 0; u <= 8; u++) for (let v = 0; v <= 8 - u; v++) {
        const p = a.clone().multiplyScalar(1 - (u + v) / 8).addScaledVector(b, u / 8).addScaledVector(c, v / 8)
        expect(p.y - surface.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(-0.01)
      }
    }
    const endpoint = reverse ? 0 : n
    const drawn = at(endpoint * 2).lerp(at(endpoint * 2 + 1), 0.5)
    // This is intentionally NOT exact-attachment acceptance. The lifted visual
    // endpoint must be disclosed while the original anchor remains underground.
    expect(drawn.distanceTo(anchors[reverse ? 0 : 1])).toBeGreaterThan(0.02)
    expect(anchors).toEqual(unchanged)
  } finally { look.dispose(); params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', saved) }
})

it('uses visual clearance fallback for the original two-point curved ground span', () => {
  const saved = curveParam.value
  try {
    params.set('world.curve', 1)
    updateCurve(new THREE.Vector3(0, 10, 0), 256)
    const anchors = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0)]
    const points = anchors.map(p => p.clone())
    expect(drapeCord(points, 2, { heightAt: () => 0, cellSize: () => 4, origin: () => -128 })).toBe(false)
    const bent = points.map(p => p.clone().add(curveOffset(p.x, p.y, p.z, new THREE.Vector3())))
    const radius = 256 / (2 * Math.sqrt(Math.PI))
    for (let k = 0; k <= 100; k++) {
      const p = bent[0].clone().lerp(bent[1], k / 100)
      expect(Math.hypot(p.x, p.y + radius, p.z)).toBeGreaterThanOrEqual(radius)
    }
    expect(points[0].distanceTo(anchors[0])).toBeGreaterThan(0.02)
    expect(points[1].distanceTo(anchors[1])).toBeGreaterThan(0.02)
    expect(anchors).toEqual([new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0)])
  } finally { params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', saved) }
})

it('clears a two-point ridge with visual fallback instead of leaving the raw span', () => {
  const saved = curveParam.value
  try {
    params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256)
    const anchors = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)]
    const points = anchors.map(p => p.clone())
    const surface: CordSurface = { heightAt: x => 4 - Math.abs(x - 5) * 0.8, cellSize: () => 1, origin: () => 0 }
    expect(drapeCord(points, points.length, surface)).toBe(false)
    for (let k = 0; k <= 100; k++) {
      const p = points[0].clone().lerp(points[1], k / 100)
      expect(p.y - surface.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(-0.01)
    }
    expect(points[0].distanceTo(anchors[0])).toBeGreaterThan(0.02)
    expect(points[1].distanceTo(anchors[1])).toBeGreaterThan(0.02)
  } finally { params.set('world.curve', 0); updateCurve(new THREE.Vector3(), 256); params.set('world.curve', saved) }
})

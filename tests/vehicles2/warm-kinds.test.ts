import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import * as THREE from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { graphicsLevel } from '../../src/core/quality'
import { VEHICLE_KINDS, createVehicle, type VehicleKind } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { warmVehicleKinds } from '../../src/vehicles/warmKinds'
import { harness } from './harness'

/** A game with systems and a camera, and a stand-in renderer that only calls onBeforeRender. */
function warmGame() {
  const h = harness()
  const systems: System[] = []
  const game = h.game as unknown as Game & { camera: THREE.PerspectiveCamera }
  Object.assign(game, {
    camera: new THREE.PerspectiveCamera(60, 1, 0.1, 5000),
    add: <T extends System>(s: T) => { systems.push(s); return s },
    remove: (s: System) => { const i = systems.indexOf(s); if (i >= 0) { systems.splice(i, 1); s.dispose?.() } },
  })
  game.camera.position.set(3, 4, 5)
  game.scene.add(game.camera)
  const draw = () => {
    const visit = (o: THREE.Object3D) => {
      if (!o.visible) return
      if ((o as THREE.Mesh).isMesh) o.onBeforeRender(null as never, game.scene, game.camera, (o as THREE.Mesh).geometry, (o as THREE.Mesh).material as THREE.Material, null as never)
      o.children.forEach(visit)
    }
    visit(game.scene)
  }
  /** One frame: systems update, then the scene is "drawn" unless skipped. */
  const frame = (drawn = true) => { for (const s of [...systems]) s.update?.(1 / 60, 1); if (drawn) draw() }
  return { ...h, game, systems, frame }
}

async function settle(frame: () => void, until: () => boolean, max = 400) {
  for (let i = 0; i < max && !until(); i++) { frame(); await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }
}

/** Every geometry, material and texture reachable from a vehicle's model. */
function resources(v: Vehicle | THREE.Object3D) {
  const out = new Set<THREE.EventDispatcher<{ dispose: object }>>()
  ;('kind' in v ? v.object : v).traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    out.add(m.geometry)
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      out.add(mat)
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) out.add(value)
    }
  })
  return out
}

beforeAll(initPhysics)
const kinds = VEHICLE_KINDS.map(k => k.kind)
const levelBefore = graphicsLevel.value
afterEach(() => { graphicsLevel.value = levelBefore })

describe('warmVehicleKinds', () => {
  it('draws every registered kind at the camera, parks it out of the scene and disables its body', async () => {
    const { game, world, terrain, systems, frame } = warmGame()
    const sceneBefore = game.scene.children.length
    const bodiesBefore = world.bodies.len()
    const warm = warmVehicleKinds(game, terrain)
    const seen = new Set<VehicleKind>()
    let maxInScene = 0
    await settle(() => {
      frame()
      const s = warm.stats()
      if (s.current) seen.add(s.current)
      maxInScene = Math.max(maxInScene, game.scene.children.length - sceneBefore)
      if (s.current) {
        // While a kind is drawn it sits on the camera, a thousandth of its size.
        const v = (warm as unknown as { current?: { vehicle: Vehicle } }).current?.vehicle
        if (v?.object.visible) { expect(v.object.scale.x).toBeCloseTo(1e-3); expect(v.object.position.distanceTo(game.camera.position)).toBeLessThan(1e-6) }
      }
    }, () => warm.stats().parked.length === kinds.length)
    const s = warm.stats()
    expect([...seen].sort()).toEqual([...kinds].sort())
    expect(s.parked.sort()).toEqual([...kinds].sort())
    // The tank is all model files, which load only in a browser: in Node it has no mesh and
    // is parked at once instead of waiting forever for a draw.
    expect(s.undrawn).toEqual(['tank'])
    for (const k of kinds) if (k !== 'tank') expect(s.frames[k]).toBeGreaterThanOrEqual(3)
    expect(s.notReady).toEqual([])
    // One kind at a time, and nothing left in the scene afterwards.
    expect(maxInScene).toBeLessThanOrEqual(1)
    expect(game.scene.children.length).toBe(sceneBefore)
    for (const k of kinds) {
      const v = warm.parked(k)!
      expect(v.kind).toBe(k)
      expect(v.object.parent).toBeNull()
      expect(v.body.isEnabled()).toBe(false)
    }
    // The parked copies keep their bodies until disposal, then the world is as it was.
    expect(world.bodies.len()).toBe(bodiesBefore + kinds.length)
    warm.dispose()
    expect(world.bodies.len()).toBe(bodiesBefore)
    expect(systems).not.toContain(warm)
  })

  it('releases what warming built, except caches every vehicle of that kind shares', async () => {
    const { game, terrain, frame } = warmGame()
    const warm = warmVehicleKinds(game, terrain)
    await settle(frame, () => warm.stats().parked.length === kinds.length)
    const disposed = new Set<object>()
    const built = new Map<VehicleKind, Set<THREE.EventDispatcher<{ dispose: object }>>>()
    // Known leak, not warming's: Syn3hBuggy.dispose never frees its primitive stand-in model.
    // The fix is reported to the vehicle lane; until it lands these are allowed, nothing else.
    const knownLeak = resources((warm.parked('buggy') as unknown as { fallback: THREE.Object3D }).fallback)
    expect(knownLeak.size).toBe(6) // three geometries, three materials
    for (const k of kinds) {
      const set = resources(warm.parked(k)!)
      if (k !== 'tank') expect(set.size).toBeGreaterThan(0)
      built.set(k, set)
      for (const r of set) r.addEventListener('dispose', () => disposed.add(r))
    }
    warm.dispose()
    for (const k of kinds) {
      // What survives disposal must be a shared cache: a fresh vehicle of the kind uses it too.
      const fresh = createVehicle(game, terrain, k, new THREE.Vector3(0, 50, 0))
      fresh.update(1 / 60, 1)
      const shared = resources(fresh)
      const kept = [...built.get(k)!].filter(r => !disposed.has(r))
      for (const r of kept) expect(shared.has(r) || knownLeak.has(r), `${k}: ${(r as { type?: string }).type} kept but not shared`).toBe(true)
      fresh.dispose()
    }
  })

  it('waits for frames that really draw', async () => {
    const { game, terrain, frame } = warmGame()
    const warm = warmVehicleKinds(game, terrain, { kinds: ['jet'] })
    for (let i = 0; i < 50; i++) frame(false)
    await Promise.resolve(); await new Promise(r => setTimeout(r, 0))
    for (let i = 0; i < 50; i++) frame(false)
    expect(warm.stats().parked).toEqual([])
    await settle(frame, () => warm.stats().parked.length === 1)
    expect(warm.stats().parked).toEqual(['jet'])
    warm.dispose()
  })

  it('builds every kind again after a graphics level change and only then lets the old copy go', async () => {
    const { game, terrain, frame } = warmGame()
    const warm = warmVehicleKinds(game, terrain, { kinds: ['jet', 'tank'] })
    await settle(frame, () => warm.stats().parked.length === 2)
    const oldJet = warm.parked('jet')!
    let oldGone = false
    const anyMat = resources(oldJet)
    const firstMat = [...anyMat].find(r => r instanceof THREE.Material)!
    firstMat.addEventListener('dispose', () => { oldGone = true })
    graphicsLevel.value = (graphicsLevel.value === 2 ? 1 : 2) as typeof graphicsLevel.value
    await settle(frame, () => warm.stats().rounds === 2 && warm.stats().current === 'jet')
    // The new jet is being drawn and the old one still holds the pipelines.
    expect(oldGone).toBe(false)
    expect(warm.parked('jet')).toBe(oldJet)
    await settle(frame, () => warm.stats().parked.length === 2)
    expect(warm.parked('jet')).not.toBe(oldJet)
    expect(warm.stats().built).toBe(4)
    warm.dispose()
  })
})

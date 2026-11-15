import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { GameHover } from '../../src/vehicles/hovergen/GameHover'
import { HERITAGE_DESIGNS, HERITAGE_EYE } from '../../src/vehicles/hovergen/heritage'
import { generateTerrain } from '../../src/world/terrain/generate'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import { lavaSurfaceAt } from '../../src/world/terrain/lava'
import { spawnPointAt } from '../../src/world/terrain/spawn'
import { harness } from './harness'

/** hover.body: the round two studies worn by the game's hovercraft. 0 stays the original. */
beforeAll(initPhysics)
afterEach(() => { params.set('hover.body', 0) })

const study = (v: Hovercraft) => (v as unknown as { study?: GameHover }).study
function fly(body: number, steps: number): number[] {
  params.set('hover.body', body)
  const h = harness(9.81, false); h.terrain.heightAt = () => 0
  const v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 2.5, 0)); v.isLocal = false; v.input.y = 1
  for (let i = 0; i < steps; i++) { v.input.x = i > 60 && i < 140 ? 1 : 0; h.step(v); v.update(.02, .5) }
  const p = v.body.translation(), r = v.body.rotation()
  v.dispose(); h.world.free()
  return [p.x, p.y, p.z, r.x, r.y, r.z, r.w]
}

describe('hovercraft body option', () => {
  it('keeps the original body by default, without a cockpit flag', () => {
    const h = harness(), v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 3, 0))
    expect(params.get('hover.body')!.value).toBe(0)
    expect(study(v)).toBeUndefined()
    expect(v.object.userData.cockpit).toBe(false)
    expect(v.ridePosition.position.z).toBeCloseTo(-.497794)
    v.dispose(); h.world.free()
  })

  for (const [i, design] of HERITAGE_DESIGNS.entries()) {
    it(`wears ${design.name} with a cockpit, a covering hull and three detail levels`, () => {
      params.set('hover.body', i + 1)
      const h = harness(9.81, false); h.terrain.heightAt = () => 0
      const camera = { position: new T.Vector3(0, 3, 0) }
      ;(h.game as unknown as { camera: typeof camera }).camera = camera
      const v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 2.5, 0)); v.isLocal = false
      const s = study(v)!
      expect(s.design.id).toBe(design.id)
      expect(v.object.userData.cockpit).toBe(true)
      expect(v.ridePosition.position.toArray()).toEqual(HERITAGE_EYE)
      // The eye is inside the body and clear of every surface (PATTERN.md rule 3).
      expect(s.bounds.containsPoint(v.ridePosition.position)).toBe(true)
      expect(s.levels[0].cockpitClearance).toBeGreaterThanOrEqual(.25)
      h.step(v, 150); v.update(.02, 1)
      // The collision cuboid is the close model's bounds, floor clamped to the origin plane.
      const c = v.body.collider(0), half = c.halfExtents()!, q = new T.Quaternion().copy(v.body.rotation()).invert()
      const centre = new T.Vector3().copy(c.translation()).sub(new T.Vector3().copy(v.body.translation())).applyQuaternion(q)
      const size = s.bounds.getSize(new T.Vector3())
      expect(half.x * 2).toBeCloseTo(size.x, 4); expect(half.z * 2).toBeCloseTo(size.z, 4)
      expect(centre.y + half.y).toBeCloseTo(s.bounds.max.y, 4)
      expect(centre.z).toBeCloseTo((s.bounds.min.z + s.bounds.max.z) / 2, 4)
      // It glides at the usual clearance.
      expect(v.body.translation().y).toBeCloseTo(2.5, 1)
      // Remote copies drop to the reduced model past 30 m and the silhouette past 120 m.
      const visible = () => s.levels.map(l => l.object.visible)
      expect(visible()).toEqual([true, false, false])
      camera.position.set(60, 3, 0); v.update(.02, 1); expect(visible()).toEqual([false, true, false])
      camera.position.set(300, 3, 0); v.update(.02, 1); expect(visible()).toEqual([false, false, true])
      v.isLocal = true; v.update(.02, 1); expect(visible()).toEqual([true, false, false])
      // Steering turns the exhaust vanes; colours reach every level.
      v.input.x = 1; v.update(.02, 1)
      expect(s.levels[0].thruster.rotation.y).toBeCloseTo(-.35)
      v.setColors('#ff0000', '#00ff00')
      for (const level of s.levels) expect((level.object.userData.vehicleColors.body as T.Color).getHexString()).toBe('ff0000')
      v.dispose(); h.world.free()
    })
  }

  it('drives every body exactly like the original over open ground', () => {
    const original = fly(0, 250)
    expect(Math.abs(original[0])).toBeGreaterThan(1)
    for (const body of [1, 3, 5]) expect(fly(body, 250)).toEqual(original)
  })

  it('switches body live and releases the previous one', () => {
    const h = harness(9.81, false); h.terrain.heightAt = () => 0
    const v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 2.5, 0)); v.isLocal = false
    const children = v.object.children.length
    params.set('hover.body', 2); v.update(.02, 1)
    expect(study(v)!.design.id).toBe('h2-flare')
    expect(v.object.userData.cockpit).toBe(true)
    expect(v.object.children.length).toBe(children)
    const first = study(v)!
    params.set('hover.body', 4); v.update(.02, 1); h.step(v, 5)
    expect(study(v)!.design.id).toBe('h2-bridge')
    expect(first.object.parent).toBeNull()
    expect(v.object.children.length).toBe(children)
    params.set('hover.body', 0); v.update(.02, 1); h.step(v, 5)
    expect(study(v)).toBeUndefined()
    expect(v.object.userData.cockpit).toBe(false)
    expect(v.object.children.length).toBe(children)
    expect(v.body.collider(0).halfExtents()!.x).toBeCloseTo(1.27)
    v.dispose(); h.world.free()
  })

  it('keeps a study\'s longer hull clear of the ground through the island route', () => {
    params.set('hover.body', 1)
    const h = harness(9.81, false), data = generateTerrain(1, defaultTerrainSettings()), sampler = new HeightSampler(data)
    h.terrain.heightAt = (x, z) => sampler.heightAt(x, z); h.terrain.normalAt = (x, z, out) => sampler.normalAt(x, z, out)
    h.terrain.liquidHeightAt = (x, z) => lavaSurfaceAt(data.lava, x, z, 0)
    createTerrainCollider(h.world, data); h.world.step()
    const spawn = spawnPointAt(sampler, 0), v = new Hovercraft(h.game, h.terrain, new T.Vector3(spawn.x, spawn.y, spawn.z), spawn.heading)
    v.isLocal = false; v.input.y = 1
    const b = study(v)!.bounds, point = new T.Vector3()
    let min = Infinity
    for (let i = 0; i < 1000; i++) {
      v.input.x = i >= 350 && i < 425 ? -1 : i >= 600 && i < 675 ? 1 : 0; h.step(v); v.update(.02, .5)
      for (const [p, q] of [[v.body.translation(), v.body.rotation()], [v.object.position, v.object.quaternion]] as const) {
        for (let x = b.min.x; x <= b.max.x; x += .25) for (let z = b.min.z; z <= b.max.z; z += .25) { point.set(x, Math.max(0, b.min.y), z).applyQuaternion(q).add(p); min = Math.min(min, point.y - sampler.heightAt(point.x, point.z)) }
      }
    }
    expect(min).toBeGreaterThanOrEqual(0)
    v.dispose(); h.world.free()
  }, 20000)
})

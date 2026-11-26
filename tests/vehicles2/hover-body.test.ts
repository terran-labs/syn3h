import { beforeAll, describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { vehicleShading } from '../../src/core/quality'
import { LOD_NEAR } from '../../src/vehicles/skins/mergeStatic'
import { Hovercraft, HOVER_DESIGN } from '../../src/vehicles/Hovercraft'
import { GameHover } from '../../src/vehicles/hover/GameHover'
import { R3_EYE } from '../../src/vehicles/hovergen/round3'
import { R4_DESIGNS } from '../../src/vehicles/hovergen/round4'
import { generateTerrain } from '../../src/world/terrain/generate'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import { lavaSurfaceAt } from '../../src/world/terrain/lava'
import { spawnPointAt } from '../../src/world/terrain/spawn'
import { harness } from './harness'

/** The game's hovercraft wears exactly one generated design: no model file, no selector. */
beforeAll(initPhysics)
const study = (v: Hovercraft) => (v as unknown as { study: GameHover }).study

describe('the generated hovercraft body', () => {
  it('is one round four design, with no body selector and no loading state', async () => {
    expect(R4_DESIGNS.map(d => d.id)).toContain(HOVER_DESIGN.id)
    expect(params.get('hover.body')).toBeUndefined()
    const h = harness(), v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 3, 0))
    await v.modelReady
    expect(study(v).design).toBe(HOVER_DESIGN)
    v.dispose(); h.world.free()
  })

  it('has a cockpit, a covering hull, three detail levels, live colours and steering vanes', () => {
    const h = harness(9.81, false); h.terrain.heightAt = () => 0
    const camera = { position: new T.Vector3(0, 3, 0) }
    ;(h.game as unknown as { camera: typeof camera }).camera = camera
    const v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 2.5, 0)); v.isLocal = false
    const s = study(v)
    expect(v.object.userData.cockpit).toBe(true)
    // Its lamps are part of the body, so the shared effects add no lamp spheres of their own.
    expect(v.object.userData.ownLamps).toBe(true)
    expect(v.ridePosition.position.toArray()).toEqual(R3_EYE)
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
    // It glides at the usual clearance with the original's mass.
    expect(v.body.translation().y).toBeCloseTo(2.5, 1)
    expect(v.body.mass()).toBeCloseTo(50)
    // Remote copies drop to the reduced model past 30 m and the silhouette past 120 m.
    const visible = () => s.levels.map(l => l.object.visible)
    expect(visible()).toEqual([true, false, false])
    camera.position.set(60, 3, 0); v.update(.02, 1); expect(visible()).toEqual([false, true, false])
    camera.position.set(300, 3, 0); v.update(.02, 1); expect(visible()).toEqual([false, false, true])
    v.isLocal = true; v.update(.02, 1); expect(visible()).toEqual([true, false, false])
    v.input.x = 1; v.update(.02, 1)
    if (s.levels[0].thruster.children.length) expect(s.levels[0].thruster.rotation.y).toBeCloseTo(-.35)
    v.setColors('#ff0000', '#00ff00')
    for (const level of s.levels) expect((level.object.userData.vehicleColors.body as T.Color).getHexString()).toBe('ff0000')
    const children = v.object.children.length
    v.dispose(); h.world.free()
    expect(s.object.parent).toBeNull(); expect(children).toBe(2)
  })

  it('keeps remote geometry and shading on the same side of a detail boundary after parking', () => {
    const h = harness(), position = new T.Vector3(0, 3, 0)
    const camera = { position: position.clone() }
    Object.assign(h.game, { camera })
    const v = new Hovercraft(h.game, h.terrain, position)
    v.isLocal = false
    try {
      camera.position.x = LOD_NEAR * 2
      v.update(0, 1)
      camera.position.x = LOD_NEAR - 1
      v.update(0, 1)
      const level = study(v).detail
      expect(level).toBe(1)
      v.resetForWorld()
      v.update(0, 1)
      expect(study(v).detail).toBe(level)
    } finally { v.dispose(); h.world.free() }
  })

  it('rests its vanes and extinguishes drive glow in a zorb, then resumes on exit', () => {
    const h = harness(), v = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 3, 0))
    v.isLocal = false
    const s = study(v)
    // The drive glow is the exhaust on the shared thruster shader (GameHover's plume): its rear
    // and lift strengths, which the shader multiplies every light by.
    const glow = () => { const [, rear, , lift] = s.plume.levels; return [rear, lift] }
    v.input.x = 1; v.input.y = 1; v.input.brakes = true
    v.update(.02, 1)
    expect(s.levels[0].thruster.rotation.y).toBeCloseTo(-.35)
    expect(glow().length).toBeGreaterThan(0)
    expect(glow().every(n => n > 0)).toBe(true)
    v.input.zorb = true; h.step(v, 100); v.update(.02, 1)
    expect(v.zorbed).toBe(true)
    expect(s.levels[0].thruster.rotation.y).toBeCloseTo(0)
    expect(glow().every(n => n === 0)).toBe(true)
    // A detail switch must not bring the idle glow back inside the ball.
    s.setLevel(1); s.update(0, 0, false, false)
    expect(glow().length).toBeGreaterThan(0)
    expect(glow().every(n => n === 0)).toBe(true)
    v.input.zorb = false; h.step(v, 100); v.update(.02, 1)
    expect(v.zorbed).toBe(false)
    expect(glow().every(n => n > 0)).toBe(true)
    v.dispose(); h.world.free()
  })

  it('keeps two moving duct fans inside the nozzle and stops them in the zorb', () => {
    const s = new GameHover(HOVER_DESIGN), fan = s.levels[0].fan!
    expect(fan.object.count).toBe(2)
    expect(s.levels[1].fan).toBeUndefined()
    const pose = () => Array.from(fan.object.instanceMatrix.array)
    const first = pose()
    s.update(0, 1, false, true, .02)
    expect(pose()).not.toEqual(first)
    const turning = pose()
    s.update(1, 1, true, false, .1)
    expect(pose()).toEqual(turning)
    s.update(0, 0, false, true, .02)
    expect(pose()).not.toEqual(turning)
    // Check the swept geometry, not just the starting pose, against the duct lip.
    const matrix = new T.Matrix4(), point = new T.Vector3(), p = fan.object.geometry.getAttribute('position')
    for (let frame = 0; frame < 100; frame++) {
      s.update(0, 1, false, true, .02)
      for (let instance = 0; instance < 2; instance++) {
        fan.object.getMatrixAt(instance, matrix)
        for (let j = 0; j < p.count; j++) {
          point.fromBufferAttribute(p, j).applyMatrix4(matrix).add(fan.object.position)
          expect(Math.abs(point.x)).toBeLessThan(.38)
          expect(Math.abs(point.y - fan.object.position.y)).toBeLessThan(.12)
          expect(point.z).toBeGreaterThan(1.90)
          expect(point.z).toBeLessThan(1.95)
        }
      }
    }
    expect(s.levels[0].triangles()).toBeLessThanOrEqual(12000)
    s.dispose()
  })

  it('keeps its whole hull clear of the ground through the island route', () => {
    const h = harness(9.81, false), data = generateTerrain(1, defaultTerrainSettings()), sampler = new HeightSampler(data)
    h.terrain.heightAt = (x, z) => sampler.heightAt(x, z); h.terrain.normalAt = (x, z, out) => sampler.normalAt(x, z, out)
    h.terrain.liquidHeightAt = (x, z) => lavaSurfaceAt(data.lava, x, z, 0)
    createTerrainCollider(h.world, data); h.world.step()
    const spawn = spawnPointAt(sampler, 0), v = new Hovercraft(h.game, h.terrain, new T.Vector3(spawn.x, spawn.y, spawn.z), spawn.heading)
    v.isLocal = false; v.input.y = 1
    const b = study(v).bounds, point = new T.Vector3()
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

describe('shared hovercraft geometry', () => {
  it('builds each level once and shares it between craft, with separate materials', async () => {
    const { hoverBuilds } = await import('../../src/vehicles/hover/HoverBody')
    const first = new GameHover(HOVER_DESIGN), before = hoverBuilds.count
    const second = new GameHover(HOVER_DESIGN), third = new GameHover(HOVER_DESIGN)
    // Later craft generate nothing.
    expect(hoverBuilds.count).toBe(before)
    const meshes = (g: GameHover, level: number) => { const list: T.Mesh[] = []; g.levels[level].object.traverse(o => { if (o instanceof T.Mesh) list.push(o) }); return list }
    for (const level of [0, 1, 2]) {
      const a = meshes(first, level), b = meshes(second, level)
      expect(b.length).toBe(a.length)
      expect(b.length).toBeGreaterThan(0)
      // Same geometry objects, in some order; no material shared.
      expect(new Set(b.map(m => m.geometry))).toEqual(new Set(a.map(m => m.geometry)))
      for (const m of b) expect(a.map(x => x.material)).not.toContain(m.material)
      expect(second.levels[level].triangles()).toBe(first.levels[level].triangles())
    }
    expect(second.bounds.equals(first.bounds)).toBe(true)
    expect(second.levels[0].cockpitClearance).toBe(first.levels[0].cockpitClearance)
    expect(second.levels[0].thruster.position.equals(first.levels[0].thruster.position)).toBe(true)
    expect(second.levels[0].thruster.children.length).toBe(first.levels[0].thruster.children.length)
    // Colours stay per craft.
    second.setColors('#ff0000', '#00ff00'); third.setColors('#0000ff', '#ffffff')
    const body = (g: GameHover) => (g.levels[0].object.userData.vehicleColors.body as T.Color).getHexString()
    expect([body(second), body(third)]).toEqual(['ff0000', '0000ff'])
    expect(body(first)).not.toBe('ff0000')
    // Disposing one craft leaves the shared geometry alive for the others.
    let disposed = 0
    for (const m of meshes(second, 0)) m.geometry.addEventListener('dispose', () => { disposed++ })
    first.dispose(); third.dispose()
    expect(disposed).toBe(0)
    second.dispose()
  })
})

it('shares plain hovercraft graphs while keeping each craft’s paint, lamps and material lifetime', () => {
  const savedTier = vehicleShading.value
  params.set(vehicleShading.def.id, 0)
  const h = harness()
  const first = new Hovercraft(h.game, h.terrain, new T.Vector3(0, 3, 0))
  const second = new Hovercraft(h.game, h.terrain, new T.Vector3(10, 3, 0))
  const packedMesh = (vehicle: Hovercraft, level: 0 | 1) => {
    const mesh = study(vehicle).levels[level].object.children.find(node =>
      node instanceof T.Mesh && node.geometry.hasAttribute('surfaceId'))
    if (!(mesh instanceof T.Mesh)) throw new Error('Expected the packed hovercraft hull')
    return mesh as T.Mesh<T.BufferGeometry, T.MeshStandardNodeMaterial>
  }
  const valuesFor = (mesh: T.Mesh<T.BufferGeometry, T.MeshStandardNodeMaterial>, channel: 'colorNode' | 'emissiveNode') => {
    const values: unknown[] = []
    mesh.material[channel]?.traverse(node => {
      const n = node as unknown as { updateType?: string; update?: (frame: unknown) => void; value?: unknown }
      if (n.updateType === 'object') n.update?.({ object: mesh, material: mesh.material })
      if ('value' in n) values.push(n.value)
    })
    return values
  }
  let disposedFirst = false
  try {
    first.setColors(0xff0000, 0x00ff00)
    second.setColors(0x0000ff, 0xffffff)
    for (const level of [0, 1] as const) {
      const a = packedMesh(first, level), b = packedMesh(second, level)
      expect(a.material).toBe(b.material)
      const paintA = study(first).levels[level].object.userData.vehicleColors.body
      const paintB = study(second).levels[level].object.userData.vehicleColors.body
      expect(valuesFor(a, 'colorNode')).toContain(paintA)
      expect(valuesFor(b, 'colorNode')).toContain(paintB)
      expect(valuesFor(b, 'colorNode')).not.toContain(paintA)

      study(first).levels[level].setLights(true, true)
      study(second).levels[level].setLights(false, false)
      const tail = new T.Color(0xff1605)
      expect(valuesFor(a, 'emissiveNode')).toContainEqual(tail.clone().multiplyScalar(1.5))
      expect(valuesFor(b, 'emissiveNode')).toContainEqual(tail.clone().multiplyScalar(.08))
      expect(valuesFor(b, 'emissiveNode')).not.toContainEqual(tail.clone().multiplyScalar(1.5))
    }
    const survivor = packedMesh(second, 0)
    let survivorDisposed = false
    survivor.material.addEventListener('dispose', () => { survivorDisposed = true })
    first.dispose()
    disposedFirst = true
    expect(survivorDisposed).toBe(false)
    expect(valuesFor(survivor, 'colorNode')).toContain(
      study(second).levels[0].object.userData.vehicleColors.body,
    )
  } finally {
    if (!disposedFirst) first.dispose()
    second.dispose()
    params.set(vehicleShading.def.id, savedTier)
    h.world.free()
  }
})

describe('hovercraft lights', () => {
  it('has every lamp surface and beam origin on the body, never in the air beside it', async () => {
    const { LOWWING, buildDuctHover } = await import('../../src/vehicles/hover/lowwing')
    for (const detail of [.55, .4, .16]) {
      const build = buildDuctHover(LOWWING, detail)
      // On the body: inside the hull, or within 8 cm of it across or along the craft.
      const near = (x: number, y: number, z: number) => [0, .04, .08].some(d => build.inside(x - Math.sign(x) * d, y, z) || build.inside(x, y, z + d) || build.inside(x, y, z - d) || build.inside(x, y - d, z) || build.inside(x, y + d, z))
      let checked = 0
      for (const lamp of [...build.head, ...build.tail]) {
        const p = lamp.getAttribute('position')
        for (let i = 0; i < p.count; i++) { checked++; expect(near(p.getX(i), p.getY(i), p.getZ(i)), `lamp vertex ${p.getX(i).toFixed(2)}, ${p.getY(i).toFixed(2)}, ${p.getZ(i).toFixed(2)} at detail ${detail}`).toBe(true) }
      }
      expect(checked).toBeGreaterThan(100)
      expect(build.beams.length).toBe(2)
      for (const [x, y, z] of build.beams) expect(near(x, y, z), `beam origin ${x}, ${y.toFixed(2)}, ${z.toFixed(2)}`).toBe(true)
      for (const g of [...build.builder.pieces.map(q => q.geometry), ...build.head, ...build.tail]) g.dispose()
    }
  })
})

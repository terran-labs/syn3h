import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { FLORA, type Ground, type Plant, setTint } from '../../src/world/terrain/flora'
import { COVER_LEVELS, GroundCover, MAX_PLANT_HEIGHT, flowAt, hueMatrix, plantTop } from '../../src/world/terrain/groundcover'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'

/** Looks that grow something: all but ice (4) and the moon (7). */
const KINDS = [0, 1, 2, 3, 5, 6, 8]
const KIND_VOLCANIC = 0

function ground(over: Partial<Ground> = {}): Ground {
  return {
    x: 10, z: 20, y: 30, patch: 0.7, region: 0.6, rock: 0.1, flow: 0, clumpD: 0.3, clump: 0.5, outX: 1, outZ: 0, treeLine: 100,
    ...over,
  }
}

const plant = (): Plant => ({ scale: 0, r: 1, g: 1, b: 1, lx: 0, lz: 0 })

describe('vegetation', () => {
  it('leaves ice and the moon bare', () => {
    expect(FLORA[4].layers(100)).toEqual([])
    expect(FLORA[7].layers(100)).toEqual([])
  })

  it('gives every planet that grows something layers whose shapes fit in eight vertex buffers', () => {
    for (const kind of KINDS) {
      const layers = FLORA[kind].layers(100)
      expect(layers.length).toBeGreaterThan(1)
      // Exactly one layer shades the ground, on the coverage grid.
      const shading = layers.filter((l) => l.shade)
      expect(shading.length).toBe(1)
      expect(shading[0].n).toBe(176)
      expect(shading[0].spacing).toBe(0.8)
      for (const l of layers) {
        const names = Object.keys(l.geometry.attributes).sort()
        // Three per vertex; the instances add four. WebGPU allows eight.
        expect(names).toEqual(['aShape', 'color', 'position'])
        expect(l.geometry.getAttribute('aShape').itemSize).toBe(4)
        expect(l.geometry.getAttribute('position').count % 3).toBe(0)
      }
    }
  })

  it('keeps every plant on every planet under the height cap, and most well under it', () => {
    const report: string[] = []
    for (const kind of KINDS) {
      FLORA[kind].layers(100).forEach((l, i) => {
        const top = plantTop(l.geometry)
        let most = 0
        for (let h = 0; h < 20000; h++) {
          for (const flow of [0, 1]) {
            const p = plant()
            l.grow(ground({ flow, patch: (h % 10) / 10, region: (h % 7) / 7 }), (h * 2654435761) >>> 0, p)
            most = Math.max(most, p.scale)
          }
        }
        const capped = top * Math.min(most, MAX_PLANT_HEIGHT / top)
        report.push(`${kind}.${i} ${(top * most).toFixed(2)}->${capped.toFixed(2)}`)
        expect(capped).toBeLessThanOrEqual(MAX_PLANT_HEIGHT + 1e-6)
      })
    }
    process.stdout.write(`plant heights (look.layer uncapped->capped, m): ${report.join(' ')}\n`)
  })

  it('decides what grows from the ground and the cell alone', () => {
    for (const kind of KINDS) {
      for (const l of FLORA[kind].layers(100)) {
        for (let h = 1; h < 4000; h += 97) {
          const a = plant(), b = plant()
          l.grow(ground(), h * 2654435761 >>> 0, a)
          l.grow(ground(), h * 2654435761 >>> 0, b)
          expect(a).toEqual(b)
          expect(Number.isFinite(a.scale) && a.scale >= 0).toBe(true)
        }
      }
    }
  })

  it('grows more alien plants beside the lava than away from it', () => {
    const [, anemones] = FLORA[KIND_VOLCANIC].layers(100)
    const count = (flow: number) => {
      let n = 0
      for (let h = 0; h < 20000; h++) {
        const p = plant()
        anemones.grow(ground({ flow, patch: 0.5 }), (h * 2654435761) >>> 0, p)
        if (p.scale > 0) n++
      }
      return n
    }
    expect(count(1)).toBeGreaterThan(count(0) * 4)
  })

  it('keeps volcanic plants in one warm family with a rare cold accent', () => {
    const [, anemones] = FLORA[KIND_VOLCANIC].layers(100)
    let warm = 0, cold = 0
    for (let h = 0; h < 40000; h++) {
      const p = plant()
      anemones.grow(ground({ flow: 1 }), (h * 2654435761) >>> 0, p)
      if (!(p.scale > 0)) continue
      if (p.b > p.r) cold++
      else warm++
    }
    const share = cold / (warm + cold)
    expect(share).toBeGreaterThan(0.02)
    expect(share).toBeLessThan(0.09)
  })

  it('stores tints in linear light, as the renderer expects', () => {
    const p = plant()
    setTint(p, 0xff8040, 0, 0)
    const c = new THREE.Color(0xff8040)
    expect(p.r).toBeCloseTo(c.r, 5)
    expect(p.g).toBeCloseTo(c.g, 5)
    // sRGB 0x80 is about 0.22 in linear light, not 0.5.
    expect(p.g).toBeLessThan(0.3)
  })

  it('measures closeness to rivers and pools, falling to nothing far away', () => {
    const data = generateTerrain(3, defaultTerrainSettings())
    const sampler = new HeightSampler(data)
    const pool = data.lava.pools[0]
    expect(flowAt(sampler, pool.x + pool.radius, pool.z, 100)).toBeCloseTo(1, 5)
    const r = data.lava.rivers[0]
    const m = r.points[Math.floor(r.points.length / 2)]
    expect(flowAt(sampler, m.x, m.z, 100)).toBe(1)
    // High above the sea, 40 m from a pool: less than at its edge (another river may be near).
    expect(flowAt(sampler, pool.x + pool.radius + 40, pool.z, 500)).toBeLessThan(1)
  })

  it('gives the main grass of every planet a far shape of the same height and far fewer triangles', () => {
    for (const kind of KINDS) {
      const grass = FLORA[kind].layers(100).find((l) => l.shade)!
      expect(grass.far).toBeDefined()
      const full = grass.geometry.getAttribute('position').count / 3
      const cheap = grass.far!.getAttribute('position').count / 3
      expect(cheap).toBeLessThanOrEqual(full / 4)
      // Flowers and seed grasses with a far shape: at most half the triangles, as tall within 5 cm.
      for (const l of FLORA[kind].layers(100)) {
        if (!l.far || l.shade) continue
        expect(l.far.getAttribute('position').count).toBeLessThanOrEqual(l.geometry.getAttribute('position').count / 2)
        expect(Math.abs(plantTop(l.far) - plantTop(l.geometry))).toBeLessThan(0.05)
      }
      expect(plantTop(grass.far!)).toBeCloseTo(plantTop(grass.geometry), 5)
      expect(Object.keys(grass.far!.attributes).sort()).toEqual(['aShape', 'color', 'position'])
    }
  })

  it('offers six budgets that never grow less at a higher level', () => {
    expect(COVER_LEVELS.length).toBe(6)
    for (let i = 1; i < COVER_LEVELS.length; i++) {
      const a = COVER_LEVELS[i - 1], b = COVER_LEVELS[i]
      for (const k of ['density', 'reach', 'detailNear', 'flowers', 'nightlife'] as const) expect(b[k]).toBeGreaterThanOrEqual(a[k])
      expect(Number(b.bend)).toBeGreaterThanOrEqual(Number(a.bend))
    }
  })

  it('turns plant colours round the wheel without changing greys or brightness', () => {
    const grey = new THREE.Vector3(0.4, 0.4, 0.4).applyMatrix3(hueMatrix(137))
    expect(grey.x).toBeCloseTo(0.4, 6); expect(grey.y).toBeCloseTo(0.4, 6); expect(grey.z).toBeCloseTo(0.4, 6)
    const red = new THREE.Vector3(1, 0, 0)
    expect(red.clone().applyMatrix3(hueMatrix(0)).distanceTo(red)).toBeLessThan(1e-6)
    // A third of a turn takes red to green, and the sum of the channels is kept.
    const turned = red.clone().applyMatrix3(hueMatrix(120))
    expect(turned.y).toBeCloseTo(1, 5)
    expect(turned.x + turned.y + turned.z).toBeCloseTo(1, 5)
  })

  it('gives the glowing worlds night life, in their own colours, and the desert none', () => {
    const motes = (kind: number) => FLORA[kind].layers(100).filter((l) => l.motes)
    for (const kind of [0, 2, 3, 5, 8]) expect(motes(kind).length).toBe(1)
    for (const kind of [1, 6]) expect(motes(kind).length).toBe(0)
    // Volcanic spores gather along the lava and are warm, with a rare cyan one.
    const [spores] = motes(KIND_VOLCANIC)
    const count = (flow: number) => {
      let n = 0, cold = 0
      for (let h = 0; h < 20000; h++) {
        const p = plant()
        spores.grow(ground({ flow, patch: 0.5 }), (h * 2654435761) >>> 0, p)
        if (p.scale > 0) { n++; if (p.b > p.r) cold++ }
      }
      return { n, cold }
    }
    const lava = count(1), away = count(0)
    expect(lava.n).toBeGreaterThan(away.n * 4)
    expect(lava.cold / lava.n).toBeGreaterThan(0.02)
    expect(lava.cold / lava.n).toBeLessThan(0.12)
    // Every vertex of a mote is marked as one and glows.
    const shape = spores.geometry.getAttribute('aShape')
    for (let i = 0; i < shape.count; i++) { expect(shape.getX(i)).toBe(3); expect(shape.getZ(i)).toBe(1) }
  })

  describe('drawing round the camera', () => {
    const settings = defaultTerrainSettings()
    settings.look = 1
    const data = generateTerrain(7, settings)
    const sampler = new HeightSampler(data)
    const pad = data.layout.spawns[2]
    /** A meadow a short drive from a pad, where every layer grows something. */
    const start = { x: pad.x - pad.dirZ * 45, z: pad.z + pad.dirX * 45 }

    function coverAt(x: number, z: number, level = 2) {
      const camera = new THREE.PerspectiveCamera()
      camera.position.set(x, 0, z)
      const scene = new THREE.Scene()
      const cover = new GroundCover(scene, sampler, camera)
      cover.setLevel(level)
      cover.update()
      return { cover, camera, scene }
    }

    /** Every plant drawn, as sorted text, so two covers can be compared whatever their slot order. */
    function plants(scene: THREE.Scene): string[] {
      const out: string[] = []
      for (const mesh of scene.getObjectByName('groundcover')!.children as THREE.Mesh[]) {
        const g = mesh.geometry as THREE.InstancedBufferGeometry
        const o = g.getAttribute('aOrigin'), p = g.getAttribute('aParam')
        for (let k = 0; k < g.instanceCount; k++) out.push(`${o.getX(k).toFixed(3)} ${o.getZ(k).toFixed(3)} ${p.getY(k).toFixed(4)}`)
      }
      return out.sort()
    }

    it('replants a little each frame and ends with exactly what a fresh start would plant', () => {
      const a = coverAt(start.x, start.z)
      expect(a.cover.stats().drawn.reduce((x, y) => x + y, 0)).toBeGreaterThan(500)
      // Crawl: the smallest slice each frame, while driving 60 m at 30 m/s.
      a.cover.sliceMs = 0
      let lagged = 0
      for (let i = 0; i < 120; i++) {
        a.camera.position.x += 0.4
        a.camera.position.z += 0.3
        a.cover.update()
        if (!a.cover.stats().settled) lagged++
      }
      // The work really was spread over frames, and it finishes once the camera stops.
      expect(lagged).toBeGreaterThan(10)
      for (let i = 0; i < 2000 && !a.cover.stats().settled; i++) a.cover.update()
      expect(a.cover.stats().settled).toBe(true)
      // Move a whole margin so both covers write their plants from the same camera position.
      a.cover.sliceMs = Infinity
      const end = { x: a.camera.position.x + 30, z: a.camera.position.z }
      a.camera.position.x = end.x
      a.cover.update()
      const b = coverAt(end.x, end.z)
      expect(plants(a.scene)).toEqual(plants(b.scene))
    })

    it('keeps drawing under a camera faster than the replanting budget', () => {
      const a = coverAt(start.x, start.z)
      a.cover.sliceMs = 0
      let shown = 0
      for (let i = 0; i < 60; i++) {
        // 150 m/s, back and forth over the meadow.
        a.camera.position.x += (i % 20 < 10 ? 2.5 : -2.5)
        a.cover.update()
        if (a.cover.stats().drawn[0] > 0) shown++
      }
      expect(shown).toBe(60)
    })

    it('presses the grass under vehicles near the ground and ignores those flying over', () => {
      const a = coverAt(start.x, start.z)
      const y = sampler.heightAt(start.x + 3, start.z)
      const car = new THREE.Object3D(), jet = new THREE.Object3D()
      car.position.set(start.x + 3, y + 0.7, start.z)
      jet.position.set(start.x - 4, y + 40, start.z)
      a.cover.setVehicles(() => [jet, car])
      for (let i = 0; i < 40; i++) {
        car.position.x += 0.5
        car.position.y = sampler.heightAt(car.position.x, car.position.z) + 0.7
        a.cover.update(1 / 60)
      }
      const pressed = a.cover.pressed()
      // The car, and two fainter points behind it on its trail; nothing for the jet.
      expect(pressed.length).toBe(3)
      expect(pressed[0].x).toBeCloseTo(car.position.x, 5)
      expect(pressed[0].w).toBe(1)
      expect(pressed[1].x).toBeLessThan(car.position.x)
      expect(pressed[2].x).toBeLessThan(pressed[1].x)
      expect(pressed[2].w).toBeLessThan(pressed[1].w)
      // A level that cannot afford it presses nothing.
      a.cover.setBudget(COVER_LEVELS[1])
      a.cover.update(1 / 60)
      expect(a.cover.pressed().length).toBe(0)
    })

    it('builds night life only where the level and the room allow it', () => {
      const c = coverAt(start.x, start.z, 2)
      const all = c.cover.stats().drawn.length
      expect(all).toBe(FLORA[1].layers(100).length)
      c.cover.setBudget({ ...COVER_LEVELS[4], nightlife: 0 })
      expect(c.cover.stats().drawn.length).toBe(FLORA[1].layers(100).filter((l) => !l.motes).length)
    })

    it('grows a thinner, nearer cover on phones and nothing at the safe level', () => {
      const total = (level: number) => {
        const c = coverAt(start.x, start.z, level)
        const stats = c.cover.stats()
        return { grass: stats.drawn[0], all: stats.drawn.reduce((x, y) => x + y, 0), layers: stats.drawn.length }
      }
      const desktop = total(2), phone = total(1), safe = total(0)
      expect(COVER_LEVELS[0].density).toBe(0)
      expect(safe.layers).toBe(0)
      expect(phone.all).toBeGreaterThan(0)
      // Half the grass over about a third of the area: between a tenth and a third of the desktop's.
      expect(phone.grass).toBeGreaterThan(desktop.grass * 0.08)
      expect(phone.grass).toBeLessThan(desktop.grass * 0.33)
      // Most of a desktop meadow is drawn with the cheap far shape.
      const full = coverAt(start.x, start.z, 2).cover.stats()
      expect(full.near[0]).toBeGreaterThan(0)
      expect(full.near[0]).toBeLessThan(full.drawn[0] * 0.3)
      process.stdout.write(`plants drawn in a meadow: desktop ${desktop.all} (grass ${desktop.grass}), phone ${phone.all} (grass ${phone.grass})\n`)
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { appearance, overlaps, placeNameplates, touchesDisc, createScreenProxy, type Disc, type Candidate, type Rect } from '../../src/ui/nameplates/layout'
import { wrappedOccluded } from '../../src/ui/nameplates/occlusion'
import { nameplateMode, PREFERENCE_KEY, restoreNameplatePreference, validMode } from '../../src/ui/nameplates/preferences'
import { params } from '../../shared/params'
import type { NameplateOptions } from '../../src/ui/nameplates/VehicleNameplates'

const candidate = (id: string, bot = false, x = 300, y = 300): Candidate => ({ id, bot, x, y, depth: 100, width: 130, height: 38, opacity: 1, tick: false })
describe('vehicle label priority and protection', () => {
  it('allocates people before nearer bots and keeps every plate and leader separate', () => {
    const bot = { ...candidate('bot', true), depth: 10 }, person = candidate('person')
    const result = placeNameplates([bot, person], [], [], 600, 600)
    expect(result[0].id).toBe('person')
    for (const a of result) for (const b of result) if (a !== b) expect(overlaps(a, b)).toBe(false)
  })
  it('never allows a bot to displace a person when only one spot fits', () => {
    const person = { ...candidate('person', false, 80, 100), width: 130 }, bot = { ...person, id: 'bot', bot: true }
    const result = placeNameplates([bot, person], [], [], 160, 160)
    expect(result.map(p => p.id)).toEqual(['person'])
  })
  it('rejects behind-camera and nonfinite anchors', () => {
    expect(placeNameplates([{ ...candidate('behind'), depth: -1 }, { ...candidate('bad'), x: NaN }], [], [], 600, 600)).toEqual([])
  })
  it('keeps labels and leaders out of the HUD and nearer vehicles', () => {
    const hud: Rect = { left: 0, top: 0, right: 600, bottom: 600 }
    expect(placeNameplates([candidate('a')], [], [hud], 600, 600)).toEqual([])
    const disc = { id: 'front', x: 300, y: 280, radius: 200, depth: 10 }
    expect(placeNameplates([candidate('a')], [disc], [], 600, 600)).toEqual([])
    expect(placeNameplates([candidate('a')], [{ ...disc, depth: 200 }], [], 600, 600)).toHaveLength(1)
  })
  it('hides a label when its box would cover foreground terrain', () => {
    expect(placeNameplates([candidate('a')], [], [], 600, 600, () => false)).toEqual([])
  })
  it('retains a valid prior spot rather than changing sides each frame', () => {
    const result = placeNameplates([{ ...candidate('a'), previous: 2 }], [], [], 600, 600)
    expect(result[0].spot).toBe(2)
  })
})
describe('distinct prior-spot terrain checks', () => {
  // Fixed fixture plate corners identify callback slots independently of attempt ordering.
  const corners = [[235, 250], [235, 230], [158, 250], [312, 250]]
  const slotOf = (box: Rect) => corners.findIndex(([left, top]) => box.left === left && box.top === top)

  it.each([
    [0, [0, 1, 2, 3]], [1, [1, 0, 2, 3]],
    [2, [2, 0, 1, 3]], [3, [3, 0, 1, 2]],
  ] as const)('checks previous slot %i once, then the remaining slots in order', (previous, expected) => {
    const calls: number[] = []
    const placed = placeNameplates([{ ...candidate('a'), previous }], [], [], 600, 600, box => {
      calls.push(slotOf(box)); return false
    })
    expect(placed).toEqual([])
    expect(calls).toEqual(expected)
    expect(calls).toHaveLength(4)
    expect(new Set(calls).size).toBe(4)
  })

  it.each([undefined, -1, 4, 99, .5, 2.5, NaN, Infinity, -Infinity])('falls back safely for previous=%s', previous => {
    const calls: number[] = []
    expect(placeNameplates([{ ...candidate('a'), previous }], [], [], 600, 600, box => {
      calls.push(slotOf(box)); return false
    })).toEqual([])
    expect(calls).toEqual([0, 1, 2, 3])
  })

  it('stops at the first successful fallback and retains that placement next frame', () => {
    const calls: number[] = []
    const first = placeNameplates([{ ...candidate('a'), previous: 2 }], [], [], 600, 600, box => {
      const slot = slotOf(box); calls.push(slot); return slot === 1
    })
    expect(calls).toEqual([2, 0, 1])
    expect(first).toHaveLength(1)
    expect(first[0].spot).toBe(1)
    calls.length = 0
    const next = placeNameplates([{ ...candidate('a'), previous: first[0].spot }], [], [], 600, 600, box => {
      calls.push(slotOf(box)); return true
    })
    expect(calls).toEqual([1])
    expect(next).toEqual(first)
  })

  it('keeps all human attempts ahead of nearer bot attempts', () => {
    const calls: string[] = []
    placeNameplates([{ ...candidate('bot', true), depth: 10, previous: 3 }, { ...candidate('person'), previous: 2 }], [], [], 600, 600, (box, _depth, c) => {
      calls.push(`${c.id}:${slotOf(box)}`); return false
    })
    expect(calls).toEqual(['person:2', 'person:0', 'person:1', 'person:3', 'bot:3', 'bot:0', 'bot:1', 'bot:2'])
  })
})
describe('terrain budget fails hidden', () => {
  // Exercise the actual instance query guard without a browser or a product test seam.
  async function withBudget(run: (query: () => boolean, calls: () => number) => void) {
    const { Scene, PerspectiveCamera } = await import('three/webgpu')
    const { VehicleNameplates } = await import('../../src/ui/nameplates/VehicleNameplates')
    const root = { className: '', hidden: false, setAttribute() {}, remove() {} }
    vi.stubGlobal('document', { createElement: () => root })
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
    let calls = 0
    let labels: InstanceType<typeof VehicleNameplates> | undefined
    try {
      labels = new VehicleNameplates(() => new PerspectiveCamera(), {
        shell: { appendChild() {}, ownerDocument: { body: {} } }, scene: new Scene(),
        visible: () => true, presentation: () => false, wrapSize: () => 0,
        terrainHit: () => { calls++; return false },
      } as unknown as NameplateOptions)
      const internal = labels as unknown as { terrainBudget: number; hitTerrain(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean }
      internal.terrainBudget = 512 // draw() supplies this unchanged frame allowance.
      run(() => internal.hitTerrain({ x: 0, y: 10, z: 0 }, { x: 1, y: 10, z: 0 }), () => calls)
      expect(labels.stats.terrainQueries).toBe(calls)
    } finally { labels?.dispose(); vi.unstubAllGlobals() }
  }
  it('allows exactly 512 physics queries and treats all later queries as blocked', async () => {
    await withBudget((query, calls) => {
      for (let i = 0; i < 512; i++) expect(query()).toBe(false)
      for (let i = 0; i < 8; i++) expect(query()).toBe(true)
      expect(calls()).toBe(512)
    })
  })
  it('hides every placement whose clearance cannot finish before exhaustion', async () => {
    await withBudget((query, calls) => {
      for (let i = 0; i < 511; i++) query()
      const placed = placeNameplates([candidate('unresolved')], [], [], 600, 600, () => !query() && !query())
      expect(placed).toEqual([])
      expect(calls()).toBe(512)
    })
  })
  it('spends the remaining budget on a human before a nearer bot', async () => {
    await withBudget((query, calls) => {
      for (let i = 0; i < 510; i++) query()
      const attempts: string[] = []
      const placed = placeNameplates([
        { ...candidate('bot', true, 450), depth: 10 }, candidate('person', false, 150),
      ], [], [], 600, 600, (_box, _depth, c) => {
        attempts.push(c.id); return !query() && !query()
      })
      expect(placed.map(p => p.id)).toEqual(['person'])
      expect(attempts[0]).toBe('person')
      expect(attempts.slice(1)).toContain('bot')
      expect(calls()).toBe(512)
    })
  })
})
describe('size and distance', () => {
  it('keeps bots at two thirds human scale and fainter at all shared distances', () => {
    for (const d of [0, 20, 50, 100, 150]) {
      const person = appearance(d, false, false), bot = appearance(d, true, false)
      expect(bot.scale / person.scale).toBeCloseTo(.66)
      expect(bot.opacity).toBeLessThan(person.opacity)
    }
  })
  it('shrinks distant bots to ticks and removes them well before people', () => {
    expect(appearance(120, true, false).tick).toBe(true)
    expect(appearance(180, true, false).visible).toBe(false)
    expect(appearance(600, false, false).visible).toBe(true)
    expect(appearance(650, false, false).visible).toBe(false)
  })
  it('clamps near/far text scale and enlarges presentation by one quarter', () => {
    expect(appearance(1, false, false).scale).toBe(appearance(500, false, false).scale)
    expect(appearance(30, false, true).scale).toBe(1.25)
  })
})
describe('wrapped terrain rays', () => {
  it('splits a seam ray into short canonical segments, never a backwards world-wide ray', () => {
    const lengths: number[] = []
    const blocked = wrappedOccluded({ x: 48, y: 10, z: 0 }, { x: 54, y: 10, z: 0 }, 100, (a, b) => {
      lengths.push(Math.abs(b.x - a.x)); expect(a.x).toBeGreaterThanOrEqual(-50); expect(b.x).toBeLessThanOrEqual(50); return a.x < 0
    })
    expect(blocked).toBe(true); expect(lengths).toEqual([2, 4])
  })
  it('tests unwrapped terrain once and handles negative diagonal seams', () => {
    let calls = 0
    expect(wrappedOccluded({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }, 0, () => { calls++; return false })).toBe(false)
    expect(calls).toBe(1)
    expect(wrappedOccluded({ x: -48, y: 1, z: -48 }, { x: -54, y: 2, z: -54 }, 100, (a, b) => Math.abs(b.x - a.x) > 10)).toBe(false)
  })
})
describe('label preference persistence', () => {
  it('accepts only finite integer modes', () => {
    for (const v of [NaN, Infinity, -1, 3, .5, '1', null]) expect(validMode(v)).toBe(false)
    for (const v of [0, 1, 2]) expect(validMode(v)).toBe(true)
  })
  it('restores before listening, persists only this setting, and unsubscribes', () => {
    const writes: string[] = []
    const stop = restoreNameplatePreference({ getItem: key => key === PREFERENCE_KEY ? '1' : null, setItem: (key, value) => writes.push(`${key}=${value}`) })
    expect(nameplateMode.value).toBe(1); expect(writes).toEqual([])
    params.set(nameplateMode.def.id, 2); expect(writes).toEqual([`${PREFERENCE_KEY}=2`])
    stop(); params.set(nameplateMode.def.id, 0); expect(writes).toHaveLength(1)
  })
  it('survives storage failure without preventing play', () => {
    const stop = restoreNameplatePreference({ getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } })
    expect(() => params.set(nameplateMode.def.id, 1)).not.toThrow(); stop(); params.set(nameplateMode.def.id, 0)
  })
})

describe('final-camera render ordering', () => {
  it('reads fresh, swapped and late-added remote poses only after the camera has updated', async () => {
    const { afterCameraFrame } = await import('../../src/ui/nameplates/renderHook')
    const camera = { x: 0 }, otherCamera = { x: 99 }, vehicle = { x: 0 }, remote = { x: 0 }
    const samples: number[][] = []
    let priorCalls = 0
    const scene = { onBeforeRender: (_renderer: unknown, _scene: unknown, _camera: typeof camera) => { priorCalls++ } }
    const original = scene.onBeforeRender
    const hook = afterCameraFrame(scene, () => camera, args => args[2], () => samples.push([camera.x, vehicle.x, remote.x]))
    for (const frame of [1, 2, 3]) {
      hook.queue() // Networking runs before the dynamically appended remote interpolation.
      vehicle.x = frame * 10 // Fresh vehicle, then replacement, then another frame.
      camera.x = vehicle.x + 5
      remote.x = frame * 20 // Remote update can come after networking and camera.
      scene.onBeforeRender(null, scene, otherCamera)
      expect(samples).toHaveLength(frame - 1)
      scene.onBeforeRender(null, scene, camera)
      scene.onBeforeRender(null, scene, camera) // A repeated render pass does not update again.
      expect(samples.at(-1)).toEqual([frame * 10 + 5, frame * 10, frame * 20])
      expect(samples).toHaveLength(frame)
    }
    expect(priorCalls).toBe(9)
    hook.dispose(); expect(scene.onBeforeRender).toBe(original)
  })
})

describe('rendered wrap image', () => {
  it('keeps labels attached when the camera and player straddle the half-world boundary', async () => {
    const { Object3D, PerspectiveCamera, Vector3 } = await import('three/webgpu')
    const { renderedPosition } = await import('../../src/ui/nameplates/anchors')
    const vehicle = new Object3D(); vehicle.position.set(-49, 5, 0)
    const camera = new PerspectiveCamera(60, 1, .1, 1000)
    camera.position.set(49, 5, 0); camera.lookAt(vehicle.position); camera.updateMatrixWorld()
    const rendered = renderedPosition(vehicle, new Vector3())
    expect(rendered.x).toBe(-49)
    const screen = rendered.clone().project(camera)
    expect(screen.x).toBeCloseTo(0); expect(screen.y).toBeCloseTo(0)
    // A nearest-camera rewrap would put this same world at x=51, behind the camera.
    expect(rendered.clone().applyMatrix4(camera.matrixWorldInverse).z).toBeCloseTo(-98)
  })
})

describe('render hook replacement and disposal', () => {
  it('follows a replaced camera and never removes a later owner’s callback', async () => {
    const { afterCameraFrame } = await import('../../src/ui/nameplates/renderHook')
    let camera = { id: 'first' }, count = 0, originalCalls = 0, laterCalls = 0
    const original = (_camera: typeof camera) => { originalCalls++ }
    const scene = { onBeforeRender: original }
    const hook = afterCameraFrame(scene, () => camera, args => args[0], () => count++)
    const old = camera; camera = { id: 'replacement' }; hook.queue()
    scene.onBeforeRender(old); expect(count).toBe(0)
    scene.onBeforeRender(camera); expect(count).toBe(1)
    const ours = scene.onBeforeRender
    const later = (c: typeof camera) => { ours(c); laterCalls++ }
    scene.onBeforeRender = later
    hook.queue(); hook.dispose()
    expect(scene.onBeforeRender).toBe(later)
    scene.onBeforeRender(camera)
    expect(count).toBe(1); expect(laterCalls).toBe(1); expect(originalCalls).toBe(3)
  })
})

describe('ball and materialize anchors', () => {
  it('uses the displayed ball offset and radius, including while materializing', async () => {
    const { Object3D, Quaternion, Vector3 } = await import('three/webgpu')
    const { renderedEnvelope } = await import('../../src/ui/nameplates/anchors')
    const object = new Object3D(); object.position.set(10, 50, 20); object.rotation.z = Math.PI / 2
    object.userData.materializing = true
    const fixture = { object, kind: 'buggy-syn3h', zorb: { active: true, radius: 8, offset: new Vector3(0, 2, 0) } } as unknown as Parameters<typeof renderedEnvelope>[0]
    const center = new Vector3()
    expect(renderedEnvelope(fixture, center, new Quaternion(), new Vector3())).toBe(8)
    expect(center.x).toBeCloseTo(8); expect(center.y).toBeCloseTo(50); expect(center.z).toBe(20)
    expect(center.y + 8 + .65).toBeGreaterThan(object.position.y + 8)
  })
})

describe('curved render projection and visibility', () => {
  it('matches the render bend for center, raised anchor and disc at curve 0, .71 and 1.8', async () => {
    const { Vector3, PerspectiveCamera } = await import('three/webgpu')
    const { curveRadius, curveOffsetAt } = await import('../../src/world/curve')
    const { bendPoint, CurvedProjection, unbendPoint } = await import('../../src/ui/nameplates/curvature')
    const projection = new CurvedProjection(), camera = new PerspectiveCamera(60, 1.6, .1, 3000)
    camera.position.set(23, 65, -19); camera.lookAt(23, 20, 300); camera.updateMatrixWorld()
    for (const curve of [0, .71, 1.8]) {
      const R = curveRadius(2048, curve), bend = new Vector3(23, -19, Number.isFinite(R) ? 1 / R : 0)
      for (const point of [new Vector3(28, 4, 6), new Vector3(90, 22, 410), new Vector3(90, 29, 410)]) {
        const offset = new Vector3(); curveOffsetAt(bend, point.x, point.y, point.z, offset)
        const expected = point.clone().add(offset), bent = bendPoint(point, bend, new Vector3())
        expect(bent.distanceTo(expected)).toBeLessThan(1e-9)
        const inverse = new Vector3(); expect(unbendPoint(bent, bend, inverse)).toBe(true)
        expect(inverse.distanceTo(point)).toBeLessThan(1e-8)
        const expectedScreen = expected.clone().project(camera), screen = new Vector3()
        projection.project(point, bend, camera, 1280, 800, screen)
        expect(screen.x).toBeCloseTo((expectedScreen.x + 1) * 640, 8)
        expect(screen.y).toBeCloseTo((1 - expectedScreen.y) * 400, 8)
        const disc = { id: 'remote', x: 0, y: 0, radius: 0, depth: 0 }
        projection.envelope(point, 6, bend, camera, 1280, 800, disc)
        expect(disc.x).toBeCloseTo(screen.x); expect(disc.y).toBeCloseTo(screen.y)
        expect(disc.radius).toBeGreaterThan(0)
        if (curve && point.z > 400) expect(bent.y).toBeLessThan(point.y - 50)
      }
    }
  })
  it('keeps curved projection invariant when the already-rendered tile and bend anchor shift together', async () => {
    const { Vector3, PerspectiveCamera } = await import('three/webgpu')
    const { curveRadius } = await import('../../src/world/curve')
    const { CurvedProjection } = await import('../../src/ui/nameplates/curvature')
    const projection = new CurvedProjection()
    for (const curve of [0, .71, 1.8]) {
      const R = curveRadius(2048, curve), bend = new Vector3(1020, 0, Number.isFinite(R) ? 1 / R : 0)
      const camera = new PerspectiveCamera(60, 1, .1, 3000)
      camera.position.set(1020, 45, 0); camera.lookAt(1030, 3, 90); camera.updateMatrixWorld()
      const point = new Vector3(1030, 4, 90), before = new Vector3(), after = new Vector3()
      projection.project(point, bend, camera, 800, 800, before)
      point.x -= 2048; bend.x -= 2048; camera.position.x -= 2048; camera.updateMatrixWorld()
      projection.project(point, bend, camera, 800, 800, after)
      expect(after.distanceTo(before)).toBeLessThan(1e-8)
    }
  })
  it('traces visual sight through inverse curvature, detecting the horizon that a flat chord misses', async () => {
    const { Vector3 } = await import('three/webgpu')
    const { curveRadius } = await import('../../src/world/curve')
    const { bendPoint, curvedTerrainOccluded } = await import('../../src/ui/nameplates/curvature')
    const hitsGround = (a: { y: number }, b: { y: number }) => Math.min(a.y, b.y) <= 0
    const eye = new Vector3(0, 3, 0), far = new Vector3(0, 3, 600)
    expect(hitsGround(eye, far)).toBe(false) // The old flat sight line missed this horizon.
    for (const curve of [.71, 1.8]) {
      const bend = new Vector3(0, 0, 1 / curveRadius(2048, curve))
      const visualFar = bendPoint(far, bend, new Vector3())
      expect(curvedTerrainOccluded(eye, visualFar, bend, 2048, hitsGround)).toBe(true)
      const nearby = bendPoint(new Vector3(0, 3, 20), bend, new Vector3())
      expect(curvedTerrainOccluded(eye, nearby, bend, 2048, hitsGround)).toBe(false)
    }
    expect(curvedTerrainOccluded(eye, far, new Vector3(), 2048, hitsGround)).toBe(false)
  })
  it('preserves flat physics endpoints, wrap segments and a bounded query count', async () => {
    const { Vector3 } = await import('three/webgpu')
    const { curveRadius } = await import('../../src/world/curve')
    const { bendPoint, curvedTerrainOccluded } = await import('../../src/ui/nameplates/curvature')
    const eye = new Vector3(1018, 50, 0), target = new Vector3(1050, 20, 20)
    const bend = new Vector3(eye.x, eye.z, 1 / curveRadius(2048, .71))
    const endpoints: { x: number; y: number; z: number }[] = []
    expect(curvedTerrainOccluded(eye, bendPoint(target, bend, new Vector3()), bend, 2048, (a, b) => {
      expect(Math.abs(a.x)).toBeLessThanOrEqual(1024 + 1e-6)
      expect(Math.abs(b.x)).toBeLessThanOrEqual(1024 + 1e-6)
      endpoints.push({ ...b }); return false
    })).toBe(false)
    expect(endpoints.length).toBeLessThanOrEqual(130)
    expect(endpoints.at(-1)!.x).toBeCloseTo(-998)
    expect(endpoints.at(-1)!.y).toBeCloseTo(20)
    expect(endpoints.at(-1)!.z).toBeCloseTo(20)
  })
})


describe('clipped triangulated vehicle proxy', () => {
  const box = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })
  const disc = (): Disc => ({ id: 'hull', x: 0, y: 0, radius: 0, depth: 0 })

  it('keeps the visible portion of an offscreen-center hull without covering the opposite side', async () => {
    const { PerspectiveCamera, Vector3 } = await import('three/webgpu')
    const { CurvedProjection } = await import('../../src/ui/nameplates/curvature')
    const camera = new PerspectiveCamera(90, 1, 1, 100); camera.updateMatrixWorld()
    const out = disc(); new CurvedProjection().envelope(new Vector3(6, 0, -5), 2, new Vector3(), camera, 100, 100, out)
    expect(out.x).toBeCloseTo(110) // center outside, left face still visible
    expect(out.proxy?.blocked).toBe(false)
    expect(touchesDisc(box(86, 45, 94, 55), out)).toBe(true)
    expect(touchesDisc(box(50, 45, 60, 55), out)).toBe(false) // old circumcircle covered this clear region
  })

  it('clips near-plane crossings, keeps all-behind hulls empty, and blocks an enclosed camera', async () => {
    const { PerspectiveCamera, Vector3 } = await import('three/webgpu')
    const { CurvedProjection } = await import('../../src/ui/nameplates/curvature')
    const camera = new PerspectiveCamera(90, 1, 1, 100); camera.updateMatrixWorld()
    const projection = new CurvedProjection(), out = disc(), bend = new Vector3()
    projection.envelope(new Vector3(2, 0, -1), 1, bend, camera, 100, 100, out)
    expect(out.proxy?.blocked).toBe(false)
    expect(touchesDisc(box(85, 48, 90, 52), out)).toBe(true)
    expect(touchesDisc(box(10, 48, 20, 52), out)).toBe(false)
    projection.envelope(new Vector3(0, 0, 3), 1, bend, camera, 100, 100, out)
    expect(out.proxy?.count).toBe(0); expect(out.proxy?.blocked).toBe(false)
    expect(touchesDisc(box(0, 0, 100, 100), out)).toBe(false)
    projection.envelope(new Vector3(), 2, bend, camera, 100, 100, out)
    expect(out.proxy?.blocked).toBe(true)
    expect(touchesDisc(box(8, 8, 12, 12), out)).toBe(true)
    projection.envelope(new Vector3(NaN, 0, -5), 1, bend, camera, 100, 100, out)
    expect(out.proxy?.blocked).toBe(true)
  })

  it('uses the actual jittered projection without modifying the camera or substituting a stable projection', async () => {
    const { PerspectiveCamera, Vector3 } = await import('three/webgpu')
    const { CurvedProjection } = await import('../../src/ui/nameplates/curvature')
    const camera = new PerspectiveCamera(90, 1, 1, 100)
    camera.setViewOffset(100, 100, 10, 0, 100, 100); camera.updateMatrixWorld()
    const before = camera.projectionMatrix.elements.slice(), out = disc()
    new CurvedProjection().envelope(new Vector3(0, 0, -10), 1, new Vector3(), camera, 100, 100, out)
    expect(out.x).toBeCloseTo(40)
    expect(touchesDisc(box(35, 48, 40, 52), out)).toBe(true)
    expect(touchesDisc(box(56, 48, 60, 52), out)).toBe(false)
    expect(camera.projectionMatrix.elements).toEqual(before)
  })

  it.each([0, .71, 1.8])('covers a known front face at curve %s and retains rendered-tile translation', async curve => {
    const { PerspectiveCamera, Vector3 } = await import('three/webgpu')
    const { CurvedProjection } = await import('../../src/ui/nameplates/curvature')
    const { curveRadius } = await import('../../src/world/curve')
    const R = curveRadius(2048, curve), k = Number.isFinite(R) ? 1 / R : 0
    const camera = new PerspectiveCamera(90, 1, 1, 100); camera.updateMatrixWorld()
    const projection = new CurvedProjection(), out = disc()
    projection.envelope(new Vector3(0, 0, -20), 2, new Vector3(0, 0, k), camera, 200, 200, out)
    // Analytic front-face center: cube boundary vertex (0,0,-18), spherical curve about origin.
    const depth = k ? R * Math.sin(18 / R) : 18, y = k ? R * Math.cos(18 / R) - R : 0
    const sy = 100 - y / depth * 100
    expect(out.proxy?.blocked).toBe(false)
    expect(touchesDisc(box(99, sy - 1, 101, sy + 1), out)).toBe(true)
    expect(touchesDisc(box(8, 8, 12, 12), out)).toBe(false)
    camera.position.x = 2048; camera.updateMatrixWorld()
    projection.envelope(new Vector3(2048, 0, -20), 2, new Vector3(2048, 0, k), camera, 200, 200, out)
    expect(touchesDisc(box(99, sy - 1, 101, sy + 1), out)).toBe(true)
    expect(touchesDisc(box(8, 8, 12, 12), out)).toBe(false)
  })

  it('honors WebGPU and reversed-depth frustum ranges as well as WebGL', async () => {
    const { PerspectiveCamera, Vector3, WebGPUCoordinateSystem, WebGLCoordinateSystem } = await import('three/webgpu')
    const { CurvedProjection } = await import('../../src/ui/nameplates/curvature')
    for (const coordinateSystem of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) for (const reversedDepth of [false, true]) {
      const camera = new PerspectiveCamera(90, 1, 1, 100)
      camera.coordinateSystem = coordinateSystem
      Object.defineProperty(camera, 'reversedDepth', { value: reversedDepth }) // Camera exposes a getter; renderer normally owns its backing state.
      camera.updateProjectionMatrix(); camera.updateMatrixWorld()
      const out = disc(), projection = new CurvedProjection()
      projection.envelope(new Vector3(0, 0, -10), 1, new Vector3(), camera, 100, 100, out)
      expect(touchesDisc(box(48, 48, 52, 52), out)).toBe(true)
      projection.envelope(new Vector3(0, 0, -200), 1, new Vector3(), camera, 100, 100, out)
      expect(out.proxy?.count).toBe(0)
    }
  })

  it('tests leader bounds and preserves2px+3px margin, self exclusion, depth and people priority', () => {
    const proxy = createScreenProxy(); proxy.count = 1; proxy.sizes[0] = 4
    proxy.points.set([78, 95, 82, 95, 82, 101, 78, 101])
    const hull: Disc = { id: 'front', x: 0, y: 0, radius: 0, depth: 10, proxy }
    expect(touchesDisc(box(70, 80, 75, 90), hull)).toBe(false) // corner distance sqrt(34)>5
    expect(touchesDisc(box(70, 80, 76, 91), hull)).toBe(true) // corner distance sqrt(20)<5
    const human = { ...candidate('human', false, 80, 100), width: 130 }, bot = { ...human, id: 'bot', bot: true }
    // Every plate is above95; its leader ends at100 and must still be excluded.
    expect(placeNameplates([human], [hull], [], 160, 160)).toEqual([])
    expect(placeNameplates([human], [{ ...hull, id: 'human' }], [], 160, 160)).toHaveLength(1)
    expect(placeNameplates([human], [{ ...hull, depth: 200 }], [], 160, 160)).toHaveLength(1)
    expect(placeNameplates([bot, human], [{ ...hull, depth: 200 }], [], 160, 160).map(p => p.id)).toEqual(['human'])
  })
})
describe('HUD exclusions', () => {
  // Bug it catches: on a phone the gear selector's reserved box (drum plus an empty detail
  // pane) spans the screen's middle, so excluding the box itself rejected every label slot.
  it('avoids the gear drum and showing detail lines, not the empty reserved box', async () => {
    const { HudExclusions } = await import('../../src/ui/nameplates/HudExclusions')
    const el = (selector: string, left: number, right: number, hidden = false) => {
      const e = { selector, hidden, parentElement: null, hasAttribute: (a: string) => a === 'hidden' && e.hidden,
        getBoundingClientRect: () => ({ left, right, top: 300, bottom: 480 }) }
      return e
    }
    const all = [el('.gear-selector', 12, 380), el('.gear-selector .gs-drum', 12, 184),
      el('.gear-selector .gs-detail > *', 176, 346), el('.gear-selector .gs-detail > *', 176, 346, true)]
    const query = (selectors: string) => all.filter(e => selectors.split(',').includes(e.selector))
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
    try {
      const doc = { body: {}, querySelectorAll: () => [] }
      const hud = new HudExclusions({ ownerDocument: doc, querySelectorAll: query } as unknown as HTMLElement)
      expect(hud.read(390, 844).map(b => [b.left, b.right])).toEqual([[6, 190], [170, 352]])
      all[2].hidden = true // the detail pane empties: only the drum remains
      expect(hud.read(390, 844).map(b => [b.left, b.right])).toEqual([[6, 190]])
      hud.dispose()
    } finally { vi.unstubAllGlobals() }
  })
})

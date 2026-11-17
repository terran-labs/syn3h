import { describe, expect, it, vi } from 'vitest'
import { compactAt, distanceOpacity, DISTANCE, EDGE, FAR_BOTS, GAP, hold, plateLeft, HOLD_MS, HOLD_SLACK, MIN_TEXT_PX, namePx, NUDGE, overlaps, placeLabels, plateRect, snapPx, spring, type Candidate, type Rect } from '../../src/ui/nameplates/layout'
import { wrappedOccluded } from '../../src/ui/nameplates/occlusion'
import { nameplateMode, PREFERENCE_KEY, restoreNameplatePreference, validMode } from '../../src/ui/nameplates/preferences'
import { params } from '../../shared/params'
import type { NameplateOptions } from '../../src/ui/nameplates/VehicleNameplates'

const candidate = (id: string, bot = false, x = 300, y = 300, distance = 50): Candidate =>
  ({ id, bot, x, y, distance, width: 130, height: 38, compact: false, held: false, nudged: false })
const rectOf = (c: Candidate, nudged: boolean) => plateRect(c, nudged)
describe('vehicle label placement', () => {
  it('places people before nearer bots and never lets two plates overlap', () => {
    const cs = [candidate('bot', true, 300, 300, 10), candidate('person', false, 310, 305), candidate('bot2', true, 290, 296, 20)]
    const placed = placeLabels(cs, [], 600, 600)
    expect(placed[0].id).toBe('person')
    const rects = placed.map(p => rectOf(cs.find(c => c.id === p.id)!, p.nudged))
    for (const a of rects) for (const b of rects) if (a !== b) expect(overlaps(a, b)).toBe(false)
  })
  it('never lets a bot displace a person', () => {
    const person = candidate('person', false, 300, 300, 400), bot = candidate('bot', true, 300, 300, 5)
    expect(placeLabels([bot, person], [], 600, 600).map(p => p.id)).toEqual(['person'])
  })
  // Bug it catches: labels jumping to a side or far away on a leader line.
  it('keeps every label directly above its anchor, at most one small step up', () => {
    const cs = Array.from({ length: 12 }, (_, i) => candidate(`v${i}`, i % 2 === 1, 200 + (i % 4) * 20, 300 + (i % 3) * 8, 10 + i))
    for (const p of placeLabels(cs, [], 600, 600)) {
      const c = cs.find(c => c.id === p.id)!, r = rectOf(c, p.nudged)
      expect((r.left + r.right) / 2).toBe(c.x)
      expect(c.y - r.bottom).toBeLessThanOrEqual(GAP + NUDGE)
      expect(c.y - r.bottom).toBeGreaterThanOrEqual(GAP)
    }
  })
  it('rejects nonfinite anchors', () => {
    expect(placeLabels([{ ...candidate('bad'), x: NaN }], [], 600, 600)).toEqual([])
  })
  it('never covers a hard HUD control, and covers a soft readout only when a step up will not clear it', () => {
    const everywhere: Rect = { left: 0, top: 0, right: 600, bottom: 600 }
    expect(placeLabels([candidate('a')], [everywhere], 600, 600)).toEqual([])
    expect(placeLabels([candidate('a')], [{ ...everywhere, soft: true }], 600, 600)[0]?.overSoft).toBe(true)
    const low = rectOf(candidate('a'), false)
    const justBelow = { left: 0, right: 600, top: low.bottom - 4, bottom: 600, soft: true }
    const [p] = placeLabels([candidate('a')], [justBelow], 600, 600)
    expect(p).toMatchObject({ nudged: true, overSoft: false })
  })
  // Bug it catches: a label blinking on and off as a neighbour jitters by a pixel.
  it('keeps a held place until another plate is clearly inside it', () => {
    const front = candidate('front', false, 300, 300, 10)
    const r = rectOf(front, false)
    // The back plate's lower edge 2 px inside the front plate: inside the slack.
    const back = candidate('back', false, 300, r.top + 2 + GAP, 20)
    expect(HOLD_SLACK).toBeGreaterThan(2)
    expect(placeLabels([front, { ...back, held: true }], [], 600, 600).find(p => p.id === 'back')?.nudged).toBe(false)
    expect(placeLabels([front, back], [], 600, 600).find(p => p.id === 'back')?.nudged).toBe(true)
  })
  it(`shows at most ${FAR_BOTS} far bot labels, the nearest`, () => {
    const cs = Array.from({ length: FAR_BOTS + 4 }, (_, i) => ({ ...candidate(`b${i}`, true, 40 + i * 150 % 900, 100 + i * 37, 100 + i), compact: true }))
    const placed = placeLabels(cs, [], 1000, 1000)
    expect(placed.length).toBeLessThanOrEqual(FAR_BOTS)
    expect(placed.every(p => Number(p.id.slice(1)) < FAR_BOTS)).toBe(true)
  })
})
describe('screen edges', () => {
  // Bugs it catches: a name half off the screen, and a plate jumping as its car reaches an edge.
  it('keeps a plate on screen while its anchor is, over its anchor always, and never jumps', () => {
    const width = 160, screen = 390
    let last = plateLeft(-200, width, screen)
    for (let x = -200; x <= screen + 200; x += .5) {
      const left = plateLeft(x, width, screen)
      expect(Math.abs(left - last)).toBeLessThanOrEqual(.5 + 1e-9)
      expect(x).toBeGreaterThanOrEqual(left); expect(x).toBeLessThanOrEqual(left + width)
      if (x >= EDGE * 4 && x <= screen - EDGE * 4) { expect(left).toBeGreaterThanOrEqual(EDGE - 1e-9); expect(left + width).toBeLessThanOrEqual(screen - EDGE + 1e-9) }
      last = left
    }
  })
})
describe('stability', () => {
  it('takes a first decision at once and never reverses one inside HOLD_MS', () => {
    const state = { value: false, since: -Infinity }
    expect(hold(state, true, 1000)).toBe(true)
    for (let t = 1000; t < 1000 + HOLD_MS; t += 16) expect(hold(state, t % 32 === 0, t)).toBe(true)
    expect(hold(state, false, 1000 + HOLD_MS)).toBe(false)
  })
  it('eases a step without overshoot at any frame rate, and settles', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 20, .1]) {
      const s = { x: 0, v: 0 }
      for (let i = 0; i < 400; i++) { const x = spring(s, NUDGE, dt); expect(x).toBeLessThanOrEqual(NUDGE + 1e-9); expect(x).toBeGreaterThanOrEqual(0) }
      expect(s.x).toBe(NUDGE)
    }
  })
})
describe('size and distance', () => {
  // Invariants only; the distances and sizes themselves are tuned by eye (layout.ts DISTANCE).
  it('never draws text below the minimum, and snaps to whole pixels', () => {
    for (const bot of [false, true]) for (let d = 0; d <= 3000; d += 7) {
      const px = snapPx(namePx(d, bot), NaN)
      expect(px).toBeGreaterThanOrEqual(MIN_TEXT_PX); expect(Number.isInteger(px)).toBe(true)
    }
  })
  it('shrinks with distance and never draws a bot larger, longer or farther than a person', () => {
    let last = Infinity
    for (let d = 0; d <= 3000; d += 5) {
      expect(namePx(d, false)).toBeLessThanOrEqual(last); last = namePx(d, false)
      expect(namePx(d, true)).toBeLessThanOrEqual(namePx(d, false))
      expect(distanceOpacity(d, true)).toBeLessThanOrEqual(distanceOpacity(d, false))
    }
    expect(DISTANCE.bot.range).toBeLessThan(DISTANCE.person.range)
    expect(distanceOpacity(-1, false)).toBe(0)
  })
  // Bug it catches: a vehicle hovering at a threshold flipping between sizes every frame.
  it('does not toggle size or form at a threshold', () => {
    for (const bot of [false, true]) {
      const at = bot ? DISTANCE.bot.compactAt : DISTANCE.person.compactAt
      let compact = false, px = NaN
      const seen = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const d = at + (i % 2 ? .4 : -.4)
        compact = compactAt(d, bot, compact); px = snapPx(namePx(d, bot), px); seen.add(`${compact}${px}`)
      }
      expect(seen.size).toBeLessThanOrEqual(2) // one change at most, then steady
    }
  })
})
describe('terrain budget fails hidden', () => {
  // Exercise the actual instance query guard without a browser or a product test seam.
  it('allows exactly 512 physics queries per allocation and treats all later queries as blocked', async () => {
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
      internal.terrainBudget = 512 // draw() sets this at each allocation.
      const query = () => internal.hitTerrain({ x: 0, y: 10, z: 0 }, { x: 1, y: 10, z: 0 })
      for (let i = 0; i < 512; i++) expect(query()).toBe(false)
      for (let i = 0; i < 8; i++) expect(query()).toBe(true)
      expect(calls).toBe(512)
      expect(labels.stats.terrainQueries).toBe(calls)
    } finally { labels?.dispose(); vi.unstubAllGlobals() }
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
    const body = renderedEnvelope(fixture, center, new Quaternion(), new Vector3(), { radius: 0, rise: 0, reach: 0, top: 0 })
    expect(center.x).toBeCloseTo(8); expect(center.y).toBeCloseTo(50); expect(center.z).toBe(20)
    expect(body.radius).toBeGreaterThanOrEqual(8); expect(body.top).toBeCloseTo(58) // the ball's top
  })
  // Bug it catches: labels floating metres above the car they name.
  it('puts the top of a body at its roof, wherever the vehicle points', async () => {
    const { Object3D, Quaternion, Vector3 } = await import('three/webgpu')
    const { renderedEnvelope } = await import('../../src/ui/nameplates/anchors')
    for (const kind of ['buggy', 'hovercraft', 'tank', 'jet'] as const) {
      const object = new Object3D(); object.position.set(5, 20, -3); object.rotation.y = 1.1; object.updateMatrixWorld()
      const fixture = { object, kind, zorb: { active: false } } as unknown as Parameters<typeof renderedEnvelope>[0]
      const body = renderedEnvelope(fixture, new Vector3(), new Quaternion(), new Vector3(), { radius: 0, rise: 0, reach: 0, top: 0 })
      expect(body.top - 20).toBeGreaterThan(.5); expect(body.top - 20).toBeLessThan(3) // roof, not a sphere's crown
      expect(body.rise).toBeLessThan(Math.max(body.radius, body.reach))
    }
  })
})

describe('curved render projection and visibility', () => {
  it('matches the render bend for center and raised anchor at curve 0, .71 and 1.8', async () => {
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


describe('HUD exclusions', () => {
  // Bug it catches: on a phone the gear selector's reserved box (drum plus an empty detail
  // pane) spans the screen's middle, so excluding the box itself rejected every label slot.
  it('avoids the gear drum and showing detail lines, not the empty reserved box', async () => {
    const { HudExclusions } = await import('../../src/ui/nameplates/HudExclusions')
    const el = (selector: string, left: number, right: number, hidden = false) => {
      const e = { selector, hidden, parentElement: null, matches: (s: string) => s.split(',').includes(selector), hasAttribute: (a: string) => a === 'hidden' && e.hidden,
        getBoundingClientRect: () => ({ left, right, top: 300, bottom: 480 }) }
      return e
    }
    const all = [el('.gear-selector', 12, 380), el('.gear-selector .gs-drum', 12, 184),
      el('.gear-selector .gs-detail > *', 176, 346), el('.gear-selector .gs-detail > *', 176, 346, true)]
    const query = (selectors: string) => all.filter(e => selectors.split(',').includes(e.selector))
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }))
    try {
      const doc = { body: {}, defaultView: undefined, querySelectorAll: () => [] }
      const hud = new HudExclusions({ ownerDocument: doc, querySelectorAll: query } as unknown as HTMLElement)
      expect(hud.read(390, 844).map(b => [b.left, b.right])).toEqual([[6, 190], [170, 352]])
      all[2].hidden = true // the detail pane empties: only the drum remains
      expect(hud.measure(390, 844).map(b => [b.left, b.right])).toEqual([[6, 190]])
      hud.dispose()
    } finally { vi.unstubAllGlobals() }
  })
})

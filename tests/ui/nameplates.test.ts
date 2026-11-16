import { describe, expect, it } from 'vitest'
import { appearance, overlaps, placeNameplates, type Candidate, type Rect } from '../../src/ui/nameplates/layout'
import { wrappedOccluded } from '../../src/ui/nameplates/occlusion'
import { nameplateMode, PREFERENCE_KEY, restoreNameplatePreference, validMode } from '../../src/ui/nameplates/preferences'
import { params } from '../../shared/params'

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

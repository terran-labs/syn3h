import { beforeEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three/webgpu'
import { params } from '../../shared/params'
import { ChaseCamera, cameraWheelNotches, camZoomSpeed, zoomLimits } from '../../src/core/ChaseCamera'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'

beforeEach(() => {
  for (const p of params.all().filter(p => p.def.group === 'Camera')) params.set(p.def.id, p.def.default)
})
function harness() {
  const game = { camera: new PerspectiveCamera(60), input: { suspended: false } } as unknown as Game
  const terrain = { heightAt: () => 0 } as unknown as Terrain
  const chase = new ChaseCamera(game, terrain)
  // Scope state is observed only to exercise the existing parameter-selection branch.
  const state = chase as unknown as { scopeHeld: boolean }
  return { chase, state }
}
describe('proportional camera zoom', () => {
  it('registers the reviewed client setting and normalizes pixel, line and page deltas', () => {
    expect(camZoomSpeed.def).toMatchObject({ scope: 'client', default: 0.4, min: 0.05, max: 2, step: 0.05 })
    expect(cameraWheelNotches(25, 0)).toBe(0.25)
    expect(cameraWheelNotches(-0.5, 1)).toBe(-0.5)
    expect(cameraWheelNotches(0.5, 2)).toBe(0.5)
    expect(cameraWheelNotches(3, 2)).toBe(1)
    expect(cameraWheelNotches(Infinity, 0)).toBe(0)
  })
  it('moves one notch by the chosen step and preserves fractional trackpad motion', () => {
    const { chase } = harness()
    params.set('camera.distance', 10)
    chase.zoom(100)
    expect(params.get('camera.distance')!.value).toBeCloseTo(10.4)
    chase.zoom(-25)
    expect(params.get('camera.distance')!.value).toBeCloseTo(10.3)
    chase.zoom(1, 1)
    expect(params.get('camera.distance')!.value).toBeCloseTo(10.7)
    params.set('camera.zoomSpeed', 0.05)
    chase.zoom(100)
    expect(params.get('camera.distance')!.value).toBeCloseTo(10.75)
    chase.dispose()
  })
  it('caps each event at one notch and retains the distance bounds', () => {
    const { chase } = harness()
    params.set('camera.distance', 10)
    chase.zoom(5000)
    expect(params.get('camera.distance')!.value).toBeCloseTo(10.4)
    chase.zoom(-20, 1)
    expect(params.get('camera.distance')!.value).toBeCloseTo(10)
    params.set('camera.distance', 25); chase.zoom(100)
    expect(params.get('camera.distance')!.value).toBe(25)
    params.set('camera.distance', 0); chase.zoom(-100)
    expect(params.get('camera.distance')!.value).toBe(0)
    chase.zoom(NaN)
    expect(params.get('camera.distance')!.value).toBe(0)
    chase.dispose()
  })
  // Bug it catches: a pinch or the wheel taking the chase camera inside the car or out of sight.
  it('stops at each vehicle\'s near and far limits, and remembers the distance for the session', () => {
    const { chase } = harness()
    const set = (kind: string) => (chase as unknown as { vehicle: { kind: string } | null }).vehicle = { kind }
    set('buggy')
    // Enough notches to pass any far limit camera.zoomFar allows.
    for (let i = 0; i < 80; i++) chase.zoom(100)
    expect(params.get('camera.distance')!.value).toBeCloseTo(zoomLimits('buggy')[1])
    set('jet')
    for (let i = 0; i < 40; i++) chase.zoom(100)
    expect(params.get('camera.distance')!.value).toBeCloseTo(zoomLimits('jet')[1])
    for (let i = 0; i < 80; i++) chase.zoom(-100)
    expect(params.get('camera.distance')!.value).toBeCloseTo(zoomLimits('jet')[0])
    if (typeof sessionStorage !== 'undefined') expect(Number(sessionStorage.getItem('syn3h.cameraDistance'))).toBeCloseTo(zoomLimits('jet')[0])
    chase.dispose()
  })
  it('keeps scope and roam units while scaling their fractional deltas', () => {
    const { chase, state } = harness()
    state.scopeHeld = true
    params.set('camera.scope', 3)
    chase.zoom(100)
    expect(params.get('camera.scope')!.value).toBeCloseTo(2.75)
    chase.zoom(-50)
    expect(params.get('camera.scope')!.value).toBeCloseTo(2.875)
    state.scopeHeld = false
    params.set('camera.mode', 4); params.set('camera.roamSpeed', 2)
    chase.zoom(25)
    expect(params.get('camera.roamSpeed')!.value).toBeCloseTo(2.25)
    chase.dispose()
  })
})

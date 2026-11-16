import { beforeEach, describe, expect, it } from 'vitest'
import { Object3D, PerspectiveCamera } from 'three/webgpu'
import { params } from '../../shared/params'
import { ChaseCamera } from '../../src/core/ChaseCamera'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'

beforeEach(() => {
  for (const p of params.all().filter(p => p.def.group === 'Camera')) params.set(p.def.id, p.def.default)
})
function harness() {
  const input = { suspended: false }, target = new Object3D()
  target.position.set(0, 10, 0)
  const game = { camera: new PerspectiveCamera(60), input } as unknown as Game
  const chase = new ChaseCamera(game, { heightAt: () => 0 } as Terrain)
  chase.target = target
  chase.update(0.02)
  // Observe input state separately from the rendered camera's smoothing spring.
  const state = chase as unknown as { yaw: number; pitch: number; lastManual: number; elapsed: number; scopeHeld: boolean }
  return { chase, target, input, state }
}
describe('shared camera look', () => {
  it('uses the existing CSS-pixel sensitivity, scope scale and pitch clamp', () => {
    const { chase, state } = harness()
    params.set('camera.sensitivity', 4)
    const scale = 4 * Math.PI / 180 * 0.1
    chase.look(100, -50)
    expect(state.yaw).toBeCloseTo(-100 * scale)
    expect(state.pitch).toBeCloseTo(50 * scale)
    expect(state.lastManual).toBe(state.elapsed)
    state.scopeHeld = true
    chase.look(100, 0)
    expect(state.yaw).toBeCloseTo(-100 * scale * (1 + 0.75 / 4))
    chase.look(0, -1e6)
    expect(state.pitch).toBeCloseTo(Math.PI * 0.49)
    chase.look(0, 1e6)
    expect(state.pitch).toBeCloseTo(-Math.PI * 0.49)
    chase.dispose()
  })
  it('ignores suspended and non-finite deltas without postponing recentering', () => {
    const { chase, state, input } = harness()
    const before = [state.yaw, state.pitch, state.lastManual]
    input.suspended = true
    chase.look(100, 100)
    input.suspended = false
    for (const [x, y] of [[NaN, 1], [1, Infinity], [-Infinity, 1]]) chase.look(x, y)
    expect([state.yaw, state.pitch, state.lastManual]).toEqual(before)
    chase.dispose()
  })
  it.each([0, 1, 2, 4])('preserves the existing delayed recenter policy in mode %s', mode => {
    const { chase, target, state } = harness()
    params.set('camera.mode', mode)
    params.set('camera.autoDelay', 3)
    chase.look(100, 0)
    const yaw = state.yaw
    for (let i = 0; i < 100; i++) { target.position.z -= 0.1; chase.update(0.02) }
    expect(state.yaw).toBeCloseTo(yaw)
    for (let i = 0; i < 200; i++) { target.position.z -= 0.1; chase.update(0.02) }
    if (mode === 0 || mode === 1) expect(Math.abs(state.yaw)).toBeLessThan(Math.abs(yaw) * 0.1)
    else expect(state.yaw).toBeCloseTo(yaw)
    chase.dispose()
  })
})

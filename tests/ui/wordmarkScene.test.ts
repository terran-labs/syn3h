import { describe, expect, it } from 'vitest'
import { logoDamping, logoLag, logoSpring, placeWordmark, poseView, WordmarkRig } from '../../src/ui/brand/wordmarkScene'

describe('wordmark in space', () => {
  // Bugs caught: the name pinned at a hard edge and snapping across when a turn reverses (the
  // owner, 25 November 2026: "a hard edge that it immediately slams left and right in"); a spring
  // that never quite settles and keeps a phone drawing; the rest pose moved. Limits come from the
  // registry, so retuning moves the expectation with it.
  it('trails the camera on a spring within its soft limits, never jumps on a reversal, and comes to rest exactly', () => {
    const rig = new WordmarkRig(), at = { yaw: 0.6, pitch: 0.4, reach: 16, target: [0, 0, 0] as [number, number, number] }
    expect(rig.step(at, 1 / 30, false)).toBe(false)
    const lag = logoLag.value, dt = 1 / 60
    let goal = { ...at }, before = 0, biggest = 0
    // A fast pan one way, then straight back the other.
    for (let i = 0; i < 120; i++) {
      goal = { ...goal, yaw: goal.yaw + (i < 60 ? 0.08 : -0.08), pitch: goal.pitch + (i < 60 ? 0.02 : -0.02) }
      rig.step(goal, dt, false)
      const shown = goal.yaw - rig.pose!.yaw
      expect(Math.abs(shown)).toBeLessThan(lag)
      expect(Math.abs(goal.pitch - rig.pose!.pitch)).toBeLessThan(lag)
      if (i > 0) biggest = Math.max(biggest, Math.abs(shown - before))
      before = shown
    }
    // On the reversal the trail swings round on the spring: no frame moves it by more than the pan
    // does plus what the spring itself can move in a frame.
    expect(biggest).toBeLessThanOrEqual(0.08 + 2 * logoSpring.value * lag * dt)
    // Let go: at rest exactly on the goal within a bound set by the spring's own decay.
    const bound = 12 / (logoDamping.value * logoSpring.value)
    let moving = true, t = 0
    for (; moving && t < bound; t += dt) moving = rig.step(goal, dt, false)
    expect(moving).toBe(false)
    expect(rig.pose).toEqual(goal)
    expect(rig.step(goal, dt, false)).toBe(false)
  })
  it('jumps straight to the goal under reduced motion', () => {
    const rig = new WordmarkRig(), at = { yaw: 0.6, pitch: 0.4, reach: 16, target: [0, 0, 0] as [number, number, number] }
    rig.step(at, 1 / 30, false)
    const swung = { ...at, yaw: 2.2, pitch: 0.9 }
    expect(rig.step(swung, 1 / 30, true)).toBe(false)
    expect(rig.pose).toEqual(swung)
  })
  it('stays at the plane seen from below, never under it', () => {
    for (const pitch of [-0.6, -0.2, -0.05, 0, 0.05, 0.4]) {
      const view = poseView({ yaw: 0.6, pitch, reach: 16, target: [0, 0, 0] }, 0.62)
      for (const mode of [4, 5, 6]) {
        const shown = placeWordmark(mode, view, { x: 0, y: 0.5, unit: 0.3 }, 10), gone = placeWordmark(mode, view, { x: 0, y: 0.5, unit: 0.3 }, 10, true)
        // The drawn placement is never lower than where it would have gone, and never below where it stands at the plane.
        expect(shown.centre[1]).toBeGreaterThanOrEqual(gone.centre[1] - 1e-9)
        expect(shown.centre[1]).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })
  it('projects at rest onto the box it was given', () => {
    const view = poseView({ yaw: 0.6, pitch: 0.4, reach: 16, target: [0, 0, 0] }, 0.62), box = { x: 0.1, y: 0.7, unit: 0.3 }
    for (const mode of [1, 2, 3]) {
      const p = placeWordmark(mode, view, box)
      const d = p.centre.map((v, i) => v - view.eye[i]), z = d.reduce((s, v, i) => s + v * view.forward[i], 0)
      expect(d.reduce((s, v, i) => s + v * view.right[i], 0) / (z * view.tan)).toBeCloseTo(box.x, 6)
      expect(d.reduce((s, v, i) => s + v * view.up[i], 0) / (z * view.tan)).toBeCloseTo(box.y, 6)
    }
  })
})

describe('wordmark developer overrides', () => {
  it('sets the placement and opening from ?wordmark= and ?intro=, clamped, and nothing without them', async () => {
    const { applyWordmarkQuery } = await import('../../src/ui/brand/wordmarkFlags')
    const { wordmarkPlacement } = await import('../../src/ui/brand/wordmarkScene')
    const { introMode } = await import('../../src/ui/galaxy/opening')
    expect(applyWordmarkQuery('?room=a')).toBe(false); expect(wordmarkPlacement.value).toBe(7); expect(introMode.value).toBe(2)
    expect(applyWordmarkQuery('?wordmark=99')).toBe(true); expect(wordmarkPlacement.value).toBe(7)
    applyWordmarkQuery('?wordmark=-2&intro=0'); expect(wordmarkPlacement.value).toBe(0); expect(introMode.value).toBe(0)
    // The placements that were removed fall back to the lobby's own.
    applyWordmarkQuery('?wordmark=5'); expect(wordmarkPlacement.value).toBe(7)
  })
})

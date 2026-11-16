import { describe, expect, it } from 'vitest'
import { placeWordmark, poseView, WordmarkRig } from '../../src/ui/brand/wordmarkScene'

describe('wordmark in space', () => {
  it('trails the camera within its limits and comes to rest, so the lobby can stop drawing', () => {
    const rig = new WordmarkRig(), at = { yaw: 0.6, pitch: 0.4, reach: 16, target: [0, 0, 0] as [number, number, number] }
    expect(rig.step(at, 1 / 30, false)).toBe(false)
    const swung = { ...at, yaw: 2.2, pitch: 0.9 }
    let moving = true, frames = 0
    for (; moving && frames < 30 * 20; frames++) {
      moving = rig.step(swung, 1 / 30, false)
      expect(Math.abs(swung.yaw - rig.pose!.yaw)).toBeLessThanOrEqual(0.18 + 1e-9)
      expect(Math.abs(swung.pitch - rig.pose!.pitch)).toBeLessThanOrEqual(0.1 + 1e-9)
    }
    expect(moving).toBe(false)
    expect(rig.pose).toEqual(swung)
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

describe('wordmark preview switch', () => {
  it('sets the placement from ?wordmark=, clamped, and does nothing without the flag', async () => {
    const { applyWordmarkQuery, wordmarkSwitchEnabled } = await import('../../src/ui/brand/wordmarkSwitch')
    const { wordmarkPlacement } = await import('../../src/ui/brand/wordmarkScene')
    expect(applyWordmarkQuery('?room=a')).toBe(false); expect(wordmarkSwitchEnabled()).toBe(false); expect(wordmarkPlacement.value).toBe(0)
    expect(applyWordmarkQuery('?wordmark=9')).toBe(true); expect(wordmarkPlacement.value).toBe(3); expect(wordmarkSwitchEnabled()).toBe(true)
    applyWordmarkQuery('?wordmark=-2'); expect(wordmarkPlacement.value).toBe(0)
  })
})

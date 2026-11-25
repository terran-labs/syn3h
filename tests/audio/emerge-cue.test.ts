/** The sound of coming out of the water (src/audio/index.ts, 'emerge'): once per surfacing, never for a hull riding the swell. */
import { describe, expect, it, vi } from 'vitest'
import { GameAudio } from '../../src/audio'
import { CrashWatcher } from '../../src/audio/Impacts'

function fixture(zorb = false) {
  const position = { x: 0, y: 0, z: 0 }, velocity = { x: 6, y: 0, z: 0 }
  const vehicle = {
    kind: 'buggy', zorbed: zorb, object: { position },
    zorb: { radius: zorb ? 1.5 : 0, collider: zorb ? { translation: () => position } : null },
    body: { isValid: () => true, translation: () => position, linvel: () => velocity },
    wingsOpen: false, landedThisStep: false, landingImpact: 0, wheelsGrounded: 0,
  }
  const audio = Object.assign(Object.create(GameAudio.prototype), {
    context: { state: 'running', currentTime: 1 }, enabled: true, paused: false, local: vehicle,
    terrain: { surfaceAt: () => 'sand', heightAt: () => -50, liquidHeightAt: () => 0, liquidKindAt: () => 'water' },
    crashes: new CrashWatcher(), cueStops: new Set(), events: new Map(), remote: new Map(), impactSeed: 0,
    output: () => ({ node: {}, dispose: vi.fn() }), cue: vi.fn(),
  }) as any
  /** Move the vehicle's centre to each height in turn, at the vertical speed between them. */
  const path = (heights: number[]) => { for (let i = 0; i < heights.length; i++) { velocity.y = i ? (heights[i] - heights[i - 1]) * 60 : 0; position.y = heights[i]; audio.fixedUpdate() } }
  const emerges = () => audio.cue.mock.calls.filter((c: unknown[]) => c[0] === 'emerge').length
  return { path, emerges }
}
const line = (from: number, to: number, steps: number) => Array.from({ length: steps + 1 }, (_, i) => from + (to - from) * i / steps)

describe('emerge cue', () => {
  for (const zorb of [false, true]) {
    it(`sounds once as a ${zorb ? 'Zorb' : 'hull'} comes up from deep`, () => {
      const { path, emerges } = fixture(zorb)
      path([...line(2, -6, 120), ...line(-6, 3, 90), ...line(3, 3, 30)])
      expect(emerges()).toBe(1)
    })
    it(`is silent for a ${zorb ? 'Zorb' : 'hull'} bobbing at the surface`, () => {
      const { path, emerges } = fixture(zorb)
      const r = zorb ? 1.5 : 0
      path(Array.from({ length: 600 }, (_, i) => -r * .5 + .4 * Math.sin(i / 10)))
      expect(emerges()).toBe(0)
    })
  }
})

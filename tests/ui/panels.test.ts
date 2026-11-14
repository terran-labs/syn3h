import { describe, expect, it } from 'vitest'
import { easeInOutQuad, easeOutQuad, PANEL_TRANSITION_MS } from '../../src/ui/SlidingPanels'
import { parseScoreRow } from '../../src/ui/Scoreboard'
describe('recovered panel timing', () => {
  it('uses the serialized two-second duration and quadratic easing', () => {
    expect(PANEL_TRANSITION_MS).toBe(2000)
    expect(easeInOutQuad(0)).toBe(0); expect(easeInOutQuad(0.5)).toBe(0.5); expect(easeInOutQuad(1)).toBe(1)
    expect(easeOutQuad(0.5)).toBe(0.75)
  })
})
describe('network text score rows', () => {
  it('extracts names with spaces, scores, self and tag flags', () => {
    expect(parseScoreRow('> Red Explorer    12  [IT] (you) (host)')).toEqual({ name: 'Red Explorer', score: 12, self: true, it: true, flags: '[IT] (you) (host)' })
    expect(parseScoreRow('  Alice            0  ')).toMatchObject({ name: 'Alice', score: 0, it: false, self: false })
  })
  it('does not treat connection details or events as scores', () => {
    expect(parseScoreRow('net: room demo   ping 12 ms   delay 0 ms')).toBeNull()
    expect(parseScoreRow('Alice tagged You')).toBeNull()
  })
})

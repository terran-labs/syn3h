import { describe, expect, it } from 'vitest'
import { pickLobbyTarget, pickWorld } from '../../src/ui/galaxy/Galaxy'

const world = (id: string, x: number, y: number, radius: number, depth: number) => ({ id, x, y, radius, visible: true, depth })

describe('galaxy tap', () => {
  it('takes the world in front when the tap is on two discs, even deeper inside the one behind', () => {
    // Far world B partly behind near world A. The tap is on A's visible disc but nearer B's centre.
    const a = world('a', 200, 300, 40, 8), b = world('b', 250, 300, 40, 20)
    expect(pickWorld([b, a], 232, 300)).toBe('a')
    expect(pickWorld([a, b], 232, 300)).toBe('a')
  })
  it('takes the disc under the tap over a nearer world just missed', () => {
    expect(pickWorld([world('near', 100, 100, 20, 5), world('far', 150, 100, 20, 30)], 135, 100)).toBe('far')
  })
  it('keeps the generous margin for a near miss outside every disc', () => {
    expect(pickWorld([world('a', 100, 100, 10, 9), world('b', 160, 100, 10, 4)], 125, 100)).toBe('a')
    expect(pickWorld([world('a', 100, 100, 10, 9)], 140, 100)).toBeUndefined()
  })
  it('ignores worlds that are not visible', () => {
    expect(pickWorld([{ ...world('a', 100, 100, 30, 1), visible: false }], 100, 100)).toBeUndefined()
  })
})

describe('caption tap', () => {
  const front = world('front', 100, 100, 15, 5), back = world('back', 130, 90, 15, 20)
  const sun = { x: 110, y: 100, radius: 10, depth: 12 }

  it('keeps the caption when a tap only hits another world’s padding', () => {
    expect(pickLobbyTarget([front, back], sun, 100, 118, 22, 'back')).toBe('back')
  })

  it('routes caption padding to a foreground globe and stops at the sun', () => {
    expect(pickLobbyTarget([front, back], sun, 110, 100, 22, 'back')).toBe('front')
    expect(pickLobbyTarget([front, back], sun, 117, 100, 22, 'back')).toBeUndefined()
    expect(pickLobbyTarget([front, back], sun, 117, 100, 22)).toBeUndefined()
  })
})

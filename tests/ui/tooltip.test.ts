import { describe, expect, it } from 'vitest'
import { placeTip, tipOutline, TAIL_DEPTH } from '../../src/ui/tooltip'

// Bug it catches: a tooltip's tail detached from the button it names, when the plate is pushed
// along to stay on screen, or drawn on the wrong side.
const view = { width: 1440, height: 900 }
const box = (left: number, top: number, size = 44) => ({ left, top, right: left + size, bottom: top + size })

describe('the tooltip tail', () => {
  it('points at the centre of a button at the screen edge, though the plate is nudged', () => {
    const b = box(1380, 40), at = placeTip(b, 120, 30, view)
    expect(at.side).toBe('top')
    expect(at.x + 120).toBeLessThanOrEqual(view.width)
    expect(at.x + at.at).toBeCloseTo((b.left + b.right) / 2)
    expect(at.y - TAIL_DEPTH).toBeGreaterThan(b.bottom)
  })
  it('goes above a button at the bottom, and beside one with no room above or below', () => {
    expect(placeTip(box(600, 850), 120, 30, view).side).toBe('bottom')
    const tall = { left: 40, top: 0, right: 84, bottom: 900 }
    const at = placeTip(tall, 120, 30, view)
    expect(at.side).toBe('left')
    expect(at.x).toBeGreaterThan(tall.right)
  })
  it('draws the tail on the side it was placed, as part of the one outline', () => {
    const d = tipOutline(120, 30, 'top', 60)
    expect(d).toContain(`L60 ${.5 - TAIL_DEPTH}`)
    expect(d.match(/M/g)).toHaveLength(1)
    expect(d.endsWith('Z')).toBe(true)
  })
})

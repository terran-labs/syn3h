import { describe, expect, it } from 'vitest'
import { placeLabels, type LabelPlace } from '../../src/ui/galaxy/labels'

const size = { width: 80, height: 20 }
const sizes = (ids: string[]) => new Map(ids.map(id => [id, size]))
const bounds = { width: 400, height: 800, bottom: 680 }
const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < size.width && Math.abs(a.y - b.y) < size.height

describe('galaxy labels', () => {
  it('puts a lone label under its world', () => {
    const [spot] = placeLabels([{ id: 'a', x: 200, y: 300, radius: 20, visible: true }], sizes(['a']), bounds)
    expect(spot).toMatchObject({ id: 'a', x: 200, y: 326, spot: 0, crowded: false })
  })
  it('moves a label that would cover another to a free side', () => {
    const places: LabelPlace[] = [{ id: 'a', x: 200, y: 300, radius: 10, visible: true }, { id: 'b', x: 210, y: 306, radius: 8, visible: true }]
    const spots = placeLabels(places, sizes(['a', 'b']), bounds)
    expect(spots.every(s => !s.crowded)).toBe(true)
    expect(overlap(spots[0], spots[1])).toBe(false)
  })
  it('places the world in play first, and keeps it however crowded', () => {
    const places: LabelPlace[] = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, x: 200 + (i % 2), y: 300, radius: 5 + i, visible: true }))
    const spots = placeLabels(places, sizes(places.map(p => p.id)), bounds, { first: 'w0' })
    expect(spots[0]).toMatchObject({ id: 'w0', crowded: false })
    const shown = spots.filter(s => !s.crowded)
    for (const a of shown) for (const b of shown) if (a !== b) expect(overlap(a, b)).toBe(false)
    expect(spots.some(s => s.crowded)).toBe(true)
  })
  it('stays on the screen and above the links', () => {
    const [spot] = placeLabels([{ id: 'a', x: 395, y: 700, radius: 10, visible: true }], sizes(['a']), bounds)
    expect(spot.x + size.width / 2).toBeLessThanOrEqual(bounds.width)
    expect(spot.y + size.height).toBeLessThanOrEqual(bounds.bottom)
  })
  it('keeps last frame\'s spot while it still fits', () => {
    const places: LabelPlace[] = [{ id: 'a', x: 200, y: 300, radius: 10, visible: true }]
    const [spot] = placeLabels(places, sizes(['a']), bounds, { previous: new Map([['a', 2]]) })
    expect(spot.spot).toBe(2)
  })
  it('skips worlds that are not visible', () => {
    expect(placeLabels([{ id: 'a', x: 0, y: 0, radius: 1, visible: false }], sizes(['a']), bounds)).toEqual([])
  })
})

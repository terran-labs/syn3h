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
  // Depth: a label never covers a world nearer the eye than its own.
  const box = (s: { x: number; y: number }) => ({ left: s.x - size.width / 2 - 4, top: s.y - 4, right: s.x + size.width / 2 + 4, bottom: s.y + size.height + 4 })
  const over = (s: { x: number; y: number }, disc: LabelPlace) => {
    const b = box(s), nx = Math.min(b.right, Math.max(b.left, disc.x)), ny = Math.min(b.bottom, Math.max(b.top, disc.y))
    return Math.hypot(nx - disc.x, ny - disc.y) < disc.radius
  }
  it('moves a label off a nearer world sitting on its usual spot', () => {
    const far: LabelPlace = { id: 'far', x: 200, y: 300, radius: 15, visible: true, depth: 20 }
    const near: LabelPlace = { id: 'near', x: 200, y: 345, radius: 22, visible: true, depth: 10 }
    const spots = placeLabels([far, near], sizes(['far', 'near']), bounds)
    const spot = spots.find(s => s.id === 'far')!
    expect(spot.crowded).toBe(false)
    expect(spot.spot).not.toBe(0)
    expect(over(spot, near)).toBe(false)
  })
  it('fades the label of a world mostly hidden behind a nearer one', () => {
    // The spot under it is clear of the nearer world; the world itself is mostly behind it.
    const hidden: LabelPlace = { id: 'hidden', x: 200, y: 300, radius: 12, visible: true, depth: 25 }
    const front: LabelPlace = { id: 'front', x: 203, y: 300, radius: 13, visible: true, depth: 9 }
    const spots = placeLabels([hidden, front], sizes(['hidden', 'front']), bounds)
    expect(spots.find(s => s.id === 'hidden')!.crowded).toBe(true)
    expect(spots.find(s => s.id === 'front')!.crowded).toBe(false)
    // The world in play is no exception.
    expect(placeLabels([hidden, front], sizes(['hidden', 'front']), bounds, { first: 'hidden' }).find(s => s.id === 'hidden')!.crowded).toBe(true)
  })
  it('names the world in play over farther worlds but never over a nearer one', () => {
    // Boxed in by farther worlds on every side: still named, as before.
    const play: LabelPlace = { id: 'play', x: 200, y: 300, radius: 10, visible: true, depth: 5 }
    const ring = Array.from({ length: 8 }, (_, i): LabelPlace => ({ id: `r${i}`, x: 200 + Math.cos(i * Math.PI / 4) * 40, y: 300 + Math.sin(i * Math.PI / 4) * 40, radius: 26, visible: true, depth: 30 }))
    const named = placeLabels([play, ...ring], sizes(['play', ...ring.map(r => r.id)]), bounds, { first: 'play' })
    expect(named.find(s => s.id === 'play')!.crowded).toBe(false)
    // The same ring nearer the eye than the world in play: faded rather than drawn over it.
    const nearRing = ring.map(r => ({ ...r, depth: 2 }))
    const faded = placeLabels([play, ...nearRing], sizes(['play', ...ring.map(r => r.id)]), bounds, { first: 'play' })
    const spot = faded.find(s => s.id === 'play')!
    if (!spot.crowded) for (const disc of nearRing) expect(over(spot, disc)).toBe(false)
    expect(spot.crowded).toBe(true)
  })
  it('lets the world in play fall back to any spot clear of nearer worlds', () => {
    const play: LabelPlace = { id: 'play', x: 200, y: 300, radius: 10, visible: true, depth: 20 }
    const near: LabelPlace = { id: 'near', x: 200, y: 336, radius: 24, visible: true, depth: 8 }
    const farther = [{ id: 'f1', x: 200, y: 262, radius: 22, visible: true, depth: 40 }, { id: 'f2', x: 262, y: 300, radius: 22, visible: true, depth: 40 }, { id: 'f3', x: 138, y: 300, radius: 22, visible: true, depth: 40 }]
    const spots = placeLabels([play, near, ...farther], sizes(['play', 'near', 'f1', 'f2', 'f3']), bounds, { first: 'play' })
    const spot = spots.find(s => s.id === 'play')!
    expect(spot.crowded).toBe(false)
    expect(over(spot, near)).toBe(false)
  })
  it('does not hold last frame\'s spot once a nearer world moves onto it', () => {
    const a: LabelPlace = { id: 'a', x: 200, y: 300, radius: 10, visible: true, depth: 20 }
    const near: LabelPlace = { id: 'near', x: 300, y: 290, radius: 26, visible: true, depth: 6 }
    const [held] = placeLabels([a], sizes(['a']), bounds, { previous: new Map([['a', 2]]) })
    expect(held.spot).toBe(2)
    const spot = placeLabels([a, near], sizes(['a', 'near']), bounds, { previous: new Map([['a', 2]]) }).find(s => s.id === 'a')!
    expect(spot).toMatchObject({ crowded: false }); expect(spot.spot).not.toBe(2); expect(over(spot, near)).toBe(false)
    // The world in play held under itself, boxed in by farther worlds, as a nearer world arrives
    // under it: the label leaves for a spot clear of the nearer world.
    const play: LabelPlace = { id: 'play', x: 200, y: 300, radius: 10, visible: true, depth: 20 }
    const under: LabelPlace = { id: 'under', x: 200, y: 336, radius: 24, visible: true, depth: 8 }
    const farther = [{ id: 'f1', x: 200, y: 262, radius: 22, visible: true, depth: 40 }, { id: 'f2', x: 262, y: 300, radius: 22, visible: true, depth: 40 }, { id: 'f3', x: 138, y: 300, radius: 22, visible: true, depth: 40 }]
    const moved = placeLabels([play, under, ...farther], sizes(['play', 'under', 'f1', 'f2', 'f3']), bounds, { first: 'play', previous: new Map([['play', 0]]) }).find(s => s.id === 'play')!
    expect(moved.crowded).toBe(false); expect(moved.spot).not.toBe(0); expect(over(moved, under)).toBe(false)
  })
  it('gives a crowded label a position clear of nearer worlds, for when it is focused', () => {
    // Mostly behind a nearer world, so faded; focused, it must still not cover the front world.
    const hidden: LabelPlace = { id: 'hidden', x: 200, y: 300, radius: 12, visible: true, depth: 25 }
    const front: LabelPlace = { id: 'front', x: 203, y: 300, radius: 13, visible: true, depth: 9 }
    const [spot] = placeLabels([hidden, front], sizes(['hidden', 'front']), bounds).filter(s => s.id === 'hidden')
    expect(spot).toMatchObject({ crowded: true, spot: -1 }); expect(spot.blocked).toBeUndefined()
    expect(over(spot, front)).toBe(false)
    // Walled in by nearer worlds on every side and further out: blocked, for the caller to hide.
    const wall = Array.from({ length: 40 }, (_, i): LabelPlace => ({ id: `n${i}`, x: (i % 8) * 60 + 10, y: 150 + Math.floor(i / 8) * 75, radius: 48, visible: true, depth: 1 }))
    const boxed = placeLabels([hidden, ...wall], sizes(['hidden', ...wall.map(n => n.id)]), bounds).find(s => s.id === 'hidden')!
    expect(boxed).toMatchObject({ crowded: true, blocked: true })
  })
  it('hides and shows a half-covered world with hysteresis, not at one threshold', () => {
    // Slide the front world across the back one, so cover runs 0.3 to 0.7 and back.
    const back: LabelPlace = { id: 'back', x: 200, y: 300, radius: 20, visible: true, depth: 30 }
    const coverAt = (dx: number) => { const d = dx, r = 20; return d >= 2 * r ? 0 : (2 * r * r * Math.acos(d / (2 * r)) - 0.5 * d * Math.sqrt(4 * r * r - d * d)) / (Math.PI * r * r) }
    let previous = new Map<string, number>(), flips: { cover: number; hidden: boolean }[] = []
    const path = [...Array.from({ length: 81 }, (_, i) => 22 - i * 0.2), ...Array.from({ length: 81 }, (_, i) => 6 + i * 0.2)]
    let was: boolean | undefined
    for (const dx of path) {
      const front: LabelPlace = { id: 'front', x: 200 + dx, y: 300, radius: 20, visible: true, depth: 10 }
      const spot = placeLabels([back, front], sizes(['back', 'front']), bounds, { previous }).find(s => s.id === 'back')!
      previous = new Map([['back', spot.spot]])
      if (spot.crowded !== was) { flips.push({ cover: coverAt(dx), hidden: spot.crowded }); was = spot.crowded }
    }
    // Shown, hidden once past 0.55, shown again only below 0.45: three states, two flips.
    expect(flips.map(f => f.hidden)).toEqual([false, true, false])
    expect(flips[1].cover).toBeGreaterThan(0.55); expect(flips[1].cover).toBeLessThan(0.57)
    expect(flips[2].cover).toBeLessThan(0.45); expect(flips[2].cover).toBeGreaterThan(0.43)
  })
})

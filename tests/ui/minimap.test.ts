import { describe, expect, it } from 'vitest'
import { ARROW, MAP_LUMA, RIM, UNITS, heightPixels, mapPoint, markColor, markLook, placeMark, rimFade, type MarkPlace } from '../../src/ui/Minimap'
import { wrapDelta } from '../../shared/wrap'

describe('minimap projection and terrain cache', () => {
  it('maps world center and corners without swapping north and east', () => {
    expect(mapPoint(0, 0, 600, 160)).toEqual([80, 80])
    expect(mapPoint(-300, -300, 600, 160)).toEqual([0, 0])
    expect(mapPoint(300, 300, 600, 160)).toEqual([160, 160])
  })
  it('samples exactly once per pixel and shades height differences', () => {
    let calls = 0
    const pixels = heightPixels({ size: 600, heightAt(x) { calls++; return x } }, 8)
    expect(calls).toBe(64); expect(pixels.length).toBe(256)
    expect(pixels[28]).toBeGreaterThan(pixels[0]); expect(pixels[3]).toBe(255)
  })
})

const size = 600, perMetre = UNITS / size, rim = RIM * size / 2, far = size * Math.SQRT1_2
const place = (): MarkPlace => ({ x: 0, y: 0, distance: 0, bearing: 0, blend: 0 })
const hue = (hex: string): number => {
  const v = parseInt(hex.slice(1), 16), r = (v >> 16 & 255) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  return (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
}

describe('people and bots on the minimap', () => {
  it('draws a person larger and brighter than a bot at the same distance, on the map and off it', () => {
    expect(ARROW.person).toBeGreaterThan(ARROW.bot)
    for (let d = rim; d <= far; d += 4) {
      const f = rimFade(d, rim, far), person = markLook('person', f), bot = markLook('bot', f)
      expect(person.radius).toBeGreaterThan(bot.radius)
      expect(person.alpha).toBeGreaterThan(bot.alpha)
    }
  })
  it('draws an arrow inside the rim and a dot outside it, at the bearing toward the vehicle', () => {
    const inside = placeMark(rim * .5, 0, perMetre, 10, place())
    expect(inside.blend).toBe(0); expect(inside.x).toBeCloseTo(rim * .5 * perMetre)
    for (const deg of [0, 37, 90, 200, 315]) {
      const a = deg * Math.PI / 180, d = rim * 1.4
      const p = placeMark(Math.cos(a) * d, Math.sin(a) * d, perMetre, 10, place())
      expect(p.blend).toBe(1)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(RIM * UNITS / 2 + 10)
      expect(Math.atan2(p.y, p.x)).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)))
    }
  })
  it('hands over smoothly across the rim', () => {
    let last = -1, lastR = 0
    for (let d = rim * .8; d < rim * 1.2; d += .5) {
      const p = placeMark(d, 0, perMetre, 10, place()), r = Math.hypot(p.x, p.y)
      expect(p.blend).toBeGreaterThanOrEqual(last)
      if (last >= 0) expect(Math.abs(r - lastR)).toBeLessThan(1)
      last = p.blend; lastR = r
    }
  })
  it('fades dots with wrapped distance to almost nothing at the far side', () => {
    let prev = { person: Infinity, bot: Infinity }
    for (let d = rim; d <= far; d += 5) {
      const f = rimFade(d, rim, far), person = markLook('person', f).alpha, bot = markLook('bot', f).alpha
      expect(person).toBeLessThanOrEqual(prev.person); expect(bot).toBeLessThanOrEqual(prev.bot)
      prev = { person, bot }
    }
    expect(markLook('bot', rimFade(far, rim, far)).alpha).toBeLessThan(.01)
    const person = markLook('person', rimFade(far, rim, far)).alpha
    expect(person).toBeGreaterThan(0); expect(person).toBeLessThan(.15)
  })
  it('keeps a bot dot clearly visible through the nearest third of the fade', () => {
    expect(markLook('bot', rimFade(rim + (far - rim) / 3, rim, far)).alpha).toBeGreaterThan(.35)
  })
  it('takes the bearing the shortest way round the planet', () => {
    // Just across the west seam from someone at the east edge: east of them, not a world away.
    const dx = wrapDelta(size / 2 - 10, -size / 2 + 20, size), dz = wrapDelta(0, 0, size)
    expect(dx).toBe(30)
    const p = placeMark(dx, dz, perMetre, 10, place())
    expect(p.distance).toBe(30); expect(p.bearing).toBeCloseTo(0)
  })
  it("keeps the hue of the vehicle's own tint, lifting only dark tints", () => {
    for (const tint of ['#ff2a2a', '#22aa44', '#1030a0', '#6a1b9a', '#ffd400', '#0d0d40']) {
      expect(Math.abs(hue(markColor(tint)) - hue(tint))).toBeLessThan(2)
    }
    expect(markColor('#ffd400')).toBe('#ffd400')
    expect(markColor('#0d0d40')).not.toBe('#0d0d40')
  })
})

describe("the map shows the world's own colours", () => {
  const flat = (colour: number, liquid: 'lava' | 'water' | null = null) => heightPixels({ size: 600, heightAt: () => 0, mapColourAt: () => colour, liquidKindAt: () => liquid }, 4)
  const rgb = (p: Uint8ClampedArray) => [p[0], p[1], p[2]]
  const luma = ([r, g, b]: number[]) => (.2126 * r + .7152 * g + .0722 * b) / 255
  const hueOf = ([r, g, b]: number[]) => hue('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''))
  it("keeps the hook's hue on ground and liquids", () => {
    for (const [colour, liquid] of [[0x3366cc, null], [0x2f8a3a, null], [0x1d5f8a, 'water'], [0xff7a1a, 'lava']] as const) {
      const c = rgb(flat(colour, liquid)), want = '#' + colour.toString(16).padStart(6, '0')
      expect(Math.abs(hueOf(c) - hue(want))).toBeLessThan(4)
    }
  })
  it('fits pale ice, bright lava and black rock into the luma band marks stand out from', () => {
    for (const colour of [0xffffff, 0xe8f4ff, 0xff7a1a, 0xffd23a, 0x050505]) {
      const l = luma(rgb(flat(colour)))
      expect(l).toBeLessThanOrEqual(MAP_LUMA[1] + .01); expect(l).toBeGreaterThanOrEqual(MAP_LUMA[0] - .01)
    }
  })
  it('draws the brown relief map, with its sea, when the terrain has no colours', () => {
    const ground = rgb(heightPixels({ size: 600, heightAt: () => 0 }, 4))
    expect(ground[0]).toBeGreaterThan(ground[2])
    const sea = rgb(heightPixels({ size: 600, heightAt: () => 0, liquidKindAt: () => 'water' }, 4))
    expect(sea[2]).toBeGreaterThan(sea[0])
  })
})

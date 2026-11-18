import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3, Matrix4 } from 'three'
import { ARROW, FORMS, MAP_LUMA, RIM, UNITS, cameraHeading, followTurn, turnOffset, heightPixels, mapPoint, markColor, markShades, markLook, placeMark, rimFade, type MarkPlace } from '../../src/ui/Minimap'
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
  it("shades a mark's facets in its own paint, darkest to lightest, hue kept", () => {
    for (const tint of ['#e0457b', '#2a7de1', '#46c46b']) {
      const shades = markShades(tint), luma = (hex: string) => { const v = parseInt(hex.slice(1), 16); return .2126 * (v >> 16 & 255) + .7152 * (v >> 8 & 255) + .0722 * (v & 255) }
      for (let i = 1; i < shades.length; i++) expect(luma(shades[i])).toBeGreaterThan(luma(shades[i - 1]))
      for (const shade of shades.slice(0, 5)) expect(Math.abs(hue(shade) - hue(tint))).toBeLessThan(4)
    }
  })
  it('gives people a different, larger form than bots', () => {
    expect(FORMS.dart.facets.length).toBeGreaterThan(FORMS.bot.facets.length)
    expect(FORMS.kite.facets.length).toBeGreaterThan(FORMS.bot.facets.length)
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

describe('heading-up minimap', () => {
  // Game headings: 0 faces north (-z), -π/2 east, π south; east is +x, which is screen right north up.
  const NORTH = 0, EAST = -Math.PI / 2, SOUTH = Math.PI
  const at = (dx: number, dz: number, turn: number) => turnOffset(dx, dz, turn, { x: 0, y: 0 })
  it('puts a target due east on the right facing north, at the top facing east, on the left facing south', () => {
    const north = at(100, 0, NORTH), east = at(100, 0, EAST), south = at(100, 0, SOUTH)
    expect(north.x).toBeCloseTo(100); expect(north.y).toBeCloseTo(0)
    expect(east.x).toBeCloseTo(0); expect(east.y).toBeCloseTo(-100)
    expect(south.x).toBeCloseTo(-100); expect(south.y).toBeCloseTo(0)
  })
  it("puts whatever is to the camera's right on the right of the map, not mirrored", () => {
    for (const heading of [0, .7, -1.9, 2.8]) {
      const ahead = [-Math.sin(heading), -Math.cos(heading)], right = [Math.cos(heading), -Math.sin(heading)]
      const a = at(ahead[0] * 50, ahead[1] * 50, heading), r = at(right[0] * 50, right[1] * 50, heading)
      expect(a.x).toBeCloseTo(0); expect(a.y).toBeCloseTo(-50)
      expect(r.x).toBeCloseTo(50); expect(r.y).toBeCloseTo(0)
    }
  })
  it('sits the N at the top only when the camera faces north', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const n = at(0, -1, deg * Math.PI / 180), top = n.y < -.999
      expect(top).toBe(deg === 0)
    }
  })
  it('maps wrapped positions the same in both orientations, at the same distance', () => {
    const dx = wrapDelta(size / 2 - 10, -size / 2 + 20, size), dz = wrapDelta(-size / 2 + 5, size / 2 - 15, size)
    const up = placeMark(dx, dz, perMetre, 0, place())
    for (const turn of [0, 1.1, -2.4, Math.PI]) {
      const o = at(dx, dz, turn), turned = placeMark(o.x, o.y, perMetre, 0, place())
      expect(turned.distance).toBeCloseTo(up.distance)
      expect(Math.hypot(turned.x, turned.y)).toBeCloseTo(Math.hypot(up.x, up.y))
      const back = at(turned.x, turned.y, -turn)
      expect(back.x).toBeCloseTo(up.x); expect(back.y).toBeCloseTo(up.y)
    }
  })
  const lookFrom = (heading: number, pitch: number) => {
    const forward = new Vector3(-Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch))
    // A camera with no roll: its up is in the vertical plane through forward.
    const up = new Vector3(Math.sin(heading) * Math.sin(pitch), Math.cos(pitch), Math.cos(heading) * Math.sin(pitch))
    const right = new Vector3().crossVectors(forward, up)
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, forward.clone().negate()))
  }
  it("follows the camera's heading at every pitch, straight down and up included, without flipping", () => {
    for (const heading of [0, .5, -1.2, 2.9]) for (const pitch of [-Math.PI / 2, -1.4, -.3, 0, .6, 1.5, Math.PI / 2]) {
      const h = cameraHeading(lookFrom(heading, pitch), 99)
      expect(Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading)))).toBeLessThan(1e-6)
    }
  })
  it('reads three.js lookAt cameras the same way', () => {
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 0, 0), new Vector3(10, -2, 0), new Vector3(0, 1, 0)))
    expect(cameraHeading(q, 0)).toBeCloseTo(EAST)
  })
  it('keeps up with a turning camera and only eases hairline wobble', () => {
    expect(followTurn(0, .3)).toBeCloseTo(.3)
    expect(followTurn(3.1, -3.1)).toBeCloseTo(-3.1)
    const small = followTurn(0, .005)
    expect(small).toBeGreaterThan(0); expect(small).toBeLessThan(.005)
    let t = 0; for (let i = 0; i < 20; i++) t = followTurn(t, .005)
    expect(t).toBeCloseTo(.005, 5)
  })
  it('never produces a non-finite heading', () => {
    expect(Number.isFinite(cameraHeading({ x: NaN, y: 0, z: 0, w: 1 }, .4))).toBe(true)
  })
})

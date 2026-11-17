import { wrapDelta } from '../../shared/wrap'
import type { Terrain } from '../world/Terrain'

/** What a marker stands for. People and bots are vehicles; a zone is a place (the hill). */
export type MapKind = 'person' | 'bot' | 'zone'
export interface MapEntity {
  x: number; z: number; heading: number
  /** The vehicle's own tint, '#rrggbb'. Colour on the map means identity, never kind. */
  color: string
  /** The vehicle's secondary paint, drawn as an inner accent on people's marks. */
  accent?: string
  /** Absent means a person: the safe default is the more prominent mark. */
  kind?: MapKind
  /** Whoever is "it" in Tag. */
  it?: boolean
  self?: boolean
}
export function mapPoint(x: number, z: number, size: number, pixels: number): [number, number] {
  return [(x / size + .5) * pixels, (z / size + .5) * pixels]
}
/**
 * Luma (sRGB, 0 to 1) a world's map colours are fitted into, hue and saturation kept. Marks
 * are at least luma .5 with dark outlines, so on pale ice and bright lava alike they stand
 * out from a map no brighter than MAP_LUMA[1].
 */
export const MAP_LUMA = [.16, .55] as const
type MapTerrain = Pick<Terrain, 'size' | 'heightAt' | 'mapColourAt' | 'liquidKindAt'>
/**
 * The map's picture, sampled once per world (and again when its sea changes); drawing marks
 * never resamples. With Terrain.mapColourAt it is the world's own colours under a hillshade
 * (flat liquids shaded gently), fitted into MAP_LUMA. Without it, the brown relief map,
 * with water and lava where the terrain says they are.
 */
export function heightPixels(terrain: MapTerrain, pixels: number): Uint8ClampedArray {
  const heights = new Float32Array(pixels * pixels)
  let min = Infinity, max = -Infinity
  for (let z = 0; z < pixels; z++) for (let x = 0; x < pixels; x++) {
    const value = terrain.heightAt(((x + .5) / pixels - .5) * terrain.size, ((z + .5) / pixels - .5) * terrain.size)
    const height = Number.isFinite(value) ? value : 0
    heights[z * pixels + x] = height; min = Math.min(min, height); max = Math.max(max, height)
  }
  const out = new Uint8ClampedArray(pixels * pixels * 4), span = Math.max(1, max - min), step = terrain.size / pixels
  for (let z = 0; z < pixels; z++) for (let x = 0; x < pixels; x++) {
    const i = z * pixels + x, height = (heights[i] - min) / span
    const dx = heights[z * pixels + Math.min(pixels - 1, x + 1)] - heights[z * pixels + Math.max(0, x - 1)]
    const dz = heights[Math.min(pixels - 1, z + 1) * pixels + x] - heights[Math.max(0, z - 1) * pixels + x]
    const relief = (dx + dz) / (step * 6), wx = ((x + .5) / pixels - .5) * terrain.size, wz = ((z + .5) / pixels - .5) * terrain.size
    const liquid = terrain.liquidKindAt?.(wx, wz) ?? null
    let r: number, g: number, b: number
    if (terrain.mapColourAt) {
      // Fit the world's colour into MAP_LUMA first (scaling keeps hue; an even grey lifts
      // black rock, which has none), then shade, so relief survives on dark worlds. Shadows
      // may fall below the band; nothing lit rises above it.
      // Average four samples a quarter pixel either side of the centre: the hook's grid is
      // finer than the map but not aligned to it, so one sample stair-steps every shoreline.
      const q = step / 4
      r = g = b = 0
      for (let k = 0; k < 4; k++) {
        const c = terrain.mapColourAt(wx + (k & 1 ? q : -q), wz + (k & 2 ? q : -q))
        r += (c >> 16 & 255) / 4; g += (c >> 8 & 255) / 4; b += (c & 255) / 4
      }
      let luma = (.2126 * r + .7152 * g + .0722 * b) / 255
      // Headroom under the cap, so lit slopes still read brighter on pale worlds.
      const top = MAP_LUMA[1] / 1.2
      if (luma > top) { const fit = top / luma; r *= fit; g *= fit; b *= fit }
      else if (luma < MAP_LUMA[0]) { const lift = (MAP_LUMA[0] - luma) * 255; r += lift; g += lift; b += lift }
      // Ground takes the full hillshade; a liquid surface is flat, so only a hint of the bed.
      const shade = liquid ? Math.max(.9, Math.min(1.08, 1 + relief * .15)) : Math.max(.45, Math.min(1.3, 1 + relief))
      r *= shade; g *= shade; b *= shade
      luma = (.2126 * r + .7152 * g + .0722 * b) / 255
      if (luma > MAP_LUMA[1]) { const fit = MAP_LUMA[1] / luma; r *= fit; g *= fit; b *= fit }
    } else {
      const shade = Math.max(.4, Math.min(1.3, .85 + relief))
      if (liquid) { r = liquid === 'lava' ? 190 : 40; g = liquid === 'lava' ? 70 : 82; b = liquid === 'lava' ? 24 : 112 }
      else { r = (65 + height * 125) * shade; g = (50 + height * 95) * shade; b = (44 + height * 75) * shade }
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255
  }
  return out
}

// Geometry. Marks are laid out in a 320-unit square covering the whole minimap element, so
// every layout scales the same way. The terrain fills the element (the whole planet across
// it); the rim ring sits at RIM of the half width and the band outside it holds the dots.
/** The rim ring's radius as a fraction of the element's half width. CSS: inset 11.5%. */
export const RIM = .77
export const UNITS = 320
const RIM_UNITS = RIM * UNITS / 2
const BAND_UNITS = UNITS / 2 - RIM_UNITS
/** Width of the cross-fade either side of the rim, in units. */
const HANDOVER = 10
/** Distance from the rim to the centre of the first and second ring of dots, before mark scale. */
const LANE = 11, LANE_STEP = 13

/** CIE L* (0..100) to relative luminance (0..1). */
function luminance(lightness: number): number {
  return lightness > 8 ? ((lightness + 16) / 116) ** 3 : Math.max(0, lightness) / 903.3
}
/**
 * How bright a dot beyond the rim is: 1 just past the rim, 0 at the far side of the planet.
 * The fade is linear in perceived lightness (CIE L*), so equal steps of distance read as
 * equal steps of brightness; `markLook` turns that into an opacity.
 */
export function rimFade(distance: number, rimDistance: number, farthest: number): number {
  const u = (distance - rimDistance) / Math.max(1e-6, farthest - rimDistance)
  return 1 - Math.min(1, Math.max(0, u))
}
export interface MarkLook { radius: number; alpha: number }
/**
 * Size (units) and opacity of a vehicle's mark. Inside the map (`fade` 1) that is its arrow;
 * beyond the rim, its dot at `fade` from `rimFade`. People run from L* 100 down to 38 (still
 * faintly findable at the far side), bots from L* 96 down to 0 (they vanish there).
 */
export function markLook(kind: MapKind, fade: number, out: MarkLook = { radius: 0, alpha: 0 }): MarkLook {
  // A bot's lightness bends up (fade^.7) so the nearest third of the fade stays clearly visible.
  if (kind === 'bot') { out.alpha = luminance(96 * fade ** .7); out.radius = 3 + 1.6 * fade }
  else if (kind === 'zone') { out.alpha = 1; out.radius = 5 }
  else { out.alpha = luminance(38 + 62 * fade); out.radius = 5.5 + 2.6 * fade }
  return out
}
/** Arrow sizes inside the map (units from the centre to the tip). */
export const ARROW = { self: 12, person: 10, bot: 6 } as const

export interface MarkPlace { x: number; y: number; distance: number; bearing: number; blend: number }
/**
 * Where a mark goes, relative to the map centre. `dx`, `dz` are the shortest offsets round
 * the planet (wrapDelta). Inside the rim, `blend` is 0 and the mark is an arrow at its true
 * place; past it, `blend` is 1 and the mark is a dot `lane` units outside the rim on the
 * bearing toward the vehicle. Across the rim it slides and cross-fades between the two.
 * `bearing` is screen radians: 0 east, π/2 south (north is up).
 */
export function placeMark(dx: number, dz: number, unitsPerMetre: number, lane: number, out: MarkPlace): MarkPlace {
  const distance = Math.hypot(dx, dz), r = distance * unitsPerMetre
  const bearing = Math.atan2(dz, dx)
  const s = Math.min(1, Math.max(0, (r - (RIM_UNITS - HANDOVER)) / (2 * HANDOVER)))
  const blend = s * s * (3 - 2 * s)
  const radius = r + blend * (RIM_UNITS + lane - r)
  out.x = Math.cos(bearing) * radius; out.y = Math.sin(bearing) * radius
  out.distance = distance; out.bearing = bearing; out.blend = blend
  return out
}

const parsed = new Map<string, string>()
/**
 * The colour a mark is drawn in: the vehicle's own tint, lifted to at least a readable
 * lightness on the dark map with its hue and saturation kept. Cached per input string.
 */
export function markColor(hex: string | undefined): string {
  const key = hex ?? ''
  let out = parsed.get(key)
  if (out) return out
  const m = /^#?([0-9a-f]{6})$/i.exec(key)
  const v = m ? parseInt(m[1], 16) : 0xc8d0d8
  const r = (v >> 16 & 255) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  let h = 0, s = 0
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  }
  // Lift HSL lightness, keeping hue and saturation, until the colour reads on the dark map
  // (sRGB luma at least .5). Tints already that bright are kept exactly.
  const hsl = (lightness: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * lightness - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), o = lightness - c / 2
    const [rr, gg, bb] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
    return [rr + o, gg + o, bb + o]
  }
  const luma = (rgb: readonly number[]): number => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
  let rgb: number[] = [r, g, b]
  for (let lightness = l; luma(rgb) < .5 && lightness < .95; lightness = Math.min(.95, lightness + .02)) rgb = hsl(Math.max(lightness, l))
  out = '#' + rgb.map(t => Math.round(Math.min(1, Math.max(0, t)) * 255).toString(16).padStart(2, '0')).join('')
  if (parsed.size > 256) parsed.clear()
  parsed.set(key, out)
  return out
}

/** Pooled per-entity state; filled at the network rate, read at the draw rate. */
interface Slot {
  x: number; z: number; heading: number; kind: MapKind; it: boolean; self: boolean
  color: string; accent: string
  place: MarkPlace; look: MarkLook; priority: number; lane: number; shown: boolean
}
const newSlot = (): Slot => ({ x: 0, z: 0, heading: 0, kind: 'person', it: false, self: false, color: '', accent: '', place: { x: 0, y: 0, distance: 0, bearing: 0, blend: 0 }, look: { radius: 0, alpha: 0 }, priority: 0, lane: 0, shown: false })

const OUTLINE = '#07101b', IT = '#9dff8a'

export class Minimap {
  readonly element = document.createElement('aside')
  private readonly canvas = document.createElement('canvas')
  private readonly marks = document.createElement('canvas')
  private readonly base = document.createElement('canvas')
  private readonly pixels = 160
  private readonly unsubscribe?: () => void
  private readonly resize?: ResizeObserver
  private slots: Slot[] = []
  private count = 0
  private readonly order: number[] = []
  private self?: MapEntity
  private selfSlot = newSlot()
  /** Marks grow on small maps so a phone's 96 px map stays legible. Updated on resize, not per draw. */
  private markScale = 1
  private lastDraw = 0
  private keyChecked = 0
  private baked = 0
  private bakedKey?: string
  private northX = 0
  private northY = 0
  private northR = 0
  constructor(private readonly terrain: Terrain, parent: HTMLElement) {
    this.element.className = 'shell-minimap'; this.canvas.width = this.canvas.height = this.base.width = this.base.height = this.pixels
    this.marks.className = 'shell-minimap-marks'; this.marks.width = this.marks.height = 2 * UNITS
    this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'Terrain map, centred on your vehicle. White arrow is you; people are large ringed arrows, bots small chevrons, each in its own colour. Dots outside the ring point to vehicles beyond it, fainter the farther away. North is up.')
    this.marks.setAttribute('aria-hidden', 'true')
    const north = document.createElement('span'); north.textContent = 'N'; this.element.append(this.canvas, this.marks, north); parent.append(this.element)
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width ?? 0
        if (width <= 0) return
        this.markScale = Math.min(1.6, Math.max(1, 160 / width))
        // Where the N label sits, in mark units, read on resize only, so dots can keep off it.
        const box = this.element.getBoundingClientRect(), label = north.getBoundingClientRect(), k = UNITS / box.width
        this.northX = (label.left + label.width / 2 - box.left - box.width / 2) * k
        this.northY = (label.top + label.height / 2 - box.top - box.height / 2) * k
        this.northR = label.width > 0 ? Math.max(label.width, label.height) / 2 * k : 0
      })
      this.resize.observe(this.element)
    }
    this.regenerate(); this.unsubscribe = terrain.onRegenerate?.(() => this.regenerate())
  }
  private regenerate(): void {
    this.bakedKey = this.colourKey(); this.baked = performance.now()
    const ctx = this.base.getContext('2d')!, data = ctx.createImageData(this.pixels, this.pixels)
    data.data.set(heightPixels(this.terrain, this.pixels)); ctx.putImageData(data, 0, 0)
    this.element.dataset.revision = String(Number(this.element.dataset.revision || 0) + 1)
    this.draw()
  }
  /** Copied into pooled slots: the caller's list is free to change afterwards. */
  setEntities(entities: readonly MapEntity[]): void {
    let n = 0
    for (const entity of entities) {
      if (entity.self) { this.setSelf(entity); continue }
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z) || !Number.isFinite(entity.heading)) continue
      const slot = this.slots[n] ?? (this.slots[n] = newSlot()); n++
      slot.x = entity.x; slot.z = entity.z; slot.heading = entity.heading
      slot.kind = entity.kind ?? 'person'; slot.it = Boolean(entity.it); slot.self = false
      slot.color = slot.kind === 'zone' ? (/^#[0-9a-f]{6}$/i.test(entity.color) ? entity.color : '#ffb814') : markColor(entity.color)
      slot.accent = entity.accent ? markColor(entity.accent) : ''
      slot.priority = slot.kind === 'person' ? 0 : slot.kind === 'zone' ? 1 : 2
    }
    this.count = n
  }
  setSelf(entity: MapEntity): void { this.self = entity }
  update(): void {
    const now = performance.now()
    // The map's colours follow the sea: a gliding sea level or a freezing sea changes the
    // hook's key. Checked twice a second, rebaked at most once a second while it moves.
    if (now - this.keyChecked > 500) {
      this.keyChecked = now
      const key = this.colourKey()
      if (key !== this.bakedKey && now - this.baked > 1000) this.regenerate()
    }
    if (now - this.lastDraw > 100) { this.lastDraw = now; this.draw() }
  }
  /** Changes whenever Terrain.mapColourAt would answer differently; cheap, never bakes. */
  private colourKey(): string | undefined { return this.terrain.mapColourKey?.() }
  /**
   * The world wraps, so the map does too: the player is always at the centre, north is up,
   * and the terrain scrolls under them, repeating at the edges. Everything else is drawn at
   * its nearest image, so a friend just across the seam shows beside you, not a world away.
   * Vehicles past the rim become dots just outside it, on the bearing toward them.
   */
  private draw(): void {
    const ctx = this.canvas.getContext('2d')!, n = this.pixels, size = this.terrain.size
    const me = this.self
    const cx = me && Number.isFinite(me.x) ? me.x : 0, cz = me && Number.isFinite(me.z) ? me.z : 0
    // Where the tile's top left corner lands so that (cx, cz) is at the centre, wrapped into
    // (-n, 0], then the tile is tiled four times to fill the square.
    const [px, pz] = mapPoint(cx, cz, size, n)
    const ox = -((((px - n / 2) % n) + n) % n), oz = -((((pz - n / 2) % n) + n) % n)
    for (const dz of [0, n]) for (const dx of [0, n]) ctx.drawImage(this.base, Math.round(ox) + dx, Math.round(oz) + dz)
    this.drawMarks(cx, cz, size)
  }
  private drawMarks(cx: number, cz: number, size: number): void {
    const ctx = this.marks.getContext('2d')!, k = this.marks.width / UNITS, m = this.markScale
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.marks.width, this.marks.height)
    ctx.setTransform(k, 0, 0, k, UNITS / 2 * k, UNITS / 2 * k)
    const unitsPerMetre = UNITS / size, rimDistance = RIM_UNITS / unitsPerMetre, farthest = size * Math.SQRT1_2
    // Lay out, then order by priority (people, the hill, bots; nearer first) without allocating.
    const order = this.order; order.length = 0
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]
      placeMark(wrapDelta(cx, s.x, size), wrapDelta(cz, s.z, size), unitsPerMetre, LANE * m, s.place)
      markLook(s.kind, s.kind === 'zone' ? 1 : rimFade(s.place.distance, rimDistance, farthest), s.look)
      s.look.radius *= m; s.lane = 0; s.shown = s.look.alpha * s.place.blend > .01 || s.place.blend < 1
      let j = order.length; order.push(i)
      while (j > 0 && this.before(s, this.slots[order[j - 1]])) { order[j] = order[j - 1]; j-- }
      order[j] = i
    }
    // Dots that would touch move out to the second ring where the band has room for it, else
    // slide along the rim, alternating sides, up to three dot widths (a phone's band holds one
    // ring). Past that they stack, the higher priority drawn on top.
    for (let a = 0; a < order.length; a++) {
      const s = this.slots[order[a]]
      if (s.place.blend <= 0 || !s.shown || !this.collides(a, s)) continue
      const x0 = s.place.x, y0 = s.place.y, step = LANE_STEP * m * s.place.blend
      if (LANE * m + step + s.look.radius <= BAND_UNITS) {
        const scale = (RIM_UNITS + LANE * m + step) / (RIM_UNITS + LANE * m)
        s.place.x = x0 * scale; s.place.y = y0 * scale; s.lane = 1
        if (!this.collides(a, s)) continue
        s.place.x = x0; s.place.y = y0; s.lane = 0
      }
      const radius = Math.hypot(x0, y0), turn = (2 * s.look.radius + 2) / Math.max(1, radius)
      let free = false
      for (let k = 1; k <= 6 && !free; k++) {
        const angle = s.place.bearing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * turn
        s.place.x = Math.cos(angle) * radius; s.place.y = Math.sin(angle) * radius
        free = !this.collides(a, s)
      }
      if (!free) { s.place.x = x0; s.place.y = y0 }
    }
    for (let a = order.length - 1; a >= 0; a--) { const s = this.slots[order[a]]; if (s.shown) this.drawMark(ctx, s, m) }
    if (this.self && Number.isFinite(this.self.x) && Number.isFinite(this.self.z) && Number.isFinite(this.self.heading)) {
      const s = this.selfSlot
      s.heading = this.self.heading; s.it = Boolean(this.self.it); s.place.x = s.place.y = 0
      ctx.save(); ctx.rotate(-s.heading); this.arrowPath(ctx, ARROW.self * m)
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2.5 * m; ctx.fill(); ctx.stroke(); ctx.restore()
      if (s.it) this.itRing(ctx, 0, 0, (ARROW.self + 6) * m, 1)
    }
  }
  private before(a: Slot, b: Slot): boolean {
    return a.priority !== b.priority ? a.priority < b.priority : a.place.distance < b.place.distance
  }
  /** True if the dot touches a higher-priority dot or the N label. */
  private collides(index: number, s: Slot): boolean {
    if (this.northR > 0) {
      const gap = s.look.radius + this.northR, dx = s.place.x - this.northX, dy = s.place.y - this.northY
      if (dx * dx + dy * dy < gap * gap) return true
    }
    for (let b = 0; b < index; b++) {
      const o = this.slots[this.order[b]]
      if (!o.shown || o.place.blend <= 0) continue
      const gap = s.look.radius + o.look.radius + 2
      const dx = s.place.x - o.place.x, dy = s.place.y - o.place.y
      if (dx * dx + dy * dy < gap * gap) return true
    }
    return false
  }
  private arrowPath(ctx: CanvasRenderingContext2D, length: number): void {
    const w = length * .66
    ctx.beginPath(); ctx.moveTo(0, -length); ctx.lineTo(w, length * .83); ctx.lineTo(0, length * .5); ctx.lineTo(-w, length * .83); ctx.closePath()
  }
  private itRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
    ctx.globalAlpha = alpha; ctx.strokeStyle = IT; ctx.lineWidth = 2; ctx.setLineDash([3, 2.5])
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
  }
  private drawMark(ctx: CanvasRenderingContext2D, s: Slot, m: number): void {
    const { x, y, blend } = s.place, arrow = 1 - blend, dot = blend * s.look.alpha
    if (s.kind === 'zone') {
      ctx.globalAlpha = 1; ctx.fillStyle = s.color; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x, y, (7 - 2 * blend) * m, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); return
    }
    const person = s.kind === 'person'
    if (arrow > .01) {
      ctx.save(); ctx.translate(x, y); ctx.globalAlpha = arrow
      if (person) {
        // A ring in the vehicle's tint, with a wide faint stroke under it for the glow.
        const ring = (ARROW.person + 3) * m
        ctx.strokeStyle = s.color; ctx.globalAlpha = arrow * .22; ctx.lineWidth = 6 * m
        ctx.beginPath(); ctx.arc(0, 0, ring, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = arrow * .9; ctx.lineWidth = 1.6 * m; ctx.stroke()
        ctx.globalAlpha = arrow; ctx.rotate(-s.heading); this.arrowPath(ctx, ARROW.person * m)
        ctx.fillStyle = s.color; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2 * m; ctx.fill(); ctx.stroke()
        if (s.accent) { ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(0, ARROW.person * .18 * m, 2 * m, 0, Math.PI * 2); ctx.fill() }
      } else {
        // A small open chevron, no ring, no fill: plainer and dimmer than a person at any colour.
        const l = ARROW.bot * m
        ctx.rotate(-s.heading); ctx.beginPath(); ctx.moveTo(-l * .75, l * .7); ctx.lineTo(0, -l); ctx.lineTo(l * .75, l * .7)
        ctx.lineJoin = 'round'; ctx.lineCap = 'round'
        ctx.strokeStyle = OUTLINE; ctx.globalAlpha = arrow * .7; ctx.lineWidth = 4 * m; ctx.stroke()
        ctx.strokeStyle = s.color; ctx.globalAlpha = arrow * .72; ctx.lineWidth = 2 * m; ctx.stroke()
      }
      ctx.restore(); ctx.globalAlpha = 1
    }
    if (dot > .01) {
      const r = s.look.radius
      // Dots sit over the live scene, not the map, so every dot carries both a dark outline
      // and a light inner edge: one of the two contrasts with any sky, red dusk or white ice.
      ctx.globalAlpha = Math.min(1, dot * 1.4); ctx.fillStyle = OUTLINE
      ctx.beginPath(); ctx.arc(x, y, r + 1.6 * m, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = dot; ctx.fillStyle = s.color
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = dot * .85; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = .9 * m
      ctx.beginPath(); ctx.arc(x, y, r - .45 * m, 0, Math.PI * 2); ctx.stroke()
      ctx.globalAlpha = dot
      if (person) {
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.4 * m; ctx.beginPath(); ctx.arc(x, y, r + 2.6 * m, 0, Math.PI * 2); ctx.stroke()
        if (s.accent && r > 4) { ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(x, y, r * .38, 0, Math.PI * 2); ctx.fill() }
      }
      ctx.globalAlpha = 1
    }
    if (s.it) this.itRing(ctx, x, y, (person ? ARROW.person + 7 : ARROW.bot + 6) * m * arrow + (s.look.radius + 5 * m) * blend, Math.max(arrow, Math.sqrt(dot)))
  }
  dispose(): void { this.unsubscribe?.(); this.resize?.disconnect(); this.element.remove() }
}

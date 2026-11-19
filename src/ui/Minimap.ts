import { wrapDelta } from '../../shared/wrap'
import type { Terrain } from '../world/Terrain'

/** What a marker stands for. People and bots are vehicles; a zone is a place (the hill). */
/** A flare: where a Plasma Thunder burst went up, in its shooter's colour, fading. */
export type MapKind = 'person' | 'bot' | 'zone' | 'flare'
export interface MapEntity {
  x: number; z: number; heading: number
  /** The vehicle's own tint, '#rrggbb'. Colour on the map means identity, never kind. */
  color: string
  /** The vehicle's secondary paint: the ridge of a person's mark, to tell similar paints apart. */
  accent?: string
  /** Absent means a person: the safe default is the more prominent mark. */
  kind?: MapKind
  /** A flare's remaining life, 1 new to 0 gone. */
  fade?: number
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
/** Width of the cross-fade either side of the rim, in units. */
const HANDOVER = 10
/** More rim glyphs than this within a quarter of the ring are laid out as an ordered crowd. */
const CROWD = 6
/**
 * How far (radians, about 3 degrees) the marks may be carried by a transform before they are
 * redrawn at the map's new angle. Within it, only their shading's light and the Tag tick lean
 * with the map, too little to see.
 */
const REDRAW_TURN = .05

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
  if (kind === 'bot') { out.alpha = luminance(96 * fade ** .7); out.radius = 2.2 + .9 * fade }
  else if (kind === 'zone' || kind === 'flare') { out.alpha = 1; out.radius = 4 }
  else { out.alpha = luminance(38 + 62 * fade); out.radius = 3.4 + 1.6 * fade }
  return out
}
/** Arrow sizes inside the map (units from the centre to the tip). */
export const ARROW = { self: 13.5, person: 11.5, bot: 7 } as const

/**
 * Which way the camera looks across the ground, as a game heading (the same angle as a
 * vehicle's: 0 looks north, toward -z, and forward is (-sin h, -cos h)). `q` is the camera's
 * world rotation. Looking level, that is just the forward vector flattened. Pitched toward
 * straight down or up the flattened forward shrinks to nothing, so the camera's up vector
 * fills in: for any camera without roll, forward·cos(pitch) - up·sin(pitch) flattened is
 * exactly the level view direction, at every pitch, so the map neither spins nor flips as
 * the view passes through vertical. Only a heavily rolled camera pointing straight down can
 * leave nothing usable; then the last good heading stands.
 */
export function cameraHeading(q: { x: number; y: number; z: number; w: number }, last: number): number {
  const { x, y, z, w } = q
  const fx = -2 * (x * z + w * y), fy = -2 * (y * z - w * x), fz = -(1 - 2 * (x * x + y * y))
  const ux = 2 * (x * y - w * z), uz = 2 * (y * z + w * x)
  const level = Math.sqrt(Math.max(0, 1 - fy * fy))
  const hx = fx * level - ux * fy, hz = fz * level - uz * fy
  return hx * hx + hz * hz > .0025 && Number.isFinite(hx + hz) ? Math.atan2(-hx, -hz) : last
}
/** An angle in (-π, π]. */
const wrapAngle = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
/**
 * The map's next turn toward the camera's heading. A change of a degree or more is taken at
 * once, so the map never trails the camera; below that the step eases in proportion, which
 * settles the spring camera's hairline wobble without a lag anyone could see.
 */
export function followTurn(current: number, target: number): number {
  const d = wrapAngle(target - current)
  return wrapAngle(current + d * Math.min(1, Math.max(.35, Math.abs(d) / .0175)))
}
/**
 * A world offset (east `dx`, south `dz`, metres) turned onto the map, where `turn` is the
 * heading at the top of the map: 0 is north up. With the camera facing `turn`, what lies
 * ahead of it is up the map and what lies to its right is to the right.
 */
export function turnOffset(dx: number, dz: number, turn: number, out: { x: number; y: number }): { x: number; y: number } {
  const c = Math.cos(turn), s = Math.sin(turn)
  out.x = dx * c - dz * s; out.y = dx * s + dz * c
  return out
}

export interface MarkPlace { x: number; y: number; distance: number; bearing: number; blend: number }
/**
 * Where a mark goes, relative to the map centre. `dx`, `dz` are the shortest offsets round
 * the planet (wrapDelta). Inside the rim, `blend` is 0 and the mark is an arrow at its true
 * place; past it, `blend` is 1 and the mark is a dot `lane` units outside the rim on the
 * bearing toward the vehicle. Across the rim it slides and cross-fades between the two.
 * `bearing` is screen radians: 0 right, π/2 down. The caller turns the offsets with
 * `turnOffset` first when the map is heading up.
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
  color: string; shades: readonly string[]; accent: string
  place: MarkPlace; look: MarkLook; priority: number; shown: boolean
  /** Distance fade beyond the rim, 1 at the rim, 0 at the far side. */
  fade: number
  /** True when the glyph is part of a crowd on the rim, laid out as an ordered sector. */
  crowd: boolean
  /** A flare's remaining life, 1 new to 0 gone. */
  life: number
}
const newSlot = (): Slot => ({ x: 0, z: 0, heading: 0, kind: 'person', it: false, self: false, color: '', shades: [], accent: '', place: { x: 0, y: 0, distance: 0, bearing: 0, blend: 0 }, look: { radius: 0, alpha: 0 }, priority: 0, shown: false, fade: 1, crowd: false, life: 1 })

const IT = '#9dff8a', HAIRLINE = 'rgba(4, 10, 18, .55)'
/** Mix steps from the paint toward black (negative) or white (positive): the facet shades. */
const SHADE_STEPS = [-.42, -.28, -.14, 0, .14, .28, .42]
const shadeCache = new Map<string, readonly string[]>()
/** Seven shades of a '#rrggbb' paint, darkest first; cached so drawing never builds a string. */
export function markShades(hex: string): readonly string[] {
  let out = shadeCache.get(hex)
  if (out) return out
  const v = parseInt(hex.slice(1), 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255]
  out = SHADE_STEPS.map(t => '#' + c.map(ch => Math.round(t < 0 ? ch * (1 + t) : ch + (255 - ch) * t).toString(16).padStart(2, '0')).join(''))
  if (shadeCache.size > 256) shadeCache.clear()
  shadeCache.set(hex, out)
  return out
}

/**
 * A mark's form: an outline and the facets that shade it, in units of its length (tip at
 * y = -1), each facet with the direction its face looks, for the light.
 */
interface Form { outline: readonly number[]; facets: readonly { points: readonly number[]; nx: number; ny: number }[]; ridge?: readonly number[] }
/** Light from the upper left of the screen, as the HUD's own shading reads. */
const LIGHT_X = -.6, LIGHT_Y = -.8
/** The two directions on the comparison sheet: a folded paper dart, and a cut four-facet kite. */
export const FORMS: Record<'dart' | 'kite' | 'bot', Form> = {
  dart: {
    outline: [0, -1, .6, .72, 0, .38, -.6, .72],
    facets: [{ points: [0, -1, 0, .38, -.6, .72], nx: -1, ny: -.25 }, { points: [0, -1, .6, .72, 0, .38], nx: 1, ny: -.25 }],
    ridge: [0, -1, 0, .38],
  },
  kite: {
    outline: [0, -1, .46, .12, 0, .78, -.46, .12],
    facets: [
      { points: [0, -1, 0, .12, -.46, .12], nx: -.7, ny: -.7 }, { points: [0, -1, .46, .12, 0, .12], nx: .7, ny: -.7 },
      { points: [-.46, .12, 0, .12, 0, .78], nx: -.7, ny: .7 }, { points: [0, .12, .46, .12, 0, .78], nx: .7, ny: .7 },
    ],
    ridge: [0, -1, 0, .78],
  },
  // Bots: one flat plate of the same family, smaller and plainer than any person's mark.
  bot: { outline: [0, -1, .62, .7, -.62, .7], facets: [{ points: [0, -1, .62, .7, -.62, .7], nx: 0, ny: 0 }] },
}

export class Minimap {
  /** Which form people and you are drawn in. 'dart' ships; 'kite' is the alternative shown to the owner. */
  static markStyle: 'dart' | 'kite' = 'dart'
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
  /** Rim glyphs by bearing, reused each draw. */
  private readonly rim: number[] = []
  private self?: MapEntity
  /** Your own mark: white, shaded in neutral greys so its facets read. */
  private readonly selfShades: readonly string[] = ['#8f8f8d', '#a8a8a6', '#bdbdbb', '#d4d4d2', '#e7e7e5', '#f5f5f4', '#ffffff']
  /** Marks grow on small maps so a phone's 96 px map stays legible. Updated on resize, not per draw. */
  private markScale = 1
  /** Units per device pixel on the marks canvas, so hairlines are one device pixel. */
  private px = .5
  /** Cached sprites, cleared on resize: soft shadows by form and size, glows and rim auras by colour. Keys need no string building per draw. */
  private readonly shadows = new Map<number, HTMLCanvasElement>()
  private readonly glows = new Map<string, HTMLCanvasElement>()
  private readonly auras = new Map<string, HTMLCanvasElement>()
  private lastDraw = 0
  private keyChecked = 0
  private baked = 0
  private bakedKey?: string
  private northX = 0
  private northY = 0
  private northR = 0
  private unwatchRatio?: () => void
  /** The heading at the top of the map: 0 when north is up, else the camera's, smoothed. */
  turn = 0
  /** The turn the marks and the N were last drawn at. */
  private drawnTurn = 0
  private viewHeading = 0
  private hasView = false
  private northUp = false
  private northLabel!: HTMLSpanElement
  /** The N label's resting centre and the rim radius, in CSS pixels from the map's centre. */
  private labelRadius = 0
  private labelY = 0
  private width = 0
  private readonly offset = { x: 0, y: 0 }
  constructor(private readonly terrain: Terrain, parent: HTMLElement) {
    this.element.className = 'shell-minimap'; this.canvas.width = this.canvas.height = this.base.width = this.base.height = this.pixels
    this.marks.className = 'shell-minimap-marks'; this.marks.width = this.marks.height = 2 * UNITS
    this.canvas.setAttribute('role', 'img'); this.describe()
    this.marks.setAttribute('aria-hidden', 'true')
    const north = this.northLabel = document.createElement('span'); north.textContent = 'N'; this.element.append(this.canvas, this.marks, north); parent.append(this.element)
    // Layout is read only here: on resize, and when the screen's pixel ratio changes (a window
    // moved to another monitor, or zoom), never per draw.
    const fit = (): void => {
      const box = this.element.getBoundingClientRect(), width = box.width
      if (width <= 0) return
      this.markScale = Math.min(1.6, Math.max(1, 160 / width))
      // Draw at the device's own resolution so edges are crisp at 1x, 2x and 3x.
      const device = Math.max(64, Math.round(width * (window.devicePixelRatio || 1)))
      if (this.marks.width !== device) { this.marks.width = this.marks.height = device; this.shadows.clear(); this.glows.clear(); this.auras.clear() }
      this.px = UNITS / device
      // Where the N label rests (north up), measured without the turn, in mark units so
      // glyphs can keep off it; placeNorth turns it round the rim from there.
      const turned = north.style.transform; north.style.transform = ''
      const label = north.getBoundingClientRect(), k = UNITS / width
      north.style.transform = turned
      this.width = width
      this.labelY = label.top + label.height / 2 - box.top - box.height / 2
      this.labelRadius = Math.hypot(label.left + label.width / 2 - box.left - width / 2, this.labelY)
      this.northR = label.width > 0 ? Math.max(label.width, label.height) / 2 * k : 0
      // The N's offset depends on the size just measured: let the next draw place it again.
      this.element.style.removeProperty('--map-turn')
      this.draw()
    }
    if (typeof ResizeObserver !== 'undefined') { this.resize = new ResizeObserver(fit); this.resize.observe(this.element) }
    const watchRatio = (): void => {
      if (typeof matchMedia === 'undefined') return
      const query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      const changed = (): void => { query.removeEventListener('change', changed); fit(); watchRatio() }
      query.addEventListener('change', changed); this.unwatchRatio = () => query.removeEventListener('change', changed)
    }
    watchRatio()
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
      slot.life = Math.min(1, Math.max(0, entity.fade ?? 1))
      slot.shades = markShades(slot.color); slot.accent = entity.accent ? markColor(entity.accent) : slot.shades[6]
      slot.priority = slot.kind === 'person' ? 0 : slot.kind === 'zone' || slot.kind === 'flare' ? 1 : 2
    }
    this.count = n
  }
  setSelf(entity: MapEntity): void { this.self = entity }
  /** The camera's heading (see cameraHeading), once a frame before update. */
  setView(heading: number): void { if (Number.isFinite(heading)) { this.viewHeading = heading; this.hasView = true } }
  /** North up (true) or heading up, the default. */
  setNorthUp(northUp: boolean): void {
    if (northUp === this.northUp) return
    this.northUp = northUp; this.describe()
    // Switching snaps; only the camera's own motion is followed.
    this.turn = northUp ? 0 : this.viewHeading
  }
  private describe(): void {
    this.canvas.setAttribute('aria-label', `Terrain map, centred on your vehicle. White dart is you; people are larger folded darts, bots small flat plates, each in its own colour. Glowing ticks on the ring point to vehicles beyond it, fainter and shorter the farther away. ${this.northUp ? 'North is up.' : 'The map turns with the camera: up is the way you are looking, and N on the ring marks north.'}`)
  }
  update(): void {
    const now = performance.now()
    this.turn = this.northUp || !this.hasView ? 0 : followTurn(this.turn, this.viewHeading)
    // Every frame the terrain, ticks, N and marks turn by transforms; the marks are redrawn
    // at the new angle only once they have been carried REDRAW_TURN, so a sweeping camera
    // costs a redraw every few frames, not every frame.
    if (Math.abs(wrapAngle(this.turn - this.drawnTurn)) > REDRAW_TURN) { this.lastDraw = now; this.draw() }
    else this.placeNorth()
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
   * Vehicles past the rim become glyphs on it, on the bearing toward them.
   */
  private draw(): void {
    this.drawnTurn = this.turn; this.placeNorth()
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
  /**
   * Turn the terrain and the ring's ticks by a CSS transform (the picture is never redrawn
   * to turn it), carry the marks from the angle they were drawn at to this one the same way,
   * and move the N round the rim to where north is. Its keep-clear spot for rim glyphs is
   * where it was when the marks were drawn.
   */
  private placeNorth(): void {
    const turn = this.turn, angle = `${turn.toFixed(4)}rad`, north = this.offset
    // Each written only when it changes. The marks' carry changes on a redraw even when the
    // map's angle does not.
    const carry = `${wrapAngle(turn - this.drawnTurn).toFixed(4)}rad`
    if (this.element.style.getPropertyValue('--marks-turn') !== carry) this.element.style.setProperty('--marks-turn', carry)
    if (this.element.style.getPropertyValue('--map-turn') !== angle) {
      // CSS rotate() and turnOffset turn the same way: clockwise on screen for a positive angle.
      this.element.style.setProperty('--map-turn', angle)
      // North is the world's -z: one metre north, turned like everything else.
      turnOffset(0, -1, turn, north)
      const r = this.labelRadius
      this.northLabel.style.transform = turn === 0 ? '' : `translate(-50%, 0) translate(${(north.x * r).toFixed(2)}px, ${(north.y * r - this.labelY).toFixed(2)}px)`
    }
    turnOffset(0, -1, this.drawnTurn, north)
    const k = this.width > 0 ? UNITS / this.width : 0
    this.northX = north.x * this.labelRadius * k; this.northY = north.y * this.labelRadius * k
  }
  private drawMarks(cx: number, cz: number, size: number): void {
    const ctx = this.marks.getContext('2d')!, k = this.marks.width / UNITS, m = this.markScale
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.marks.width, this.marks.height)
    ctx.setTransform(k, 0, 0, k, UNITS / 2 * k, UNITS / 2 * k)
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'
    const unitsPerMetre = UNITS / size, rimDistance = RIM_UNITS / unitsPerMetre, farthest = size * Math.SQRT1_2
    // Lay out, then order by priority (people, the hill, bots; nearer first) without allocating.
    const order = this.order; order.length = 0
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]
      // Wrap first (the nearest image round the planet), then turn: turning keeps distances.
      const o = turnOffset(wrapDelta(cx, s.x, size), wrapDelta(cz, s.z, size), this.turn, this.offset)
      placeMark(o.x, o.y, unitsPerMetre, 0, s.place)
      s.fade = s.kind === 'zone' || s.kind === 'flare' ? 1 : rimFade(s.place.distance, rimDistance, farthest); s.crowd = false
      markLook(s.kind, s.fade, s.look)
      s.look.radius *= m; s.shown = s.look.alpha * s.place.blend > .01 || s.place.blend < 1
      let j = order.length; order.push(i)
      while (j > 0 && this.before(s, this.slots[order[j - 1]])) { order[j] = order[j - 1]; j-- }
      order[j] = i
    }
    this.orderCrowds()
    // Glyphs that would touch slide along the rim, alternating sides, a few widths at most;
    // past that they stack, the higher priority drawn on top.
    for (let a = 0; a < order.length; a++) {
      const s = this.slots[order[a]]
      if (s.place.blend <= 0 || !s.shown || s.crowd || !this.collides(a, s)) continue
      const x0 = s.place.x, y0 = s.place.y, radius = Math.hypot(x0, y0), turn = (2 * s.look.radius + 1.5) / Math.max(1, radius)
      let free = false
      for (let step = 1; step <= 8 && !free; step++) {
        const angle = s.place.bearing + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * turn
        s.place.x = Math.cos(angle) * radius; s.place.y = Math.sin(angle) * radius
        free = !this.collides(a, s)
      }
      if (!free) { s.place.x = x0; s.place.y = y0 }
    }
    for (let a = order.length - 1; a >= 0; a--) { const s = this.slots[order[a]]; if (s.shown) this.drawMark(ctx, s, m) }
    const me = this.self
    if (me && Number.isFinite(me.x) && Number.isFinite(me.z) && Number.isFinite(me.heading)) {
      // Your dart shows your heading against the camera's: straight up when you drive the way it looks.
      this.solid(ctx, FORMS[Minimap.markStyle], 0, 0, me.heading - this.turn, ARROW.self * m, this.selfShades, '#ffffff', 1, 1)
      if (me.it) this.itMark(ctx, 0, 0, (ARROW.self + 5) * m, 1)
    }
  }
  /**
   * A crowd on the rim reads as a count, not noise: where more than CROWD glyphs fall in a run
   * spanning at most a quarter of the ring, they are spaced evenly through that sector in their
   * bearing order (wider if they need it), and the bots' ticks shorten so people stand out.
   * Single glyphs and small groups are left to the ordinary spreading.
   */
  private orderCrowds(): void {
    const rim = this.rim; rim.length = 0
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]
      if (s.kind === 'zone' || s.kind === 'flare' || !s.shown || s.place.blend < .5) continue
      let j = rim.length; rim.push(i)
      while (j > 0 && this.slots[rim[j - 1]].place.bearing > s.place.bearing) { rim[j] = rim[j - 1]; j-- }
      rim[j] = i
    }
    const n = rim.length
    if (n <= CROWD) return
    // Start after the widest gap, so a run that crosses the west seam (bearing ±π) stays whole.
    let start = 0, widest = -1
    for (let a = 0; a < n; a++) {
      const gap = (this.slots[rim[(a + 1) % n]].place.bearing - this.slots[rim[a]].place.bearing + Math.PI * 2) % (Math.PI * 2)
      if (gap > widest) { widest = gap; start = (a + 1) % n }
    }
    // Runs: neighbours closer than a sixteenth of the ring belong together.
    let first = 0
    while (first < n) {
      let last = first
      while (last + 1 < n && this.gapAt(start, last) < Math.PI / 8) last++
      const count = last - first + 1, span = this.spanOf(start, first, last)
      if (count > CROWD && span <= Math.PI / 2) this.layCrowd(start, first, last, span)
      first = last + 1
    }
  }
  private at(start: number, k: number): Slot { return this.slots[this.rim[(start + k) % this.rim.length]] }
  private gapAt(start: number, k: number): number {
    return (this.at(start, k + 1).place.bearing - this.at(start, k).place.bearing + Math.PI * 2) % (Math.PI * 2)
  }
  private spanOf(start: number, first: number, last: number): number {
    return (this.at(start, last).place.bearing - this.at(start, first).place.bearing + Math.PI * 2) % (Math.PI * 2)
  }
  private layCrowd(start: number, first: number, last: number, span: number): void {
    const count = last - first + 1, from = this.at(start, first).place.bearing
    let widest = 0
    for (let k = first; k <= last; k++) widest = Math.max(widest, this.at(start, k).look.radius)
    const step = Math.max(span / (count - 1), (2 * widest + 1.5) / RIM_UNITS), centre = from + span / 2
    for (let k = first; k <= last; k++) {
      const s = this.at(start, k), angle = centre + (k - first - (count - 1) / 2) * step, radius = Math.hypot(s.place.x, s.place.y)
      s.place.x = Math.cos(angle) * radius; s.place.y = Math.sin(angle) * radius; s.crowd = true
    }
  }
  private before(a: Slot, b: Slot): boolean {
    return a.priority !== b.priority ? a.priority < b.priority : a.place.distance < b.place.distance
  }
  /** True if the glyph touches a higher-priority glyph or the N label. */
  private collides(index: number, s: Slot): boolean {
    if (this.northR > 0) {
      const gap = s.look.radius + this.northR, dx = s.place.x - this.northX, dy = s.place.y - this.northY
      if (dx * dx + dy * dy < gap * gap) return true
    }
    for (let b = 0; b < index; b++) {
      const o = this.slots[this.order[b]]
      if (!o.shown || o.place.blend <= 0) continue
      const gap = s.look.radius + o.look.radius + 1
      const dx = s.place.x - o.place.x, dy = s.place.y - o.place.y
      if (dx * dx + dy * dy < gap * gap) return true
    }
    return false
  }
  private path(ctx: CanvasRenderingContext2D, points: readonly number[], length: number): void {
    ctx.beginPath(); ctx.moveTo(points[0] * length, points[1] * length)
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i] * length, points[i + 1] * length)
    ctx.closePath()
  }
  /** A canvas of `size` device pixels with `paint` drawing into it, centred. Built once per cache entry. */
  private sprite(size: number, paint: (c: CanvasRenderingContext2D, half: number) => void): HTMLCanvasElement {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = Math.max(2, Math.ceil(size))
    paint(canvas.getContext('2d')!, canvas.width / 2)
    return canvas
  }
  /** A soft, tight shadow of a form: the silhouette spread three times at falling opacity. */
  private shadow(form: 0 | 1 | 2, length: number): HTMLCanvasElement {
    const devicePx = length / this.px, key = form * 100000 + Math.round(devicePx * 4)
    let canvas = this.shadows.get(key)
    if (!canvas) {
      const outline = [FORMS.dart, FORMS.kite, FORMS.bot][form].outline
      canvas = this.sprite(devicePx * 2.6 + 6, (c, half) => {
        c.translate(half, half); c.fillStyle = '#02070d'
        for (const [grow, alpha] of [[1.28, .1], [1.14, .2], [1, .38]]) {
          c.globalAlpha = alpha; c.beginPath()
          c.moveTo(outline[0] * devicePx * grow, outline[1] * devicePx * grow)
          for (let i = 2; i < outline.length; i += 2) c.lineTo(outline[i] * devicePx * grow, outline[i + 1] * devicePx * grow)
          c.closePath(); c.fill()
        }
      })
      this.shadows.set(key, canvas)
    }
    return canvas
  }
  /** A soft radial glow in a colour, 64 device pixels across, scaled where drawn. */
  private glow(colour: string): HTMLCanvasElement {
    let canvas = this.glows.get(colour)
    if (!canvas) {
      canvas = this.sprite(64, (c, half) => {
        const g = c.createRadialGradient(half, half, 0, half, half, half)
        g.addColorStop(0, colour); g.addColorStop(.35, colour + '66'); g.addColorStop(1, colour + '00')
        c.fillStyle = g; c.fillRect(0, 0, half * 2, half * 2)
      })
      this.glows.set(colour, canvas)
    }
    return canvas
  }
  /**
   * A rim glyph's aura in one sprite: a faint dark under-halo (legibility over bright sky and
   * ice) with the colour's glow on it, so a glyph costs one image draw for both.
   */
  private aura(colour: string): HTMLCanvasElement {
    let canvas = this.auras.get(colour)
    if (!canvas) {
      canvas = this.sprite(64, (c, half) => {
        const dark = c.createRadialGradient(half, half, 0, half, half, half)
        dark.addColorStop(0, 'rgba(2, 7, 13, .72)'); dark.addColorStop(.55, 'rgba(2, 7, 13, .3)'); dark.addColorStop(1, 'rgba(2, 7, 13, 0)')
        c.fillStyle = dark; c.fillRect(0, 0, half * 2, half * 2)
        const g = c.createRadialGradient(half, half, 0, half, half, half * .75)
        g.addColorStop(0, colour + 'b3'); g.addColorStop(.4, colour + '4d'); g.addColorStop(1, colour + '00')
        c.fillStyle = g; c.fillRect(0, 0, half * 2, half * 2)
      })
      this.auras.set(colour, canvas)
    }
    return canvas
  }
  /**
   * A solid, shaded mark: soft shadow below, facets shaded by how they face the light (so
   * the shape keeps its form as it turns), a lighter ridge and a one-device-pixel edge.
   */
  private solid(ctx: CanvasRenderingContext2D, form: Form, x: number, y: number, heading: number, length: number, shades: readonly string[], ridge: string, alpha: number, depth: number): void {
    const shadow = this.shadow(form === FORMS.bot ? 2 : form === FORMS.kite ? 1 : 0, length), half = shadow.width / 2 * this.px, rot = -heading
    const cos = Math.cos(rot), sin = Math.sin(rot), k = this.marks.width / UNITS, c = UNITS / 2
    ctx.globalAlpha = alpha
    // Rotate about the mark directly (no save and restore): the shadow a touch below, then the mark.
    ctx.setTransform(k * cos, k * sin, -k * sin, k * cos, k * (c + x + .4 * this.px * depth), k * (c + y + 1.3 * this.px * depth))
    ctx.drawImage(shadow, -half, -half, half * 2, half * 2)
    ctx.setTransform(k * cos, k * sin, -k * sin, k * cos, k * (c + x), k * (c + y))
    for (const facet of form.facets) {
      // The facet's face direction on screen, against the light: 0 darkest, 6 lightest.
      const nx = facet.nx * cos - facet.ny * sin, ny = facet.nx * sin + facet.ny * cos
      const lit = form === FORMS.bot ? .55 : (1 + nx * LIGHT_X + ny * LIGHT_Y) / 2
      ctx.fillStyle = shades[Math.round(1 + lit * 4.6)]; this.path(ctx, facet.points, length); ctx.fill()
    }
    if (form.ridge) {
      ctx.strokeStyle = ridge; ctx.globalAlpha = alpha * .9; ctx.lineWidth = 1.2 * this.px
      ctx.beginPath(); ctx.moveTo(form.ridge[0] * length, form.ridge[1] * length); ctx.lineTo(form.ridge[2] * length, form.ridge[3] * length); ctx.stroke()
      ctx.globalAlpha = alpha
    }
    ctx.strokeStyle = HAIRLINE; ctx.lineWidth = this.px; this.path(ctx, form.outline, length); ctx.stroke()
    ctx.setTransform(k, 0, 0, k, k * c, k * c); ctx.globalAlpha = 1
  }
  /** Tag's "it": a thin bright ring with a small glow, lighter than a border, unmistakable in green. */
  private itMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
    const glow = this.glow(IT)
    ctx.globalAlpha = alpha * .35; ctx.drawImage(glow, x - r * 1.5, y - r * 1.5, r * 3, r * 3)
    ctx.globalAlpha = alpha; ctx.strokeStyle = IT; ctx.lineWidth = 1.4 * this.px
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
    // A small tick above, in screen space, so "it" reads even where the ring crosses another mark.
    ctx.beginPath(); ctx.moveTo(x - r * .28, y - r - r * .34); ctx.lineTo(x, y - r - r * .08); ctx.lineTo(x + r * .28, y - r - r * .34); ctx.stroke()
    ctx.globalAlpha = 1
  }
  /**
   * A vehicle beyond the rim: a luminous tick on the ring pointing out toward it, with a
   * bright core, a soft glow and a trailing arc along the ring whose length and brightness
   * say how near it is. A faint dark under-halo keeps it legible over bright sky and ice.
   */
  private rimGlyph(ctx: CanvasRenderingContext2D, s: Slot, alpha: number, m: number): void {
    const person = s.kind === 'person', fade = Math.min(1, s.look.alpha * 1.6)
    const angle = Math.atan2(s.place.y, s.place.x), dx = Math.cos(angle), dy = Math.sin(angle)
    const base = Math.hypot(s.place.x, s.place.y), width = s.look.radius * .8
    const length = (person ? 15 : s.crowd ? 7 : 11) * m * (.5 + .5 * fade), tipX = dx * (base + length), tipY = dy * (base + length)
    const midX = dx * (base + length * .5), midY = dy * (base + length * .5)
    // Aura (under-halo and glow in one sprite), then the arc, then the tick.
    const aura = this.aura(s.color), ah = length * (person ? 1.3 : 1)
    ctx.globalAlpha = alpha; ctx.drawImage(aura, midX - ah, midY - ah, ah * 2, ah * 2)
    const span = (person ? .04 + .12 * fade : .02 + .06 * fade)
    ctx.globalAlpha = alpha * (person ? .85 : .6); ctx.strokeStyle = s.shades[5]; ctx.lineWidth = (person ? 2 : 1.3) * this.px
    // Just outside the ring's own line, so the paint is not lost under it.
    ctx.beginPath(); ctx.arc(0, 0, RIM_UNITS + 2.5 * this.px, angle - span, angle + span); ctx.stroke()
    ctx.globalAlpha = alpha; ctx.fillStyle = s.shades[person ? 5 : 4]
    ctx.beginPath(); ctx.moveTo(dx * base - dy * width, dy * base + dx * width); ctx.lineTo(tipX, tipY); ctx.lineTo(dx * base + dy * width, dy * base - dx * width); ctx.closePath(); ctx.fill()
    // A bright core: the contrast floor where the paint matches the sky (a red bot on the red
    // planet). A person's is brighter and longer than a bot's.
    {
      ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = alpha * (person ? 1 : .9); ctx.lineWidth = (person ? 1.3 : 1.1) * this.px
      // A bot in the nearest third of the fade gets a longer core: one more step of contrast where it matters.
      const reach = person ? .82 : .82 + .14 * Math.min(1, Math.max(0, (s.fade - 2 / 3) * 3))
      ctx.beginPath(); ctx.moveTo(dx * (base + length * .12), dy * (base + length * .12)); ctx.lineTo(dx * (base + length * reach), dy * (base + length * reach)); ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (s.it) this.itMark(ctx, midX, midY, length * .75 + 2 * m, alpha)
  }
  private drawMark(ctx: CanvasRenderingContext2D, s: Slot, m: number): void {
    const { x, y, blend } = s.place, inside = 1 - blend, outside = blend * s.look.alpha
    if (s.kind === 'zone') {
      // The hill: a place, not a vehicle. A faint disc with a fine ring in its state's colour.
      const r = (7 - 2 * blend) * m
      ctx.globalAlpha = .28; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1; ctx.strokeStyle = s.color; ctx.lineWidth = 1.5 * this.px; ctx.stroke(); return
    }
    if (s.kind === 'flare') {
      // A Plasma Thunder flare: a bright point with rings going out from it, in the shooter's
      // colour, fading over its life. Shown at the rim when it is off the map, like the hill.
      const phase = (performance.now() / 900) % 1, r = (3 + 7 * phase) * m
      ctx.globalAlpha = s.life; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y, 2.6 * m, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = s.life * (1 - phase); ctx.strokeStyle = s.color; ctx.lineWidth = 1.5 * this.px; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.globalAlpha = 1; return
    }
    const person = s.kind === 'person'
    if (inside > .01) {
      if (person) {
        // A subtle halo in the vehicle's own paint, where the ring used to be.
        const glow = this.glow(s.color), r = ARROW.person * 1.7 * m
        ctx.globalAlpha = inside * .45; ctx.drawImage(glow, x - r, y - r, r * 2, r * 2)
      }
      this.solid(ctx, person ? FORMS[Minimap.markStyle] : FORMS.bot, x, y, s.heading - this.turn, (person ? ARROW.person : ARROW.bot) * m, s.shades, s.accent, inside * (person ? 1 : .85), person ? 1 : .7)
      if (s.it) this.itMark(ctx, x, y, (person ? ARROW.person + 5 : ARROW.bot + 5) * m, inside)
    }
    if (outside > .01) this.rimGlyph(ctx, s, outside, m)
  }
  dispose(): void { this.unsubscribe?.(); this.resize?.disconnect(); this.unwatchRatio?.(); this.element.remove() }
}

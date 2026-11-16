/**
 * How the Grapple (code name Bungee) is drawn: a "light tether".
 *
 * - The cord is a thin bright filament inside a soft sheath. Beads of light run along it the
 *   way the pull goes, faster and brighter as tension rises, so a player can read the pull at
 *   a glance. A slack cord droops and shimmers. Each cord carries its own colour, cyan when
 *   slack running to warm gold under tension.
 * - A hook in flight is a small star with a short comet tail.
 * - A ground anchor is a ring that pulses once on attach, then settles into a slow glow. The
 *   far vehicle of a vehicle cord gets a small star at its hitch.
 * - The landing marker while aiming is a thin soft ring with a faint centre.
 *
 * Every cord in the game is one ribbon in one shared buffer and every star, tail and ring is
 * one instance of one quad, so all Grapples together cost two draws and two pipelines. The
 * filament, sheath, beads and ring shapes are computed per pixel; nothing is loaded
 * (AGENTS.md: generate it, do not ship it).
 *
 * Both materials blend with (One, OneMinusSrcAlpha): the alpha carries a deeper shade of the
 * cord's colour that tints what is behind it, as the old normally blended tint layer did, and
 * the colour adds the light on top. One draw then does what an additive layer over a tint
 * layer did, and stays readable over a bright sky where additive light alone washes out.
 * Outside the falloff both colour and alpha are zero, so a quad never shows as a square.
 *
 * A graphics level change moves uniforms and rewrites the index buffer; it compiles nothing.
 * The pipelines compile while the world appears (../warm.ts).
 */
import * as THREE from 'three/webgpu'
import { attribute, float, max, mix, sin, smoothstep, uniform, uv } from 'three/tsl'
import type { Game } from '../../core/Game'
import { graphicsLevel, levelNumber } from '../../core/quality'
import { hotExposureNode } from '../../vehicles/skins/hotExposure'
import { warmGear } from '../warm'
import { CORD_CLEARANCE, drapeCord, type CordSurface } from './drape'
import { MAX_BOTS } from '../../../shared/protocol'

// TSL nodes are dynamically typed; the effect sprites use the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** One cord for each of the default room's 16 players and every permitted bot. */
export const TETHER_CORDS = 16 + MAX_BOTS
/** Ribbon segments per cord at the mobile and desktop levels, and at level 0. */
export const TETHER_SEGMENTS = 24
const SEGMENTS_LOW = 12
/** Landing markers drawn at once: one per Bungee that aims with a cursor. */
const MARKERS = 4
/** Spark instances per cord: the hook's star, its tail and the anchor. */
const PER_CORD = 3
const POINTS = TETHER_SEGMENTS + 1
const CORD_VERTS = POINTS * 2

/** Ribbon width in metres (the sheath), and the same at level 0 where there is no sheath. */
const WIDTH = 0.62
const WIDTH_LOW = 0.26
/** The ribbon never gets thinner on screen than this many metres of width per metre away. */
const MIN_SCREEN = 0.03
/** Metres between beads, and a bead's half length. */
export const BEAD_SPACING = 2.6
const BEAD_HALF = 0.32
/** Sheath and tint fade in over this many metres at each end, so the ribbon has no cut edge. */
const END_FADE = 0.45
/** Deeper shade of the cord's own colour that tints what is behind it. */
const TINT = 0.14

/** Linear RGB at daytime exposure: slack is cool plasma cyan, taut runs warm gold. */
export const SLACK_RGB = [0.25, 1.4, 2.2] as const
export const TAUT_RGB = [3.2, 2.0, 0.55] as const

/** Spark shapes, as the shader reads them from the centre's w. */
const Kind = { Star: 0, Tail: 1, Ring: 2, Marker: 3 } as const
type Kind = (typeof Kind)[keyof typeof Kind]

/** Blending for both materials: colour adds light, alpha darkens toward the tint. */
function tintAndLight(m: THREE.MeshBasicNodeMaterial): void {
  m.transparent = true
  m.depthWrite = false
  m.blending = THREE.CustomBlending
  m.blendSrc = THREE.OneFactor
  m.blendDst = THREE.OneMinusSrcAlphaFactor
  m.blendSrcAlpha = THREE.OneFactor
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  m.side = THREE.DoubleSide
  // Fog would mix its colour into pixels the falloff leaves at zero, and show the quad.
  m.fog = false
}

/** Same layout as a real cord buffer, with `verts` vertices. */
function cordGeometry(verts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const dyn = (size: number) => new THREE.BufferAttribute(new Float32Array(verts * size), size).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('position', dyn(3))
  // s metres from the owner's end, metres to the far end, across (-1 to 1), tension 0 to 1.
  g.setAttribute('gtAlong', dyn(4))
  // Linear colour, and the bead phase in metres.
  g.setAttribute('gtColor', dyn(4))
  return g
}

function sparkGeometry(instances: number): THREE.InstancedBufferGeometry {
  const plane = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry().copy(plane as unknown as THREE.InstancedBufferGeometry)
  plane.dispose()
  const dyn = () => new THREE.InstancedBufferAttribute(new Float32Array(instances * 4), 4).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('gsCentre', dyn()) // centre, kind
  g.setAttribute('gsAxisU', dyn()) // half axis along the quad's x, brightness
  g.setAttribute('gsAxisV', dyn()) // half axis along y, pulse wave 0 to 1 (rings)
  g.setAttribute('gsColor', dyn()) // linear colour, tint strength
  g.instanceCount = instances
  return g
}

/**
 * Everything every Grapple in one game draws with. Shared through `sharedLook` (../warm.ts):
 * each Bungee takes a cord slot per cord and writes it every frame.
 */
export class TetherLook {
  readonly cord: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>
  readonly sparks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>
  private readonly clock: N = uniform(0)
  /** Sheath brightness: 0 at level 0. */
  private readonly sheath: N = uniform(1)
  /** Core half width as a fraction of the ribbon's half width. */
  private readonly core: N = uniform(0.16)
  private readonly pos: Float32Array
  private readonly along: Float32Array
  private readonly color: Float32Array
  private readonly sC: Float32Array
  private readonly sU: Float32Array
  private readonly sV: Float32Array
  private readonly sK: Float32Array
  private readonly cordUsed = new Array<boolean>(TETHER_CORDS).fill(false)
  private readonly markerUsed = new Array<boolean>(MARKERS).fill(false)
  private readonly markerShown = new Array<boolean>(MARKERS).fill(false)
  private cordTop = 0
  private level = -1
  /** Ribbon segments drawn per cord at this graphics level. */
  segments = TETHER_SEGMENTS
  /** Ribbon width at this level. */
  width = WIDTH
  /** False at level 0: no comet tails. */
  tails = true
  private readonly camRight = new THREE.Vector3()
  private readonly camUp = new THREE.Vector3()
  private readonly camPos = new THREE.Vector3()
  private readonly tan = new THREE.Vector3()
  private readonly view = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly edges = [Array.from({ length: POINTS }, () => new THREE.Vector3()), Array.from({ length: POINTS }, () => new THREE.Vector3())]
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly proxies: THREE.BufferGeometry[]
  private readonly unwarm: () => void

  constructor(private readonly game: Game) {
    const cordGeo = cordGeometry(TETHER_CORDS * CORD_VERTS)
    const index = new Uint16Array(TETHER_CORDS * TETHER_SEGMENTS * 6)
    cordGeo.setIndex(new THREE.BufferAttribute(index, 1))
    this.pos = cordGeo.getAttribute('position').array as Float32Array
    this.along = cordGeo.getAttribute('gtAlong').array as Float32Array
    this.color = cordGeo.getAttribute('gtColor').array as Float32Array
    cordGeo.setDrawRange(0, 0)

    const sparkGeo = sparkGeometry(MARKERS + TETHER_CORDS * PER_CORD)
    this.sC = sparkGeo.getAttribute('gsCentre').array as Float32Array
    this.sU = sparkGeo.getAttribute('gsAxisU').array as Float32Array
    this.sV = sparkGeo.getAttribute('gsAxisV').array as Float32Array
    this.sK = sparkGeo.getAttribute('gsColor').array as Float32Array
    sparkGeo.instanceCount = 0

    this.cord = new THREE.Mesh(cordGeo, this.cordMaterial())
    this.sparks = new THREE.Mesh(sparkGeo, this.sparkMaterial())
    for (const m of [this.cord, this.sparks]) { m.frustumCulled = false; m.visible = false }
    this.cord.renderOrder = 3
    this.sparks.renderOrder = 4
    game.scene.add(this.cord, this.sparks)
    this.retier()

    // Proxies with the same layout and nothing in them: all zero, so they cover no pixel.
    const cordProxy = cordGeometry(4)
    cordProxy.setIndex([0, 1, 2, 1, 3, 2])
    const sparkProxy = sparkGeometry(1)
    this.proxies = [cordProxy, sparkProxy]
    this.unwarm = warmGear(game, [[cordProxy, this.cord.material], [sparkProxy, this.sparks.material]])
  }

  private cordMaterial(): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ name: 'gear bungee tether' })
    tintAndLight(m)
    const along: N = attribute('gtAlong', 'vec4'), col: N = attribute('gtColor', 'vec4')
    const s = along.x, rest = along.y, across = along.z.abs(), tension = along.w
    const ends = smoothstep(0, END_FADE, s).mul(smoothstep(0, END_FADE, rest))
    // The filament: a tight bright line.
    const c = max(float(0), float(1).sub(across.div(this.core)))
    const filament = c.mul(c)
    // The sheath: a wide soft glow that shimmers while slack.
    const soft = float(1).sub(across)
    const shimmer = sin(s.mul(1.9).sub(this.clock.mul(2.6))).mul(0.5).add(0.5).mul(float(1).sub(tension)).mul(0.6).add(0.7)
    const sheath = soft.pow(3).mul(this.sheath).mul(ends).mul(shimmer).mul(0.32)
    // Beads: a short soft pulse every BEAD_SPACING metres, moving with the phase.
    const f = s.add(col.w).div(BEAD_SPACING).fract().sub(0.5).abs().mul(BEAD_SPACING).div(BEAD_HALF)
    const along1 = max(float(0), float(1).sub(f))
    const wide = max(float(0), float(1).sub(across.div(this.core.mul(2.6))))
    const bead = along1.mul(along1).mul(wide.mul(wide)).mul(mix(0.35, 2.4, tension)).mul(ends)
    const hot: N = hotExposureNode()
    const light = col.xyz.mul(filament.mul(0.9).add(sheath).add(bead))
    const tintA = soft.pow(2).mul(0.42).mul(ends).clamp(0, 1)
    m.colorNode = light.add(col.xyz.mul(TINT).mul(tintA)).mul(hot)
    m.opacityNode = tintA
    return m
  }

  private sparkMaterial(): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ name: 'gear bungee spark' })
    tintAndLight(m)
    const centre: N = attribute('gsCentre', 'vec4'), axisU: N = attribute('gsAxisU', 'vec4')
    const axisV: N = attribute('gsAxisV', 'vec4'), col: N = attribute('gsColor', 'vec4')
    // The plane runs -0.5 to 0.5; the axes are half extents.
    const q: N = attribute('position', 'vec3').mul(2)
    m.positionNode = centre.xyz.add(axisU.xyz.mul(q.x)).add(axisV.xyz.mul(q.y))
    const p: N = uv().mul(2).sub(1)
    const kind = centre.w, bright = axisU.w, wave = axisV.w
    const r = p.length()
    const inside = r.lessThan(1).select(1, 0)
    const s = max(float(0), float(1).sub(r))
    // Star: a soft glow with a hot heart and two faint flares.
    const flare = max(float(0), float(1).sub(p.y.abs().mul(16))).add(max(float(0), float(1).sub(p.x.abs().mul(16)))).mul(s.pow(3)).mul(0.5)
    const star = s.pow(3).mul(0.55).add(s.pow(14).mul(2.4)).add(flare)
    // Tail: brightest at the head (x = 1), thinning to nothing behind.
    const t = p.x.add(1).mul(0.5).clamp(0, 1)
    const across = max(float(0), float(1).sub(p.y.abs()))
    const tail = t.mul(t).mul(across.pow(3)).mul(float(1).sub(smoothstep(0.82, 1, p.x))).mul(0.9)
    // Ring: a crisp band with a soft halo, and one wave that runs outward on attach.
    const band = (radius: N, half: number) => { const d = max(float(0), float(1).sub(r.sub(radius).abs().div(half))); return d.mul(d) }
    const waveAt = mix(0.2, 1, wave)
    const pulse = band(waveAt, 0.09).mul(float(1).sub(wave)).mul(wave.greaterThan(0.001).select(1.6, 0))
    const ring = band(float(0.74), 0.07).add(band(float(0.74), 0.32).mul(0.3)).add(s.pow(2).mul(0.12)).add(pulse).mul(inside)
    // Landing marker: thinner, with a faint centre point.
    const marker = band(float(0.84), 0.05).add(band(float(0.84), 0.22).mul(0.22)).add(max(float(0), float(1).sub(r.div(0.1))).pow(2).mul(0.7)).mul(inside)
    const shape = kind.lessThan(0.5).select(star, kind.lessThan(1.5).select(tail, kind.lessThan(2.5).select(ring, marker)))
    const soft = kind.lessThan(0.5).select(s.pow(2), kind.lessThan(1.5).select(tail.mul(0.6), shape.clamp(0, 1).mul(0.55)))
    const tintA = soft.mul(col.w).clamp(0, 1)
    const hot: N = hotExposureNode()
    m.colorNode = col.xyz.mul(shape.mul(bright)).add(col.xyz.mul(TINT).mul(tintA)).mul(hot)
    m.opacityNode = tintA
    return m
  }

  // --- cords ---------------------------------------------------------------------------

  /** A cord slot, or -1 when all are taken: that cord pulls unseen. */
  takeCord(): number {
    const slot = this.cordUsed.indexOf(false)
    if (slot < 0) return -1
    this.cordUsed[slot] = true
    this.cordTop = Math.max(this.cordTop, slot + 1)
    this.hideCord(slot)
    return slot
  }

  freeCord(slot: number): void {
    if (slot < 0 || !this.cordUsed[slot]) return
    this.hideCord(slot)
    this.cordUsed[slot] = false
    this.cordTop = this.cordUsed.lastIndexOf(true) + 1
    this.flush()
  }

  /** Draw nothing for this cord this frame: its ribbon and sparks collapse to a point. */
  hideCord(slot: number): void {
    if (slot < 0) return
    this.pos.fill(0, slot * CORD_VERTS * 3, (slot + 1) * CORD_VERTS * 3)
    for (let k = 0; k < PER_CORD; k++) this.hideSpark(MARKERS + slot * PER_CORD + k)
  }

  /**
   * Write one cord's ribbon through `points` (this.segments + 1 of them, owner's end first).
   * `tension` is 0 to 1, `phase` is the bead offset in metres, `rgb` its linear colour.
   */
  writeCord(slot: number, points: readonly THREE.Vector3[], tension: number, phase: number, rgb: readonly number[], surface?: CordSurface): void {
    if (slot < 0) return
    const n = this.segments
    let total = 0
    for (let i = 1; i <= n; i++) total += points[i].distanceTo(points[i - 1])
    let s = 0
    const base = slot * CORD_VERTS
    for (let i = 0; i <= n; i++) {
      const p = points[i]
      if (i > 0) s += p.distanceTo(points[i - 1])
      this.tan.subVectors(points[Math.min(n, i + 1)], points[Math.max(0, i - 1)])
      this.view.subVectors(this.camPos, p)
      const w = Math.max(this.width, this.view.length() * this.width * MIN_SCREEN)
      this.side.crossVectors(this.tan, this.view)
      const len = this.side.length()
      if (len > 1e-8) this.side.multiplyScalar(w / 2 / len)
      else this.side.set(w / 2, 0, 0)
      // Preserve full width when airborne and clear. At surface contact (including
      // a wide ribbon whose edge would hit the ground), taper this endpoint to its
      // unchanged centre BEFORE edge draping. The adjoining triangles provide the
      // width ramp without new vertices. A buried centre skips this taper; the
      // edge drape still applies its visual fallback, not exact attachment.
      if (surface && (i === 0 || i === n) && p.y >= surface.heightAt(p.x, p.z)) {
        const leftGap = p.y - this.side.y - surface.heightAt(p.x - this.side.x, p.z - this.side.z)
        const rightGap = p.y + this.side.y - surface.heightAt(p.x + this.side.x, p.z + this.side.z)
        if (Math.min(leftGap, rightGap) <= CORD_CLEARANCE) this.side.set(0, 0, 0)
      }
      for (let k = 0; k < 2; k++) {
        const v = base + i * 2 + k, sign = k ? 1 : -1
        this.edges[k][i].set(p.x + this.side.x * sign, p.y + this.side.y * sign, p.z + this.side.z * sign)
        this.pos[v * 3] = p.x + this.side.x * sign
        this.pos[v * 3 + 1] = p.y + this.side.y * sign
        this.pos[v * 3 + 2] = p.z + this.side.z * sign
        this.along[v * 4] = s; this.along[v * 4 + 1] = total - s; this.along[v * 4 + 2] = sign; this.along[v * 4 + 3] = tension
        this.color[v * 4] = rgb[0]; this.color[v * 4 + 1] = rgb[1]; this.color[v * 4 + 2] = rgb[2]; this.color[v * 4 + 3] = phase
      }
    }
    if (surface) {
      for (let k = 0; k < 2; k++) {
        // False means visual-clearance fallback, not untouched geometry. Keep
        // writing it: physical anchors stay fixed and attachment is not certified.
        drapeCord(this.edges[k], n + 1, surface)
        for (let i = 0; i <= n; i++) {
          const p = this.edges[k][i], v = (base + i * 2 + k) * 3
          this.pos[v] = p.x; this.pos[v + 1] = p.y; this.pos[v + 2] = p.z
        }
      }
    }
  }

  // --- sparks --------------------------------------------------------------------------

  /** Spark index of a cord's star (0), tail (1) or anchor (2). */
  cordSpark(slot: number, k: 0 | 1 | 2): number {
    return slot < 0 ? -1 : MARKERS + slot * PER_CORD + k
  }

  takeMarker(): number {
    const i = this.markerUsed.indexOf(false)
    if (i >= 0) this.markerUsed[i] = true
    return i
  }

  freeMarker(i: number): void {
    if (i < 0) return
    this.markerUsed[i] = false
    this.showMarker(i, false)
  }

  /** Hide a marker, or note that it is shown; write it with `ring`. */
  showMarker(i: number, shown: boolean): void {
    if (i < 0) return
    this.markerShown[i] = shown
    if (!shown) this.hideSpark(i)
  }

  hideSpark(i: number): void {
    if (i < 0) return
    this.sU.fill(0, i * 4, i * 4 + 4)
    this.sV.fill(0, i * 4, i * 4 + 4)
  }

  /** A camera facing star of radius `size`. */
  star(i: number, at: THREE.Vector3, size: number, rgb: readonly number[], bright: number, tint: number): void {
    if (i < 0) return
    this.spark(i, at, Kind.Star, this.t1.copy(this.camRight).multiplyScalar(size), this.t2.copy(this.camUp).multiplyScalar(size), bright, 0, rgb, tint)
  }

  /** A streak from `head` back along -`dir` (unit) for `length` metres, `width` wide. */
  tail(i: number, head: THREE.Vector3, dir: THREE.Vector3, length: number, width: number, rgb: readonly number[], bright: number): void {
    if (i < 0) return
    if (!this.tails || length < 0.05) { this.hideSpark(i); return }
    const c = this.view.copy(head).addScaledVector(dir, -length / 2)
    this.t1.copy(dir).multiplyScalar(length / 2)
    this.side.subVectors(this.camPos, c)
    this.t2.crossVectors(dir, this.side)
    const l = this.t2.length()
    if (l < 1e-6) { this.hideSpark(i); return }
    this.t2.multiplyScalar(width / 2 / l)
    this.spark(i, c, Kind.Tail, this.t1, this.t2, bright, 0, rgb, 0.5)
  }

  /** A ring of `radius` lying on the surface with this unit normal. */
  ring(i: number, at: THREE.Vector3, normal: THREE.Vector3, radius: number, rgb: readonly number[], bright: number, wave: number, marker = false): void {
    if (i < 0) return
    // Any tangent: cross with whichever axis is least parallel.
    this.t1.set(Math.abs(normal.y) < 0.9 ? 0 : 1, Math.abs(normal.y) < 0.9 ? 1 : 0, 0).cross(normal).normalize()
    this.t2.crossVectors(normal, this.t1)
    this.t1.multiplyScalar(radius); this.t2.multiplyScalar(radius)
    this.spark(i, at, marker ? Kind.Marker : Kind.Ring, this.t1, this.t2, bright, wave, rgb, marker ? 0.5 : 0.7)
  }

  private spark(i: number, at: THREE.Vector3, kind: Kind, u: THREE.Vector3, v: THREE.Vector3, bright: number, wave: number, rgb: readonly number[], tint: number): void {
    const d = i * 4
    this.sC[d] = at.x; this.sC[d + 1] = at.y; this.sC[d + 2] = at.z; this.sC[d + 3] = kind
    this.sU[d] = u.x; this.sU[d + 1] = u.y; this.sU[d + 2] = u.z; this.sU[d + 3] = bright
    this.sV[d] = v.x; this.sV[d + 1] = v.y; this.sV[d + 2] = v.z; this.sV[d + 3] = wave
    this.sK[d] = rgb[0]; this.sK[d + 1] = rgb[1]; this.sK[d + 2] = rgb[2]; this.sK[d + 3] = tint
  }

  // --- frame ---------------------------------------------------------------------------

  /** Before writing this frame: the camera, the clock and the graphics level. */
  begin(camera: THREE.Camera, time: number): THREE.Vector3 {
    if (this.level !== levelNumber(graphicsLevel.value)) this.retier()
    this.clock.value = time
    camera.updateMatrixWorld()
    const e = camera.matrixWorld.elements
    this.camRight.set(e[0], e[1], e[2]).normalize()
    this.camUp.set(e[4], e[5], e[6]).normalize()
    this.camPos.set(e[12], e[13], e[14])
    return this.camPos
  }

  /** After writing: upload what is in use. Cheap to call more than once a frame. */
  flush(): void {
    const top = this.cordTop
    const g = this.cord.geometry
    g.setDrawRange(0, top * this.segments * 6)
    this.cord.visible = top > 0
    for (const [name, size] of [['position', 3], ['gtAlong', 4], ['gtColor', 4]] as const) {
      const a = g.getAttribute(name) as THREE.BufferAttribute
      a.clearUpdateRanges()
      if (top > 0) { a.addUpdateRange(0, top * CORD_VERTS * size); a.needsUpdate = true }
    }
    const markers = this.markerShown.some(Boolean)
    const sparks = top > 0 || markers ? MARKERS + top * PER_CORD : 0
    this.sparks.geometry.instanceCount = sparks
    this.sparks.visible = sparks > 0
    for (const name of ['gsCentre', 'gsAxisU', 'gsAxisV', 'gsColor']) {
      const a = this.sparks.geometry.getAttribute(name) as THREE.InstancedBufferAttribute
      a.clearUpdateRanges()
      if (sparks > 0) { a.addUpdateRange(0, sparks * 4); a.needsUpdate = true }
    }
  }

  dispose(): void {
    this.unwarm()
    for (const g of this.proxies) g.dispose()
    for (const m of [this.cord, this.sparks]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose() }
  }

  /** Segments, width, sheath and tails for this graphics level. */
  private retier(): void {
    this.level = levelNumber(graphicsLevel.value)
    const low = this.level === 0
    this.segments = low ? SEGMENTS_LOW : TETHER_SEGMENTS
    this.width = low ? WIDTH_LOW : WIDTH
    this.tails = !low
    this.sheath.value = low ? 0 : 1
    // The filament keeps about the same width in metres whatever the ribbon's width.
    this.core.value = Math.min(0.6, (0.05 / this.width) * 2)
    const index = this.cord.geometry.getIndex()!
    const a = index.array as Uint16Array
    let k = 0
    for (let c = 0; c < TETHER_CORDS; c++) {
      for (let i = 0; i < this.segments; i++) {
        const v = c * CORD_VERTS + i * 2
        a[k++] = v; a[k++] = v + 1; a[k++] = v + 2; a[k++] = v + 1; a[k++] = v + 3; a[k++] = v + 2
      }
    }
    index.needsUpdate = true
    // Collapse any cord drawn with the other segment count until it is written again.
    for (let c = 0; c < TETHER_CORDS; c++) if (this.cordUsed[c]) this.pos.fill(0, c * CORD_VERTS * 3, (c + 1) * CORD_VERTS * 3)
    this.flush()
  }
}

/** Linear colour for a glow of 0 (slack) to 1 (taut), into `out`. */
export function tetherColor(glow: number, out: number[]): number[] {
  const g = Math.min(1, Math.max(0, glow))
  for (let i = 0; i < 3; i++) out[i] = SLACK_RGB[i] + (TAUT_RGB[i] - SLACK_RGB[i]) * g
  return out
}

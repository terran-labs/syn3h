/**
 * Tracks through the grass: where wheels, treads and a rolling Zorb have pushed plants over.
 *
 * Unlike a hovercraft's downwash (the fluttering benders in groundcover.ts), something that
 * touches the ground pushes plants aside and down as it passes, leaves them lying in its
 * track, and they stand back up slowly over a few seconds without wobbling. That needs a
 * memory of where it has been, so this is a small map of the ground round the camera: one
 * cell every SWISH_CELL metres, SWISH_N across, holding how bent each cell is and which way.
 *
 * Each cell's bend is set to full where a vehicle's footprint covers it, held for HOLD
 * seconds, then falls linearly to nothing over `cover.swishRise` seconds (4 by default). The shader eases
 * that with a smoothstep, so a plant starts rising gently, never moves faster than about
 * 1.5 times the average rate, and settles into the wind with zero speed: no overshoot, no pop.
 *
 * The map is addressed by world position modulo its size (the texture repeats), so it never
 * scrolls: when the camera moves, only the rows and columns that come into the window are
 * cleared. All of it is a few thousand byte writes a frame while anything is bent, and
 * nothing at all once everything has stood back up.
 */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../../shared/params'

/** Cells across the map, and metres per cell: 48 m square, the camera at its centre. */
export const SWISH_N = 96
export const SWISH_CELL = 0.5
/** Seconds a track stays fully bent before it starts to rise. */
const HOLD = 0.5

export const coverSwishRise = defineParam({ id: 'cover.swishRise', label: 'Grass rises back after wheels, seconds', group: 'Graphics', scope: 'client', default: 4, min: 0.5, max: 10, step: 0.1 })
/** 1 lays plants in a track over by 80 degrees; the shader caps the lean just short of flat. */
export const coverSwishBend = defineParam({ id: 'cover.swishBend', label: 'How far wheels lay the grass over', group: 'Graphics', scope: 'client', default: 1, min: 0, max: 1.1, step: 0.05 })

/** A vehicle touching the ground this frame: a capsule along its heading, and where it was last frame. */
export interface Footprint {
  x: number; z: number
  /** Where the footprint's centre was last frame; the same as x, z when new or still. */
  px: number; pz: number
  /** Its heading on the ground, a unit vector. */
  fx: number; fz: number
  /** Half its length along the heading (centre to nose) and half its width. */
  halfLength: number; halfWidth: number
  /** How firmly it touches, 0..1. */
  w: number
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const mod = (a: number, n: number): number => ((a % n) + n) % n

export class SwishField {
  /** RGBA: the push direction (x, z) as signed bytes about 128, and the bend scaled to 0..255. */
  readonly data = new Uint8Array(SWISH_N * SWISH_N * 4)
  readonly texture = new THREE.DataTexture(this.data, SWISH_N, SWISH_N, THREE.RGBAFormat, THREE.UnsignedByteType)
  /** Bend per cell: 1 + HOLD / rise when just pressed, falling to 0. Kept in floats so slow decay is exact. */
  private readonly bend = new Float32Array(SWISH_N * SWISH_N)
  /** The bend a byte of 255 stands for: the shader multiplies back by this. */
  top = 1
  /** World cell at the window's low corner, in cells. */
  private ox = NaN
  private oz = NaN
  /** Whether any cell is bent: when not, update does nothing but follow the camera. */
  private active = false

  constructor() {
    const t = this.texture
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.magFilter = t.minFilter = THREE.LinearFilter
    t.generateMipmaps = false
    this.clearAll()
    t.needsUpdate = true
  }

  /** The window's centre in world metres, for the shader's edge fade. */
  readonly centre = new THREE.Vector2()

  private clearCell(i: number): void {
    this.bend[i] = 0
    const d = this.data, k = i * 4
    d[k] = 128; d[k + 1] = 128; d[k + 2] = 0; d[k + 3] = 255
  }
  private clearAll(): void { for (let i = 0; i < SWISH_N * SWISH_N; i++) this.clearCell(i) }

  /** The bend at a world point, 0..1 as the shader sees it before easing. For tests. */
  bendAt(x: number, z: number): number {
    const i = mod(Math.floor(z / SWISH_CELL), SWISH_N) * SWISH_N + mod(Math.floor(x / SWISH_CELL), SWISH_N)
    return Math.min(1, this.bend[i])
  }
  /** The push direction stored at a world point, decoded. For tests. */
  pushAt(x: number, z: number): { x: number; z: number } {
    const i = mod(Math.floor(z / SWISH_CELL), SWISH_N) * SWISH_N + mod(Math.floor(x / SWISH_CELL), SWISH_N)
    return { x: (this.data[i * 4] - 128) / 127, z: (this.data[i * 4 + 1] - 128) / 127 }
  }

  /** Follow the camera, let bent cells rise, then press the footprints in. */
  update(dt: number, camX: number, camZ: number, prints: readonly Footprint[], count: number, rise: number): void {
    this.follow(camX, camZ)
    const top = 1 + HOLD / Math.max(0.1, rise)
    let changed = false
    if (this.active && dt > 0) {
      const fall = dt / Math.max(0.1, rise), b = this.bend, d = this.data
      let any = false
      for (let i = 0; i < b.length; i++) {
        if (b[i] <= 0) continue
        const v = Math.max(0, b[i] - fall)
        b[i] = v
        d[i * 4 + 2] = Math.round(Math.min(v, top) / top * 255)
        if (v > 0) any = true
      }
      this.active = any; changed = true
    }
    for (let i = 0; i < count; i++) if (prints[i].w > 0 && this.stamp(prints[i], top, dt)) changed = true
    this.top = top
    if (changed) this.texture.needsUpdate = true
  }

  /** Move the window so the camera is at its centre, clearing the rows and columns it takes on. */
  private follow(camX: number, camZ: number): void {
    const half = SWISH_N / 2
    const ox = Math.floor(camX / SWISH_CELL) - half, oz = Math.floor(camZ / SWISH_CELL) - half
    this.centre.set((ox + half) * SWISH_CELL, (oz + half) * SWISH_CELL)
    if (ox === this.ox && oz === this.oz) return
    const dx = ox - this.ox, dz = oz - this.oz
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.abs(dx) >= SWISH_N || Math.abs(dz) >= SWISH_N) {
      this.clearAll()
    } else {
      // The cells entering on the leading edge share their indices with those leaving behind.
      for (let k = 0; k < Math.abs(dx); k++) {
        const col = mod(dx > 0 ? this.ox + SWISH_N + k : ox + k, SWISH_N)
        for (let r = 0; r < SWISH_N; r++) this.clearCell(r * SWISH_N + col)
      }
      for (let k = 0; k < Math.abs(dz); k++) {
        const row = mod(dz > 0 ? this.oz + SWISH_N + k : oz + k, SWISH_N)
        for (let c = 0; c < SWISH_N; c++) this.clearCell(row * SWISH_N + c)
      }
    }
    this.ox = ox; this.oz = oz
    this.texture.needsUpdate = true
  }

  /**
   * Press one footprint in, swept from where it was last frame to where it is now, so a
   * fast vehicle leaves a continuous track. Plants are pushed along the way it travels and
   * out to the sides, more to the side the nearer the footprint's edge they stand.
   */
  private stamp(p: Footprint, top: number, dt: number): boolean {
    const mx = p.x - p.px, mz = p.z - p.pz, moved = Math.hypot(mx, mz)
    // Teleports and respawns are not drives: press only where it is now. Anything a vehicle
    // could cover in the frame (80 m/s, plus slack) is a drive, however slow the frame.
    const sweep = moved < 2 + 80 * Math.max(dt, 1 / 60)
    const tx = sweep && moved > 1e-3 ? mx / moved : 0, tz = sweep && moved > 1e-3 ? mz / moved : 0
    const steps = sweep ? Math.min(128, Math.max(1, Math.ceil(moved / SWISH_CELL))) : 1
    const r = p.halfWidth, reach = Math.max(0, p.halfLength - r)
    let hit = false
    for (let s = 1; s <= steps; s++) {
      const f = s / steps, cx = sweep ? p.px + mx * f : p.x, cz = sweep ? p.pz + mz * f : p.z
      // The capsule's spine runs from tail to nose.
      const ax = cx - p.fx * reach, az = cz - p.fz * reach, bx = cx + p.fx * reach, bz = cz + p.fz * reach
      const lo = { x: Math.min(ax, bx) - r, z: Math.min(az, bz) - r }, hi = { x: Math.max(ax, bx) + r, z: Math.max(az, bz) + r }
      const i0 = Math.max(Math.floor(lo.x / SWISH_CELL), this.ox), i1 = Math.min(Math.floor(hi.x / SWISH_CELL), this.ox + SWISH_N - 1)
      const j0 = Math.max(Math.floor(lo.z / SWISH_CELL), this.oz), j1 = Math.min(Math.floor(hi.z / SWISH_CELL), this.oz + SWISH_N - 1)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * SWISH_CELL, z = (j + 0.5) * SWISH_CELL
        // Nearest point on the spine.
        const sx = bx - ax, sz = bz - az, len2 = sx * sx + sz * sz
        const u = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / len2)) : 0
        const lx = x - (ax + sx * u), lz = z - (az + sz * u), d = Math.hypot(lx, lz)
        const a = smooth(r, r * 0.5, d) * p.w
        if (a <= 0) continue
        const k = mod(j, SWISH_N) * SWISH_N + mod(i, SWISH_N), want = a * top
        if (want <= this.bend[k]) continue
        this.bend[k] = want
        // Along the travel under the body, out to the side toward its edge: only the offset
        // across the heading counts, so plants at the nose and tail are not pushed back.
        const across = lx * -p.fz + lz * p.fx, ax2 = -p.fz * across, az2 = p.fx * across, out = Math.min(1, Math.abs(across) / r)
        const side = Math.abs(across) > 1e-3 ? out / Math.abs(across) : 0
        let px = tx * 0.75 * (1 - 0.5 * out) + ax2 * side, pz = tz * 0.75 * (1 - 0.5 * out) + az2 * side
        const n = Math.hypot(px, pz)
        if (n > 1) { px /= n; pz /= n }
        const e = this.data, o = k * 4
        e[o] = Math.round(128 + px * 127); e[o + 1] = Math.round(128 + pz * 127)
        e[o + 2] = Math.round(Math.min(want, top) / top * 255)
        hit = true
      }
    }
    if (hit) this.active = true
    return hit
  }

  dispose(): void { this.texture.dispose() }
}

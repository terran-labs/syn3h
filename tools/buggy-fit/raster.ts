/**
 * A small software renderer for comparison images and silhouettes: orthographic views, a
 * depth buffer that keeps the triangle and surface point under each pixel, flat lit shading,
 * a 3 by 5 pixel font for labels and a PNG writer on node:zlib.
 */
import { deflateSync } from 'node:zlib'
import { faceNormal, triangleCount } from './geometry'
import type { Mesh } from './reference'

type V3 = [number, number, number]
export interface View { name: string; dir: V3; up: V3 }

const norm = (v: number[]): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * The six axis views and two three quarter views. `dir` points from the part to the camera,
 * in the game frame (-Z forward), so `front` looks at the nose.
 */
export const VIEWS: View[] = [
  { name: 'front', dir: [0, 0, -1], up: [0, 1, 0] },
  { name: 'back', dir: [0, 0, 1], up: [0, 1, 0] },
  { name: 'left', dir: [-1, 0, 0], up: [0, 1, 0] },
  { name: 'right', dir: [1, 0, 0], up: [0, 1, 0] },
  { name: 'top', dir: [0, 1, 0], up: [0, 0, -1] },
  { name: 'bottom', dir: [0, -1, 0], up: [0, 0, -1] },
  { name: 'front three quarter', dir: norm([-1, .7, -1.2]), up: [0, 1, 0] },
  { name: 'rear three quarter', dir: norm([1, .7, 1.2]), up: [0, 1, 0] },
]

/** Screen basis and a fit of the given meshes' bounds into a w by h image. */
export interface Camera { right: V3; up: V3; dir: V3; cx: number; cy: number; scale: number; w: number; h: number }
export function frame(view: View, meshes: Mesh[], w: number, h: number, margin = .06): Camera {
  const dir = norm(view.dir), right = norm(cross(view.up, dir)), up = cross(dir, right)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    const p = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]
    const x = dot(p, right), y = dot(p, up)
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  const scale = Math.min(w * (1 - 2 * margin) / Math.max(x1 - x0, 1e-6), h * (1 - 2 * margin) / Math.max(y1 - y0, 1e-6))
  return { right, up, dir, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale, w, h }
}

export interface Raster {
  w: number; h: number
  /** Distance toward the camera; -Infinity where empty. */
  depth: Float32Array
  /** Triangle under each pixel, or -1. */
  tri: Int32Array
  /** Surface point under each pixel (x, y, z). */
  world: Float32Array
}

/** Depth buffered rasterisation with pixel centre sampling. */
export function rasterise(m: Mesh, cam: Camera): Raster {
  const { w, h } = cam
  const r: Raster = { w, h, depth: new Float32Array(w * h).fill(-Infinity), tri: new Int32Array(w * h).fill(-1), world: new Float32Array(w * h * 3) }
  const sx = new Float64Array(3), sy = new Float64Array(3), sz = new Float64Array(3), wp = new Float64Array(9)
  for (let t = 0; t < triangleCount(m); t++) {
    for (let k = 0; k < 3; k++) {
      const i = m.indices[t * 3 + k] * 3, p = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]
      wp[k * 3] = p[0]; wp[k * 3 + 1] = p[1]; wp[k * 3 + 2] = p[2]
      sx[k] = (dot(p, cam.right) - cam.cx) * cam.scale + w / 2
      sy[k] = h / 2 - (dot(p, cam.up) - cam.cy) * cam.scale
      sz[k] = dot(p, cam.dir)
    }
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
    if (Math.abs(area) < 1e-12) continue
    const xa = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))), xb = Math.min(w - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])))
    const ya = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))), yb = Math.min(h - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])))
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const px = x + .5, py = y + .5
      const b0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area
      const b1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area
      const b2 = 1 - b0 - b1
      if (b0 < 0 || b1 < 0 || b2 < 0) continue
      const z = b0 * sz[0] + b1 * sz[1] + b2 * sz[2], i = y * w + x
      if (z <= r.depth[i]) continue
      r.depth[i] = z; r.tri[i] = t
      for (let k = 0; k < 3; k++) r.world[i * 3 + k] = b0 * wp[k] + b1 * wp[3 + k] + b2 * wp[6 + k]
    }
  }
  return r
}

/** Intersection over union of two rasters' coverage. */
export function silhouetteIoU(a: Raster, b: Raster): number {
  let both = 0, either = 0
  for (let i = 0; i < a.tri.length; i++) {
    const p = a.tri[i] >= 0, q = b.tri[i] >= 0
    if (p && q) both++
    if (p || q) either++
  }
  return either ? both / either : 1
}

/** An RGB image. */
export class Image {
  readonly data: Uint8Array
  constructor(readonly w: number, readonly h: number, bg: V3 = [24, 26, 30]) {
    this.data = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 3)
  }
  set(x: number, y: number, c: number[]): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 3
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]
  }
  blit(src: Image, ox: number, oy: number): void {
    for (let y = 0; y < src.h; y++) this.data.set(src.data.subarray(y * src.w * 3, (y + 1) * src.w * 3), ((oy + y) * this.w + ox) * 3)
  }
  rect(x: number, y: number, w: number, h: number, c: number[]): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
  }
  text(s: string, x: number, y: number, size = 3, c: number[] = [235, 235, 235]): void {
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch] ?? FONT[' ']
      for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r * 3 + k] === '1') this.rect(x + k * size, y + r * size, size, size, c)
      x += 4 * size
    }
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h)
    for (let y = 0; y < this.h; y++) raw.set(this.data.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * (this.w * 3 + 1) + 1)
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1')
      const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
      return Buffer.concat([head, body, tail])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr[8] = 8; ihdr[9] = 2
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  }
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/**
 * Flat lit shading of a raster: a key light from above the camera's left plus ambient. Faces
 * seen from behind (wrong winding, or an open shell seen inside) are tinted magenta.
 */
export function shade(r: Raster, m: Mesh, cam: Camera, base: V3 = [190, 196, 204]): Image {
  const img = new Image(r.w, r.h)
  const key = norm([cam.dir[0] - cam.right[0] * .5 + cam.up[0] * .8, cam.dir[1] - cam.right[1] * .5 + cam.up[1] * .8, cam.dir[2] - cam.right[2] * .5 + cam.up[2] * .8])
  const normals = new Map<number, ReturnType<typeof faceNormal>['n']>()
  for (let i = 0; i < r.tri.length; i++) {
    const t = r.tri[i]
    if (t < 0) continue
    let n = normals.get(t)
    if (!n) { n = faceNormal(m, t).n; normals.set(t, n) }
    const facing = dot(n, cam.dir) >= 0
    const nn = facing ? n : [-n[0], -n[1], -n[2]]
    const light = .28 + .62 * Math.max(0, dot(nn, key)) + .12 * Math.max(0, dot(nn, cam.dir))
    const c = facing ? base : [200, 80, 200]
    img.set(i % r.w, Math.floor(i / r.w), c.map(v => Math.min(255, Math.round(v * light))))
  }
  return img
}

/** Green (on the reference) through yellow to red (at `cap` or beyond). */
export function heatColour(f: number): V3 {
  f = Math.max(0, Math.min(1, f))
  return f < .5 ? [Math.round(60 + 390 * f), 200, 70] : [255, Math.round(200 - 340 * (f - .5)), Math.round(70 - 100 * (f - .5))]
}

/** 3 by 5 glyphs, rows top to bottom. */
const FONT: Record<string, string> = Object.fromEntries(Object.entries({
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '.': '000000000000010', '-': '000000111000000', '%': '101001010100101', ':': '000010000010000',
  '/': '001001010100100', '=': '000111000111000', '(': '010100100100010', ')': '010001001001010', ',': '000000000010100', ' ': '000000000000000',
}))

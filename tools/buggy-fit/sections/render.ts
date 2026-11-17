/**
 * Tiny software renderer for the section fit: orthographic views of triangle soups with a
 * z-buffer and simple lighting, written as PNG with node:zlib. Offline only.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

export interface Soup { tri: Float32Array; rgb: (t: number) => [number, number, number] }
type View = { name: string; yaw: number; pitch: number }
export const VIEWS: View[] = [
  { name: 'side', yaw: -Math.PI / 2, pitch: 0 },
  { name: 'top', yaw: 0, pitch: -Math.PI / 2 },
  { name: 'front', yaw: 0, pitch: 0 },
  { name: 'rear', yaw: Math.PI, pitch: 0 },
  { name: 'three-quarter', yaw: Math.PI * .75 - Math.PI, pitch: -.45 },
  { name: 'rear-quarter', yaw: Math.PI * .25, pitch: -.35 },
]

/** Render a soup into an RGB buffer of size W x H, view looks along -viewZ after rotation. */
function draw(s: Soup, v: View, W: number, H: number, scale: number, img: Uint8Array, ox: number, stride: number): Float32Array {
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch)
  // camera basis: rotate world by yaw about Y then pitch about X; camera looks toward -Z in camera space (from +Z)
  const tf = (x: number, y: number, z: number) => {
    // yaw: camera placed at angle; view front (yaw 0) looks from -Z toward +Z, i.e. we see the nose.
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1
    return [-x1, y2 - .45, z2]
  }
  const zb = new Float32Array(W * H).fill(1e9)
  const L = [.4, .8, -.45]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll
  const n = s.tri.length / 9
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const A = tf(s.tri[o], s.tri[o + 1], s.tri[o + 2]), B = tf(s.tri[o + 3], s.tri[o + 4], s.tri[o + 5]), C = tf(s.tri[o + 6], s.tri[o + 7], s.tri[o + 8])
    // world normal for lighting
    const ux = s.tri[o + 3] - s.tri[o], uy = s.tri[o + 4] - s.tri[o + 1], uz = s.tri[o + 5] - s.tri[o + 2]
    const vx = s.tri[o + 6] - s.tri[o], vy = s.tri[o + 7] - s.tri[o + 1], vz = s.tri[o + 8] - s.tri[o + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl
    const lit = .35 + .65 * Math.abs(nx * L[0] + ny * L[1] + nz * L[2])
    const [r, g, b] = s.rgb(t)
    const P = [A, B, C].map(p => [W / 2 + p[0] * scale, H / 2 - p[1] * scale, p[2]])
    const minx = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])))
    const miny = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])))
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])
    if (Math.abs(area) < 1e-9) continue
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + .5, py = y + .5
      const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area
      const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2]
      if (z >= zb[y * W + x]) continue
      zb[y * W + x] = z
      const i = (y * stride + ox + x) * 3
      img[i] = Math.min(255, r * lit); img[i + 1] = Math.min(255, g * lit); img[i + 2] = Math.min(255, b * lit)
    }
  }
  return zb
}

/** Coverage mask of a soup in a view, size x size pixels, 1 where something is drawn. */
export function mask(tri: Float32Array, v: View, size: number): Uint8Array {
  const zb = draw({ tri, rgb: () => [255, 255, 255] }, v, size, size, size / 4.6, new Uint8Array(size * size * 3), 0, size)
  return Uint8Array.from(zb, z => z < 1e9 ? 1 : 0)
}

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1) }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Each soup gets a block of views, three across and two down; blocks stack vertically. */
export function sheet(file: string, soups: Soup[], views = VIEWS, cell = 300) {
  const cols = 3, rows = Math.ceil(views.length / cols), W = cell * cols, H = cell * rows * soups.length, img = new Uint8Array(W * H * 3).fill(40)
  soups.forEach((s, b) => views.forEach((v, n) => {
    const tile = new Uint8Array(cell * cell * 3), X = (n % cols) * cell, Y = (b * rows + Math.floor(n / cols)) * cell
    draw(s, v, cell, cell, cell / 4.4, tile, 0, cell)
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) for (let k = 0; k < 3; k++) {
      const val = tile[(y * cell + x) * 3 + k]; img[((Y + y) * W + X + x) * 3 + k] = val || (x === 0 || y === 0 ? (n === 0 && y === 0 ? 160 : 90) : 40)
    }
  }))
  writeFileSync(file, png(W, H, img))
}
export const MAT_RGB: Record<string, [number, number, number]> = {
  paint: [200, 60, 50], accent: [240, 200, 60], chrome: [190, 200, 215], lamp: [255, 255, 230], trim: [70, 70, 70], frame: [50, 55, 65], tail: [255, 40, 40],
}

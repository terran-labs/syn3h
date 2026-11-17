// Throwaway software renderer: orthographic views coloured by role, written as PNG. Not shipped.
import {deflateSync, crc32} from 'node:zlib'
import {writeFileSync} from 'node:fs'
import type {TriMesh} from './geom'

const COLOURS = [[60, 120, 200], [230, 160, 40], [200, 200, 210], [250, 250, 190], [220, 30, 30], [50, 50, 55]]

/** Rotation that looks along a direction: yaw about Y then pitch about X. */
function view(yaw: number, pitch: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  return (p: number[]) => { const x = cy * p[0] + sy * p[2], z = -sy * p[0] + cy * p[2]; return [x, cp * p[1] - sp * z, sp * p[1] + cp * z] }
}

export const VIEWS = [view(Math.PI / 2, 0), view(0, 0), view(0, Math.PI / 2), view(Math.PI * .75, .45), view(-Math.PI * .25, .35)]

function draw(m: TriMesh, rot: (p: number[]) => number[], img: Uint8Array, W: number, ox: number, oy: number, w: number, h: number, scale: number, wire: boolean, normals?: Float32Array, centre: number[] = [0, 0, 0]) {
  const zb = new Float32Array(w * h).fill(-Infinity)
  const P: number[][] = []
  for (let i = 0; i < m.pos.length / 3; i++) { const q = rot([m.pos[i * 3] - centre[0], m.pos[i * 3 + 1] - centre[1], m.pos[i * 3 + 2] - centre[2]]); P.push([w / 2 + q[0] * scale, h / 2 - q[1] * scale, q[2]]) }
  const light = [.4, .7, .6]
  for (let t = 0; t < m.tri.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map(k => P[m.tri[t * 3 + k]])
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    // World normal for shading (two sided).
    const wa = [0, 1, 2].map(k => [m.pos[m.tri[t * 3 + k] * 3], m.pos[m.tri[t * 3 + k] * 3 + 1], m.pos[m.tri[t * 3 + k] * 3 + 2]]).map(rot)
    const u = [wa[1][0] - wa[0][0], wa[1][1] - wa[0][1], wa[1][2] - wa[0][2]], v = [wa[2][0] - wa[0][0], wa[2][1] - wa[0][1], wa[2][2] - wa[0][2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], nl = Math.hypot(...n) || 1
    const facing = n[2] / nl
    const shade = .25 + .75 * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl)
    const col = (COLOURS[m.tag[t]] ?? [255, 0, 255]).map(x => facing < 0 ? x * .35 : x * shade)
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
    if (Math.abs(area) < 1e-9) continue
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + .5, py = y + .5
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2]
      if (z <= zb[y * w + x]) continue
      zb[y * w + x] = z
      const edge = wire && Math.min(w0, w1, w2) < .03
      let c0 = col
      if (normals) {
        // Gouraud: interpolate the corner normals, rotated into view.
        const nn = [0, 1, 2].map(k => rot([normals[t * 9 + k * 3], normals[t * 9 + k * 3 + 1], normals[t * 9 + k * 3 + 2]]))
        const q = [0, 1, 2].map(a => w0 * nn[0][a] + w1 * nn[1][a] + w2 * nn[2][a]), ql = Math.hypot(...q) || 1
        const lit = .2 + .65 * Math.max(0, (q[0] * light[0] + q[1] * light[1] + q[2] * light[2]) / ql / Math.hypot(...light)) + .15 * Math.pow(Math.max(0, q[2] / ql), 8)
        c0 = (COLOURS[m.tag[t]] ?? [255, 0, 255]).map(x => Math.min(255, x * lit * 1.2))
      }
      const o = ((oy + y) * W + ox + x) * 3
      img[o] = edge ? 0 : c0[0]; img[o + 1] = edge ? 0 : c0[1]; img[o + 2] = edge ? 0 : c0[2]
    }
  }
}

function png(path: string, img: Uint8Array, W: number, H: number) {
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1) }
  const chunk = (type: string, data: Buffer) => {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8)
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length); return b
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

/** One row per mesh, one column per view. `wire` marks meshes drawn with their edges. */
/** `zoom` magnifies about `centre` (metres, game frame) for close ups of one feature. */
export function sheet(path: string, rows: { mesh: TriMesh; wire?: boolean; normals?: Float32Array }[], views = VIEWS, cell = 360, zoom = 1, centre: number[] = [0, 0, 0]) {
  const W = cell * views.length, H = Math.round(cell * .6) * rows.length, ch = Math.round(cell * .6)
  const img = new Uint8Array(W * H * 3).fill(235)
  rows.forEach((r, j) => views.forEach((v, i) => draw(r.mesh, v, img, W, i * cell, j * ch, cell, ch, cell / 4.6 * zoom, !!r.wire, r.normals, centre)))
  png(path, img, W, H)
}

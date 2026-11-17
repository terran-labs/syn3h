/** Reference slice (grey) against the hull outline (red) at a row of stations: /tmp/buggy-fit/sections/slicecheck.png */
import { readMesh, triangles, REF } from './glb'
import { sliceZ } from './slice'
import { outline, paramsAt } from '../../../src/vehicles/buggygen/sections/hull'
import { HULL } from '../../../src/vehicles/buggygen/sections/dataHull'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
const { tri } = triangles(readMesh(REF, 'Body'))
const zs = [-1.8, -1.6, -1.4, -1.2, -1.0, -.7, -.4, -.1, .2, .5, .8, 1.1, 1.3, 1.5, 1.7, 1.9]
const C = 220, PER = 8, W = C * PER, H = C * 2, img = new Uint8Array(W * H * 3).fill(30), s = C / 2.1
const dot = (ox: number, oy: number, x: number, y: number, r: number, g: number, b: number) => {
  const px = Math.round(ox + C / 2 + x * s), py = Math.round(oy + C - 30 - (y + .1) * s)
  if (px < ox || px >= ox + C || py < oy || py >= oy + C) return
  const j = (py * W + px) * 3; img[j] = r; img[j + 1] = g; img[j + 2] = b
}
zs.forEach((z, i) => {
  const ox = (i % PER) * C, oy = Math.floor(i / PER) * C
  for (const [x0, y0, x1, y1] of sliceZ(tri, z)) for (let k = 0; k <= 20; k++) dot(ox, oy, x0 + (x1 - x0) * k / 20, y0 + (y1 - y0) * k / 20, 150, 150, 150)
  const f = outline(paramsAt(HULL, z))
  for (let k = 0; k <= 400; k++) { const [x, y] = f(k / 400); dot(ox, oy, x, y, 255, 60, 50); dot(ox, oy, -x, y, 255, 60, 50) }
  for (let k = 0; k < 6; k++) dot(ox, oy, -1, .9 - k * .01 * (i % 2), 0, 255, 0)
})
const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1)
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2
writeFileSync('/tmp/buggy-fit/sections/slicecheck.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
console.log(zs.join(' '))

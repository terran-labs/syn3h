/** Draw cross-sections of the reference at many Z stations into a contact sheet. */
import { readMesh, triangles, REF } from './glb'
import { sliceZ } from './slice'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
const { tri, mat } = triangles(readMesh(REF, 'Body'))
const cols = [[220, 70, 60], [240, 200, 60], [190, 200, 215], [255, 255, 200], [255, 40, 40], [90, 140, 255], [220, 70, 60]]
const zs: number[] = []; for (let z = -1.95; z <= 2.06; z += .1) zs.push(+z.toFixed(2))
const C = 200, PER = 7, W = C * PER, H = C * Math.ceil(zs.length / PER), img = new Uint8Array(W * H * 3).fill(30)
zs.forEach((z, i) => {
  const ox = (i % PER) * C, oy = Math.floor(i / PER) * C, s = C / 2.1
  for (let x = 0; x < C; x++) { const j = ((oy + C - 1) * W + ox + x) * 3; img[j] = img[j + 1] = img[j + 2] = 80 }
  for (let y = 0; y < C; y++) { const j = ((oy + y) * W + ox) * 3; img[j] = img[j + 1] = img[j + 2] = 80 }
  // digits: mark z by a tick along the top proportional to z
  const tx = Math.round((z + 2) / 4.1 * (C - 10)); for (let y = 2; y < 8; y++) { const j = ((oy + y) * W + ox + 5 + tx) * 3; img[j + 1] = 255 }
  for (const [x0, y0, x1, y1, m] of sliceZ(tri, z, mat)) {
    const n = 30; for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n, px = Math.round(ox + C / 2 + x * s), py = Math.round(oy + C - 10 - (y + .1) * s * .9 * 2)
      if (px < ox || px >= ox + C || py < oy || py >= oy + C) continue
      const j = (py * W + px) * 3; img[j] = cols[m][0]; img[j + 1] = cols[m][1]; img[j + 2] = cols[m][2]
    }
  }
})
const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1)
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2
writeFileSync('/tmp/buggy-fit/sections/slices.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
console.log(zs.join(' '))

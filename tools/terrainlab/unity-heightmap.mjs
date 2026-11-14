/**
 * Pull the heightmap out of a binary Unity TerrainData .asset without Unity.
 *
 * TerrainData stores heights as an int32 count followed by count int16 samples, where count
 * is (2^n + 1)^2. This scans for such a count whose samples look like terrain (non negative,
 * smooth between neighbours), then writes:
 *   <prefix>.f32        raw little endian float32 heights, 0..1, row major
 *   <prefix>-shade.png  hillshaded preview, at most 1025 px
 * and prints the size, the height range and the likely world scale.
 *
 *   node tools/terrainlab/unity-heightmap.mjs <TerrainData.asset> <out-prefix>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const [path, prefix] = process.argv.slice(2)
const buf = readFileSync(path)

function findHeights() {
  for (const n of [4097, 2049, 1025, 513, 257, 129, 65, 33]) {
    const count = n * n
    for (const le of [true, false]) {
      const needle = Buffer.alloc(4)
      if (le) needle.writeInt32LE(count); else needle.writeInt32BE(count)
      let pos = buf.indexOf(needle)
      while (pos !== -1) {
        const start = pos + 4
        if (start + count * 2 <= buf.length) {
          const read = le ? (i) => buf.readInt16LE(start + i * 2) : (i) => buf.readInt16BE(start + i * 2)
          // Sample sparsely first: reject fast when values are negative or noisy.
          let min = Infinity, max = -Infinity, rough = 0, samples = 0, ok = true
          const stride = Math.max(1, Math.floor(count / 200000))
          for (let i = 0; i + 1 < count; i += stride) {
            const a = read(i)
            if (a < 0) { ok = false; break }
            if (a < min) min = a
            if (a > max) max = a
            if ((i + 1) % n !== 0) { rough += Math.abs(read(i + 1) - a); samples++ }
          }
          const span = max - min
          if (ok && span > 50 && rough / samples / span < 0.02) {
            const h = new Float32Array(count)
            for (let i = 0; i < count; i++) h[i] = read(i) / 32766
            return { n, h, pos, le, end: start + count * 2 }
          }
        }
        pos = buf.indexOf(needle, pos + 1)
      }
    }
  }
  return null
}

const found = findHeights()
if (!found) { console.log(`no heightmap found in ${path}`); process.exit(1) }
const { n, h, pos, le, end } = found
let min = Infinity, max = -Infinity, sum = 0
for (const v of h) { if (v < min) min = v; if (v > max) max = v; sum += v }
console.log(`${path.split('/').pop()}: ${n}x${n} at byte ${pos} (${le ? 'little' : 'big'} endian), ` +
  `norm min ${min.toFixed(3)} max ${max.toFixed(3)} mean ${(sum / h.length).toFixed(3)}`)

// The heightmap scale vector (cell x, full height y, cell z) sits shortly after the samples.
let scale = null
for (let o = end; o < Math.min(end + 96, buf.length - 12); o += 4) {
  const f = (k) => (le ? buf.readFloatLE(o + k) : buf.readFloatBE(o + k))
  const x = f(0), y = f(4), z = f(8)
  if (x > 0.01 && x < 100 && y > 1 && y < 20000 && Math.abs(x - z) < 1e-3 * Math.max(x, 1)) {
    scale = { cell: x, height: y }
    console.log(`  scale: cell ${x.toFixed(3)} m, full height ${y.toFixed(1)} m -> world ${(x * (n - 1)).toFixed(0)} m, ` +
      `relief ${(y * (max - min)).toFixed(0)} m (${(y * min).toFixed(0)} to ${(y * max).toFixed(0)} m)`)
    break
  }
}
writeFileSync(`${prefix}.f32`, Buffer.from(h.buffer))
writeFileSync(`${prefix}.json`, JSON.stringify({ source: path, n, min, max, scale }))

// Hillshaded preview.
const step = n > 1025 ? Math.ceil((n - 1) / 1024) : 1
const m = Math.floor((n - 1) / step) + 1
const at = (x, y) => h[Math.min(n - 1, y * step) * n + Math.min(n - 1, x * step)]
const span = Math.max(max - min, 1e-9)
// Vertical exaggeration so relief reads: assume the height range is about a fifth of the width.
const zs = (m * 0.2) / span
const raw = Buffer.alloc(m * (m * 3 + 1))
for (let y = 0; y < m; y++) {
  raw[y * (m * 3 + 1)] = 0
  for (let x = 0; x < m; x++) {
    const g = (at(x, y) - min) / span
    const dx = (at(Math.min(m - 1, x + 1), y) - at(Math.max(0, x - 1), y)) * zs * 0.5
    const dy = (at(x, Math.min(m - 1, y + 1)) - at(x, Math.max(0, y - 1))) * zs * 0.5
    const shade = Math.min(1, Math.max(0.12, 0.6 + 0.75 * (-dx - dy) / Math.sqrt(dx * dx + dy * dy + 1)))
    const o = y * (m * 3 + 1) + 1 + x * 3
    raw[o] = Math.min(255, (g * 0.7 + 0.3) * shade * 255)
    raw[o + 1] = Math.min(255, (g * 0.6 + 0.2) * shade * 255)
    raw[o + 2] = Math.min(255, (g * 0.45 + 0.15) * shade * 255)
  }
}
const crcTable = new Int32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc = (b) => { let c = -1; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8)
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(m, 0); ihdr.writeUInt32BE(m, 4); ihdr[8] = 8; ihdr[9] = 2
writeFileSync(`${prefix}-shade.png`, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]))

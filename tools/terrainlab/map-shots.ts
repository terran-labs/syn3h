/**
 * Top-down maps of every planet recipe, straight from the generator: no browser, no GPU.
 * Sea is blue by depth, land is shaded by height with light from the north-west, the spawn
 * pads are white and pad 0, the landing point, is red. For before and after comparisons of
 * generator changes.
 *
 *   npx tsx tools/terrainlab/map-shots.ts <out dir> [seed] [pixels]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { PLANETS, applyPlanet } from '../../src/world/planets'
import { generateTerrain } from '../../src/world/terrain/generate'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { currentTerrainSettings } from '../../src/world/terrain/settings'
import { params } from '../../shared/params'

const [out = '/tmp/map-shots', seedArg = '7', pixelArg = '512'] = process.argv.slice(2)
const seed = Number(seedArg), N = Number(pixelArg)
mkdirSync(out, { recursive: true })

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii')
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, tail])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1) }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

for (const p of PLANETS) {
  applyPlanet(p.id, seed)
  const d = generateTerrain(seed, currentTerrainSettings())
  const s = new HeightSampler(d)
  const sea = Number(params.get('world.lavaAltitude')?.value ?? 0)
  const rgb = new Uint8Array(N * N * 3)
  const m = d.size / N
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const x = -d.size / 2 + (px + 0.5) * m, z = -d.size / 2 + (py + 0.5) * m
    const h = s.heightAt(x, z)
    let r: number, g: number, b: number
    if (h < sea && !d.settings.dry) {
      const depth = Math.min(1, (sea - h) / 40)
      r = 40 - 30 * depth; g = 120 - 70 * depth; b = 190 - 70 * depth
    } else {
      // Height ramp with a north-west light.
      const shade = Math.max(0.35, Math.min(1.3, 1 + (s.heightAt(x - m, z - m) - s.heightAt(x + m, z + m)) / (m * 2)))
      const t = Math.min(1, Math.max(0, (h - sea) / 400))
      r = (120 + 110 * t) * shade; g = (150 - 20 * t) * shade; b = (80 + 120 * t) * shade
    }
    const i = (py * N + px) * 3
    rgb[i] = Math.min(255, r); rgb[i + 1] = Math.min(255, g); rgb[i + 2] = Math.min(255, b)
  }
  d.layout.spawns.forEach((pad, k) => {
    const cx = Math.round((pad.x + d.size / 2) / m), cy = Math.round((pad.z + d.size / 2) / m)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const i = (((cy + dy + N) % N) * N + ((cx + dx + N) % N)) * 3
      rgb[i] = 255; rgb[i + 1] = k === 0 ? 40 : 255; rgb[i + 2] = k === 0 ? 40 : 255
    }
  })
  // Each extra mountain (landforms.ts) as a yellow ring at its foot.
  for (const k of (d.layout as { peaks?: { x: number; z: number; radius: number }[] }).peaks ?? []) {
    for (let a = 0; a < 360; a += 1) {
      const cx = Math.round((k.x + Math.cos(a * Math.PI / 180) * k.radius + d.size / 2) / m), cy = Math.round((k.z + Math.sin(a * Math.PI / 180) * k.radius + d.size / 2) / m)
      const i = (((cy + N) % N) * N + ((cx + N) % N)) * 3
      rgb[i] = 255; rgb[i + 1] = 220; rgb[i + 2] = 0
    }
  }
  writeFileSync(join(out, `${p.id}.png`), png(N, N, rgb))
  console.log(`${p.id}: ${d.size} m, ${(d.layout as { peaks?: unknown[] }).peaks?.length ?? 0} peaks, ${(d.layout as { isles?: unknown[] }).isles?.length ?? 0} isles`)
}

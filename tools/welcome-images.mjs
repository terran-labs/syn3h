#!/usr/bin/env node
/**
 * The Welcome panel's pictures: web-sized WebP from the showcase originals in art/welcome/.
 *
 *   node tools/welcome-images.mjs          # write public/welcome/*.webp and the manifest
 *   node tools/welcome-images.mjs --check  # exit 1 if the outputs are missing or stale
 *
 * The originals are 3840 x 2160 captures from tools/showcase.mjs --hud hidden (v26.11.1711,
 * the interface hidden so the pictures never show a HUD the game has replaced) and stay in
 * the repository as source. Each becomes four widths, 640 to 1920, so a phone fetches a small
 * one and a large high-density screen a sharp one (welcome.ts picks with srcset and sizes). The manifest (src/ui/welcome/shots.generated.ts)
 * records each file's width, height and bytes and the picture's average colour, which the
 * panel paints while the picture loads, so no extra bytes are spent on a placeholder.
 *
 * The owner's rule (AGENTS.md): these may load only after the player deliberately opens
 * Welcome. src/ui/welcome/welcome.ts sets their src only then; tests/ui/welcome-images.mjs
 * proves zero image requests before that.
 *
 * Needs cwebp and ffmpeg (Homebrew), as tools/showcase.mjs does. Run it when an original in
 * art/welcome/ or SHOTS below changes, and commit what it writes.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg'
const CWEBP = process.env.CWEBP ?? '/opt/homebrew/bin/cwebp'
const WIDTHS = [640, 960, 1280, 1920]
/**
 * Quality for a page whose job is to look good (Foreman, 17 November 2026): WebP quality 88
 * with noise shaping and the deblocking filter off, which keeps the fine detail (the wings' hex
 * pattern, terrain texture, the vehicles) crisp; checked at 100 percent for banding and smearing.
 * A picture whose largest width would pass MAX_BYTES is instead encoded to that size.
 */
const QUALITY = ['-q', '88', '-sns', '0', '-f', '0']
const MAX_BYTES = 120 * 1024

/** The pictures, in the order the panel shows them. Alt text describes what is in frame. */
export const SHOTS = [
  { id: 'wings-glide', alt: 'A buggy gliding on translucent blue force-field wings past a red canyon wall, teal water below' },
  { id: 'jet-tiny-world', alt: 'The jet climbing away from a small planet whose whole curved surface fills the bottom of the view' },
  { id: 'lagoon-hovercraft', alt: 'A hovercraft hovering over a pale sand slope on an island under a blue sky, a buggy on the crest above' },
  { id: 'lava-night', alt: 'A buggy on a dark shore beside a glowing lava sea at night, a volcano and other buggies behind' },
  { id: 'swamp-river', alt: 'A buggy on green grass above a pale green river in the Mire, hazy hills beyond' },
  { id: 'canyon-convoy', alt: 'Three buggies together on a red canyon floor at golden hour, a jet low overhead' },
]

const sourceOf = id => join(root, 'art/welcome', `${id}.jpg`)
const outputOf = (id, width) => join(root, 'public/welcome', `${id}-${width}.webp`)
const manifestPath = join(root, 'src/ui/welcome/shots.generated.ts')

/** Average colour of the picture, as a CSS hex colour: ffmpeg scales it to one pixel. */
function averageColour(file) {
  const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-i', file, '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return `#${[...raw.subarray(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function manifestText(entries) {
  return `// Written by tools/welcome-images.mjs from art/welcome/. Do not edit; run the tool.
export interface WelcomeShot { id: string; alt: string; colour: string; width: number; height: number; files: { width: number; url: string; bytes: number }[] }
export const WELCOME_SHOTS: readonly WelcomeShot[] = ${JSON.stringify(entries, null, 2)}
`
}

const check = process.argv.includes('--check')
mkdirSync(join(root, 'public/welcome'), { recursive: true })
const entries = []
for (const shot of SHOTS) {
  const source = sourceOf(shot.id)
  if (!existsSync(source)) throw new Error(`missing original ${source}`)
  const files = []
  for (const width of WIDTHS) {
    const out = outputOf(shot.id, width)
    if (!check) {
      const encode = (rate) => execFileSync(CWEBP, ['-quiet', ...rate, '-m', '6', '-sharp_yuv', '-metadata', 'none', '-resize', String(width), '0', source, '-o', out])
      encode(QUALITY)
      if (statSync(out).size > MAX_BYTES) encode(['-size', String(MAX_BYTES - 2048), '-pass', '6', '-sns', '0', '-f', '0'])
    }
    if (!existsSync(out)) { console.error(`missing ${out}`); process.exit(1) }
    files.push({ width, url: `/welcome/${shot.id}-${width}.webp`, bytes: statSync(out).size })
  }
  // The originals are 16:9; the outputs keep that shape.
  entries.push({ id: shot.id, alt: shot.alt, colour: averageColour(source), width: 16, height: 9, files })
}
const text = manifestText(entries)
if (check) {
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== text) { console.error('src/ui/welcome/shots.generated.ts is stale: run node tools/welcome-images.mjs'); process.exit(1) }
} else writeFileSync(manifestPath, text)
let total = 0
for (const e of entries) for (const f of e.files) { total += f.bytes; console.log(`${f.url}\t${(f.bytes / 1024).toFixed(1)} KB`) }
console.log(`total\t${(total / 1024).toFixed(1)} KB (${entries.length} pictures, ${WIDTHS.length} widths each)`)
for (const width of WIDTHS) console.log(`at ${width}\t${(entries.reduce((sum, e) => sum + e.files.find(f => f.width === width).bytes, 0) / 1024).toFixed(1)} KB for all ${entries.length}`)

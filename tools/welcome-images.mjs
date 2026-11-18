#!/usr/bin/env node
/**
 * The Welcome panel's pictures: web-sized WebP from the showcase originals in art/welcome/.
 *
 *   node tools/welcome-images.mjs          # write public/welcome/*.webp and the manifest
 *   node tools/welcome-images.mjs --check  # exit 1 if the outputs are missing or stale
 *
 * The originals are 3840 x 2160 captures from tools/showcase.mjs (v26.11.1610) and stay in
 * the repository as source. Each becomes two widths, 640 and 1280, which cover the panel
 * (300 to 880 CSS px wide) at 1x and 2x. The manifest (src/ui/welcome/shots.generated.ts)
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
const WIDTHS = [640, 1280]
const QUALITY = 72

/** The pictures, in the order the panel shows them. Alt text describes what is in frame. */
export const SHOTS = [
  { id: 'wings-glide', alt: 'A buggy gliding off a sandstone ridge on translucent blue force-field wings, low sun on the Badlands' },
  { id: 'jet-tiny-world-clean', alt: 'The jet climbing above a small planet whose whole curved surface fills the bottom of the view' },
  { id: 'lagoon-hovercraft', alt: 'A hovercraft skimming a bright blue lagoon toward low islands' },
  { id: 'lava-night', alt: 'A buggy on a dark shore beside a glowing lava sea at night, a volcano behind' },
  { id: 'swamp-river', alt: 'A buggy on green slopes beside a river in the Methane Swamp, under a hazy green sky' },
  { id: 'canyon-convoy', alt: 'Three buggies together on a red canyon floor at golden hour, a jet overhead' },
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
    if (!check) execFileSync(CWEBP, ['-quiet', '-q', String(QUALITY), '-m', '6', '-sharp_yuv', '-metadata', 'none', '-resize', String(width), '0', source, '-o', out])
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

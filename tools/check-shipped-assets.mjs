#!/usr/bin/env node
// Release check for the owner's rule of 15 November 2026 (AGENTS.md, ops/DECISIONS.md):
// no recorded audio and no pre-generated bitmaps ship. Music, cues and wind are synthesised;
// images are shaders, vectors or generated at run time. The only bitmaps allowed are the
// ones platforms demand (install icons and the social share card) and the Welcome guide's
// curated pictures, which load only once the player opens it (ABOUT_PICTURES below).
//
//   node tools/check-shipped-assets.mjs            # checks dist/ (the built site)
//   node tools/check-shipped-assets.mjs public     # checks the static source folder
//   node tools/check-shipped-assets.mjs dist --allow models/textures/x.png
//
// Exits 1 and lists every offending file with its size. `--allow` exists only so a release
// can name a file another lane is still removing; it prints what it let through.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const AUDIO = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|wma|mid|midi|weba)$/i
export const IMAGE = /\.(png|jpe?g|webp|gif|bmp|ico|avif|tga|tiff?|ktx2?|hdr|exr|dds|basis)$/i
/** Bitmaps a platform requires. Paths are relative to the checked folder. */
// Every set stays for the frozen versions that load it: the Syn3h icons (no prefix), mira-, and
// mira2-, and the current mira3- set (BRAND_SET in src/ui/brand/LogoMark.ts).
export const REQUIRED_BITMAPS = ['brand/apple-touch-icon.png', 'brand/icon-192.png', 'brand/icon-512.png', 'brand/share.png',
  'brand/mira-apple-touch-icon.png', 'brand/mira-icon-192.png', 'brand/mira-icon-512.png', 'brand/mira-share.png',
  'brand/mira2-apple-touch-icon.png', 'brand/mira2-icon-192.png', 'brand/mira2-icon-512.png', 'brand/mira2-icon-maskable-512.png', 'brand/mira2-share.png',
  'brand/mira3-apple-touch-icon.png', 'brand/mira3-icon-192.png', 'brand/mira3-icon-512.png', 'brand/mira3-icon-maskable-512.png', 'brand/mira3-share.png']
/**
 * The owner's one content exception (AGENTS.md): curated About pictures, the Welcome guide's
 * screenshots, fetched only after the player deliberately opens it. Only web-sized WebP made by
 * tools/welcome-images.mjs pass; tools/runtime-assets-check.mjs and the about and
 * discoverability browser checks prove none loads in ordinary play.
 */
/**
 * The social share card, rendered by the build (tools/brand/share-card.mjs) and named by its
 * content hash, because a released version keeps its own card at its own address (index.html's
 * og:image). Never tracked: tests/ops/no-bitmaps.test.ts keeps it out of the repository.
 */
export const SHARE_CARDS = /^brand\/share-[0-9a-f]{8}\.png$/
export const ABOUT_PICTURES = /^welcome\/[a-z0-9-]+-(640|960|1280|1920)\.webp$/

/**
 * A built site's share card (tools/brand/share-card.mjs, emitted by the build): index.html's
 * og:image and twitter:image name one file under brand/, it exists in the build, it is a PNG of
 * the size og:image:width and og:image:height declare, and it is a SHARE_CARDS name. Returns the
 * problems; none for a folder without an index.html (public/).
 */
export function shareCardProblems(dir) {
  const index = join(dir, 'index.html')
  if (!existsSync(index)) return []
  const html = readFileSync(index, 'utf8')
  const tag = (name) => new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html)?.[1] ?? ''
  const urls = ['og:image', 'twitter:image'].map(tag), problems = []
  if (urls[0] !== urls[1]) problems.push(`og:image and twitter:image differ: ${urls.join(', ')}`)
  const path = urls[0] ? new URL(urls[0]).pathname.slice(1) : ''
  if (!SHARE_CARDS.test(path)) return [...problems, `og:image names ${urls[0] || 'nothing'}, not a built share card (brand/share-<hash>.png)`]
  const file = join(dir, path)
  if (!existsSync(file)) return [...problems, `the share card ${path} is not in ${dir}`]
  const png = readFileSync(file), size = [png.readUInt32BE(16), png.readUInt32BE(20)], want = [Number(tag('og:image:width')), Number(tag('og:image:height'))]
  if (png.subarray(1, 4).toString() !== 'PNG' || size.join() !== want.join()) problems.push(`the share card ${path} is ${size.join(' x ')}, the tags declare ${want.join(' x ')}`)
  return problems
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/** Every shipped audio file and every bitmap that no platform requires. */
export function findForbidden(dir, allow = []) {
  const allowed = new Set([...REQUIRED_BITMAPS, ...allow])
  const audio = [], images = [], waived = []
  for (const path of walk(dir)) {
    const name = relative(dir, path).split(sep).join('/')
    // Frozen earlier releases (tools/frozen-versions.mjs) ship unchanged, as they were when
    // each passed this check. They are what a judge is promised, so they are not re-judged.
    if (name.startsWith('v/')) continue
    const kind = AUDIO.test(name) ? audio : IMAGE.test(name) ? images : null
    if (!kind) continue
    const item = { path: name, bytes: statSync(path).size }
    if (kind === images && (ABOUT_PICTURES.test(name) || SHARE_CARDS.test(name))) continue
    if (!allowed.has(name)) kind.push(item)
    else if (allow.includes(name)) waived.push(item)
  }
  return { audio, images, waived }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), allow = []
  let dir = 'dist'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow') allow.push(args[++i])
    else dir = args[i]
  }
  let found
  try { found = findForbidden(dir, allow) } catch (error) { console.error(`check-shipped-assets: cannot read ${dir}: ${error.message}`); process.exit(2) }
  const line = (f) => `  ${f.path} (${f.bytes.toLocaleString('en-US')} bytes)`
  for (const f of found.waived) console.log(`waived by --allow:${line(f)}`)
  if (found.audio.length) console.error(`Shipped audio files are not allowed. Synthesise the sound instead:\n${found.audio.map(line).join('\n')}`)
  if (found.images.length) console.error(`Shipped bitmaps are not allowed unless a platform requires them. Generate them instead:\n${found.images.map(line).join('\n')}`)
  const card = shareCardProblems(dir)
  if (card.length) console.error(`The share card is wrong:\n${card.map((p) => `  ${p}`).join('\n')}`)
  if (found.audio.length || found.images.length || card.length) process.exit(1)
  console.log(`check-shipped-assets: ${dir} ships no audio files and no unrequired bitmaps${existsSync(join(dir, 'index.html')) ? ', and its share card is built and the declared size' : ''}`)
}

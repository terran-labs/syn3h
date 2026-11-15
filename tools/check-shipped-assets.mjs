#!/usr/bin/env node
// Release check for the owner's rule of 15 November 2026 (AGENTS.md, ops/DECISIONS.md):
// no recorded audio and no pre-generated bitmaps ship. Music, cues and wind are synthesised;
// images are shaders, vectors or generated at run time. The only bitmaps allowed are the
// ones platforms demand: install icons and the social share card.
//
//   node tools/check-shipped-assets.mjs            # checks dist/ (the built site)
//   node tools/check-shipped-assets.mjs public     # checks the static source folder
//   node tools/check-shipped-assets.mjs dist --allow models/textures/x.png
//
// Exits 1 and lists every offending file with its size. `--allow` exists only so a release
// can name a file another lane is still removing; it prints what it let through.
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const AUDIO = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|wma|mid|midi|weba)$/i
export const IMAGE = /\.(png|jpe?g|webp|gif|bmp|ico|avif|tga|tiff?|ktx2?|hdr|exr|dds|basis)$/i
/** Bitmaps a platform requires. Paths are relative to the checked folder. */
export const REQUIRED_BITMAPS = ['brand/apple-touch-icon.png', 'brand/icon-192.png', 'brand/icon-512.png', 'brand/share.png']

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
    const kind = AUDIO.test(name) ? audio : IMAGE.test(name) ? images : null
    if (!kind) continue
    const item = { path: name, bytes: statSync(path).size }
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
  if (found.audio.length || found.images.length) process.exit(1)
  console.log(`check-shipped-assets: ${dir} ships no audio files and no unrequired bitmaps`)
}

#!/usr/bin/env node
/**
 * Every picture of the lobby in one command: the README's lobby still (also the one
 * terranlabs.com shows), the README's lobby dive clip, and the social share card. Run it again
 * whenever the lobby or the wordmark changes, and look at every picture before using it.
 *
 *   npm run build   (or point --dir at a frozen copy, or --url at a running build)
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/lobby-captures.mjs --dir . --label v26.11.2500
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/lobby-captures.mjs --dir . --label v26.11.2500 \
 *       --site /path/to/a/terranlabs.com/worktree
 *
 * Options:
 *   --dir / --url  the build to capture, as for tools/showcase.mjs: --dir is a checkout or a
 *                  frozen copy with dist/ built (and dist/build.json); one of the two is required
 *   --label        names the output folder, starting with v (default "vlobby")
 *   --out          output root (default captures/lobby in this checkout)
 *   --no-clip      skip the dive clip (the slowest part: 7 s at 60 fps, 420 frames)
 *   --card-only    skip the README still and clip
 *   --tagline-size preview the card with another tagline size (the build uses TAGLINE_SIZE in
 *                  tools/brand/share-card.mjs)
 *   --site         also copy the still into a terranlabs.com checkout (public/products/mira/
 *                  lobby.webp, 1600 x 900) and the card into its brand-resources/mira/
 *
 * The README still and clip are tools/showcase.mjs's own lobby shots, unchanged in method
 * (docs/RELEASE-SHOWCASE.md): headed Chrome on the real GPU, Cinematic quality fixed, a virtual
 * 60 fps clock, the shot taken once the lobby says its opening is over (READY.lobby there: every
 * world arrived, the wordmark's reveal and fade done, the camera at rest) and the frames have gone
 * quiet. 3840 x 2160 (lobby.jpg) and 1600 x 900 (lobby-1600.webp, also the site's lobby.webp).
 * Two disclosed differences from the release showcase: the planets' cycling hover glow is off,
 * so a still never catches a world mid-pulse; and a build without a release version (a local
 * build of main) has its "dev" version line hidden rather than shown.
 *
 * The share card is not made here: the build renders it (tools/brand/share-card.mjs, which
 * says how) into dist/brand/share-<hash>.png and points index.html at it. This tool writes the
 * same card into the output folder as a preview, or with --tagline-size another size to compare.
 *
 * Publishing the README's copies to a GitHub release is a separate, deliberate step, on the
 * owner's word: tools/showcase.mjs --publish-only, or gh release upload.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/showcase-scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const options = parseArgs(process.argv.slice(2), ['dir', 'url', 'label', 'out', 'no-clip', 'card-only', 'tagline-size', 'site'])
if (!options.dir === !options.url) throw new Error('Give exactly one of --dir or --url')
const label = typeof options.label === 'string' ? options.label : 'vlobby'
if (!/^v[\w.-]+$/.test(label)) throw new Error('--label starts with v, like v26.11.2500')
const out = resolve(typeof options.out === 'string' ? options.out : join(root, 'captures/lobby'))
const source = options.dir ? ['--dir', resolve(options.dir)] : ['--url', options.url]
const TAGLINE_SIZE = Number(options['tagline-size'] ?? 66)
if (!(TAGLINE_SIZE >= 20 && TAGLINE_SIZE <= 90)) throw new Error('--tagline-size is between 20 and 90 pixels')

function showcase(args) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [join(here, 'showcase.mjs'), ...source, '--version', label, ...args], { stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? ok() : fail(new Error(`showcase.mjs ${args.join(' ')} exited with ${code}`)))
  })
}
const bytes = (f) => statSync(f).size
const NO_GLOW = { 'lobby.hoverGlow': 0 }

// 1. The README still and clip.
const readme = join(out, 'readme'), still = join(readme, label)
if (!options['card-only']) {
  const build = options.dir ? JSON.parse(readFileSync(join(resolve(options.dir), 'dist/build.json'), 'utf8')) : null
  const css = build && !build.version ? ['--css', '.lobby-version-dock { visibility: hidden !important; }'] : []
  await showcase(['--only', options['no-clip'] ? 'lobby' : 'lobby,clip-dive', '--params', JSON.stringify(NO_GLOW), ...css, '--out', readme])
  for (const f of ['lobby.png', 'lobby.jpg', 'lobby-1600.webp']) if (!existsSync(join(still, f))) throw new Error(`no ${f} in ${still}`)
}

// 2. A preview of the share card. The build makes the shipped one (tools/brand/share-card.mjs);
// this writes the same card, or another tagline size to compare, into the output folder.
const { renderShareCard } = await import('./brand/share-card.mjs')
const rendered = await renderShareCard(options['tagline-size'] ? { size: TAGLINE_SIZE } : {})
const card = join(out, rendered.name)
mkdirSync(out, { recursive: true }); writeFileSync(card, rendered.png)
console.log(`share card: glow ends at y ${rendered.glowEnd}, tagline baseline ${rendered.baseline}, width ${rendered.width.toFixed(0)} px`)

if (!options['card-only']) {
  console.log(`\nlobby still: ${join(still, 'lobby.jpg')} (${bytes(join(still, 'lobby.jpg'))} bytes), ${join(still, 'lobby-1600.webp')} (${bytes(join(still, 'lobby-1600.webp'))} bytes)`)
  if (!options['no-clip']) console.log(`dive clip: ${join(still, 'clip-dive.webp')} (${bytes(join(still, 'clip-dive.webp'))} bytes), ${join(still, 'clip-dive.mp4')}`)
}
console.log(`share card: ${card} (${bytes(card)} bytes)`)

// 3. If asked, a terranlabs.com checkout.
if (typeof options.site === 'string') {
  const site = resolve(options.site)
  const target = join(site, 'public/products/mira/lobby.webp')
  if (!existsSync(target)) throw new Error(`${target} not found: is --site a terranlabs.com checkout?`)
  if (!options['card-only']) copyFileSync(join(still, 'lobby-1600.webp'), target)
  mkdirSync(join(site, 'brand-resources/mira'), { recursive: true })
  copyFileSync(card, join(site, 'brand-resources/mira/mira-share-card-1200x630.png'))
  console.log(`site: wrote ${options['card-only'] ? '' : `${target} and `}brand-resources/mira/mira-share-card-1200x630.png`)
}

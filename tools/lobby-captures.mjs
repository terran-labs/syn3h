#!/usr/bin/env node
/**
 * Every picture of the lobby in one command: the README's lobby still (also the one
 * terranlabs.com shows), the README's lobby dive clip, and the social share card. Run it again
 * whenever the lobby or the wordmark changes, and look at every picture before using it.
 *
 *   npm run build   (or point --dir at a frozen copy, or --url at a running build)
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/lobby-captures.mjs --dir . --label v26.11.2500
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/lobby-captures.mjs --dir . --label v26.11.2500 \
 *       --install --site /path/to/a/terranlabs.com/worktree
 *
 * Options:
 *   --dir / --url  the build to capture, as for tools/showcase.mjs: --dir is a checkout or a
 *                  frozen copy with dist/ built (and dist/build.json); one of the two is required
 *   --label        names the output folder, starting with v (default "vlobby")
 *   --out          output root (default captures/lobby in this checkout)
 *   --no-clip      skip the dive clip (the slowest part: 7 s at 60 fps, 420 frames)
 *   --card-only    skip the README still and clip
 *   --tagline-size the tagline's size in card pixels (default 58; the earlier cards had 38)
 *   --install      write the card into public/brand under a new content-hashed name and point
 *                  index.html's og:image and twitter:image at it
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
 * The share card, as the owner chose on 25 November 2026: the earlier cards' black silhouette
 * and warm gold glow on their own dark starfield, drawn by their own generator (logoSvg's 'card'
 * layout, through tools/brand/card-svg.ts), so the mark, glow and sky are pixel for pixel the
 * earlier card's. Under it "Your galaxy awaits." only, in generate.ts's face and colour
 * (Barlow Condensed 600, #edf3ff) at --tagline-size, vertically centred in the space below the
 * logo: the text's optical centre (the mean of its cap-height and x-height middles, measured from
 * the font) sits midway between the bottom edge and where the glow below the mark fades back to
 * the sky (the first row under the mark where the mark-and-glow layer alone, mark.svg, is nowhere more
 * than 4/255 opaque).
 * Lossless PNG. The lobby galaxy was tried behind it and the owner preferred the plain sky.
 *
 * A released version's share card stays at its own address (tools/frozen-versions.mjs refuses a
 * build that changes bytes an archived version serves), so --install writes a new name,
 * brand/share-<8 hex of sha256>.png (allowed by SHARE_CARDS in tools/check-shipped-assets.mjs),
 * and leaves the earlier cards where they are. The meta tags keep their absolute
 * https://mira.cc/ form, which the beta Worker rewrites to the beta host.
 *
 * Publishing the README's copies to a GitHub release is a separate, deliberate step, on the
 * owner's word: tools/showcase.mjs --publish-only, or gh release upload.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/showcase-scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg'
const CARD = { width: 1200, height: 630 }

const options = parseArgs(process.argv.slice(2), ['dir', 'url', 'label', 'out', 'no-clip', 'card-only', 'tagline-size', 'install', 'site'])
if (!options.dir === !options.url) throw new Error('Give exactly one of --dir or --url')
const label = typeof options.label === 'string' ? options.label : 'vlobby'
if (!/^v[\w.-]+$/.test(label)) throw new Error('--label starts with v, like v26.11.2500')
const out = resolve(typeof options.out === 'string' ? options.out : join(root, 'captures/lobby'))
const source = options.dir ? ['--dir', resolve(options.dir)] : ['--url', options.url]
const TAGLINE_SIZE = Number(options['tagline-size'] ?? 58)
if (!(TAGLINE_SIZE >= 20 && TAGLINE_SIZE <= 90)) throw new Error('--tagline-size is between 20 and 90 pixels')

function showcase(args) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [join(here, 'showcase.mjs'), ...source, '--version', label, ...args], { stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? ok() : fail(new Error(`showcase.mjs ${args.join(' ')} exited with ${code}`)))
  })
}
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)] }
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

// 2. The share card: no capture, only the generator and a headless page's canvas.
const svgDir = join(out, 'card-svg')
execFileSync('npx', ['tsx', join(here, 'brand/card-svg.ts'), svgDir], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
const composed = await compose(svgDir)
const card = join(out, 'share-card.png'), cardFull = join(out, 'share-card-full.png')
writeFileSync(cardFull, composed.png)
execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', cardFull, '-vf', 'format=rgb24', '-compression_level', '100', '-pred', 'mixed', card])
if (pngSize(card).join() !== `${CARD.width},${CARD.height}`) throw new Error(`${card} is ${pngSize(card).join(' x ')}`)
console.log(`tagline ${TAGLINE_SIZE}px: glow ends at y ${composed.glowEnd}, optical centre at ${composed.centre.toFixed(1)}, baseline ${composed.baseline}, width ${composed.width.toFixed(0)} px (cap ${composed.cap}, x-height ${composed.xHeight})`)

/** The card from the generator's SVG, with the tagline placed by the rule in the header. */
async function compose(dir) {
  const { chromium } = await import('playwright-core')
  const font = readFileSync(join(root, 'public/fonts/barlow-condensed-600-latin.woff2')).toString('base64')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', (route) => route.abort())
    const r = await page.evaluate(async ({ sky, mark, box, font, W, H, size }) => {
      const i = new Image(); i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sky)}`; await i.decode()
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')
      x.drawImage(i, 0, 0)
      // Where the glow ends: the first row under the mark where the mark-and-glow layer alone
      // (mark.svg, on nothing) is nowhere more than 4/255 opaque.
      const m = new Image(); m.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark)}`; await m.decode()
      const mc = document.createElement('canvas'); mc.width = W; mc.height = H; const mx = mc.getContext('2d'); mx.drawImage(m, 0, 0)
      const a = mx.getImageData(0, 0, W, H).data
      let glowEnd = Math.ceil(box.y + box.height)
      for (let y = glowEnd; y < H; y++) { let most = 0; for (let px = 0; px < W; px++) most = Math.max(most, a[(y * W + px) * 4 + 3]); if (most > 4) glowEnd = y + 1; else break }
      const face = new FontFace('Mira', `url(data:font/woff2;base64,${font})`); await face.load(); document.fonts.add(face)
      x.font = `${size}px Mira`
      const cap = x.measureText('H').actualBoundingBoxAscent, xHeight = x.measureText('x').actualBoundingBoxAscent
      const centre = (glowEnd + H) / 2, baseline = Math.round(centre + (cap / 2 + xHeight / 2) / 2)
      const text = 'Your galaxy awaits.'
      x.textAlign = 'center'; x.fillStyle = '#edf3ff'; x.fillText(text, W / 2, baseline)
      return { png: c.toDataURL('image/png').split(',')[1], glowEnd, centre, baseline, cap: +cap.toFixed(1), xHeight: +xHeight.toFixed(1), width: x.measureText(text).width }
    }, { sky: readFileSync(join(dir, 'sky.svg'), 'utf8'), mark: readFileSync(join(dir, 'mark.svg'), 'utf8'), box: JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8')), font, W: CARD.width, H: CARD.height, size: TAGLINE_SIZE })
    return { ...r, png: Buffer.from(r.png, 'base64') }
  } finally { await browser.close() }
}

if (!options['card-only']) {
  console.log(`\nlobby still: ${join(still, 'lobby.jpg')} (${bytes(join(still, 'lobby.jpg'))} bytes), ${join(still, 'lobby-1600.webp')} (${bytes(join(still, 'lobby-1600.webp'))} bytes)`)
  if (!options['no-clip']) console.log(`dive clip: ${join(still, 'clip-dive.webp')} (${bytes(join(still, 'clip-dive.webp'))} bytes), ${join(still, 'clip-dive.mp4')}`)
}
console.log(`share card: ${card} (${bytes(card)} bytes)`)

// 3. Install into this checkout and, if asked, a terranlabs.com checkout.
if (options.install) {
  const name = `share-${createHash('sha256').update(readFileSync(card)).digest('hex').slice(0, 8)}.png`
  copyFileSync(card, join(root, 'public/brand', name))
  const indexPath = join(root, 'index.html')
  const next = readFileSync(indexPath, 'utf8').replace(/(<meta (?:property="og:image"|name="twitter:image") content="https:\/\/mira\.cc\/brand\/)[^"]+(")/g, `$1${name}$2`)
  if ((next.match(new RegExp(name.replace('.', '\\.'), 'g')) ?? []).length !== 2) throw new Error('index.html: did not find exactly one og:image and one twitter:image to point at the card')
  writeFileSync(indexPath, next)
  console.log(`installed public/brand/${name}; index.html points at it (check og:image:alt and twitter:image:alt still describe it)`)
}
if (typeof options.site === 'string') {
  const site = resolve(options.site)
  const target = join(site, 'public/products/mira/lobby.webp')
  if (!existsSync(target)) throw new Error(`${target} not found: is --site a terranlabs.com checkout?`)
  if (!options['card-only']) copyFileSync(join(still, 'lobby-1600.webp'), target)
  mkdirSync(join(site, 'brand-resources/mira'), { recursive: true })
  copyFileSync(card, join(site, 'brand-resources/mira/mira-share-card-1200x630.png'))
  console.log(`site: wrote ${options['card-only'] ? '' : `${target} and `}brand-resources/mira/mira-share-card-1200x630.png`)
}

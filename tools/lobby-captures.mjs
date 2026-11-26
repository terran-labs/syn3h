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
 *   --card         which card --install and --site use: starfield (the default) or galaxy;
 *                  both are always written
 *   --tagline-y    the tagline's baseline in card pixels (default 565; the earlier cards had 492)
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
 * The share card, on the owner's direction of 25 November 2026: the earlier cards' black
 * silhouette and warm gold glow, drawn by their own generator (logoSvg's 'card' layout, through
 * tools/brand/card-svg.ts), at the same position and scale, with "Your galaxy awaits." only, in
 * generate.ts's font, size and colour, moved down to --tagline-y. Two backgrounds:
 * - starfield: the earlier cards' own dark starfield. The mark and glow are pixel for pixel the
 *   earlier card's. Lossless PNG.
 * - galaxy: the same mark and glow over the real lobby galaxy: the lobby in a 1200 x 780 window
 *   at 2x with its own wordmark sent off screen (the "behind the sun" placement, lobby.wordmark 1,
 *   places the name by the HTML logo box, so a box moved away leaves the galaxy without it) and
 *   its buttons, names and planet glow hidden. The card is its top 630 rows, so the sun sits
 *   below the mark; the galaxy is dimmed in an ellipse behind the mark, only as much as the glow
 *   needs. PNG at six bits per channel, rounded: within 2/255 of the composite, no banding at 200
 *   percent, two thirds of the full-colour bytes. (A 256-colour palette greyed the worlds.)
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

const options = parseArgs(process.argv.slice(2), ['dir', 'url', 'label', 'out', 'no-clip', 'card-only', 'card', 'tagline-y', 'install', 'site'])
if (!options.dir === !options.url) throw new Error('Give exactly one of --dir or --url')
const label = typeof options.label === 'string' ? options.label : 'vlobby'
if (!/^v[\w.-]+$/.test(label)) throw new Error('--label starts with v, like v26.11.2500')
const out = resolve(typeof options.out === 'string' ? options.out : join(root, 'captures/lobby'))
const source = options.dir ? ['--dir', resolve(options.dir)] : ['--url', options.url]
const cardChoice = typeof options.card === 'string' ? options.card : 'starfield'
if (!['starfield', 'galaxy'].includes(cardChoice)) throw new Error('--card takes starfield or galaxy')
const TAGLINE_Y = Number(options['tagline-y'] ?? 565)
if (!(TAGLINE_Y > 300 && TAGLINE_Y < 600)) throw new Error('--tagline-y is a baseline between 300 and 600')

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

// 2. The share cards.
const galaxyRun = join(out, 'card-galaxy'), svgDir = join(out, 'card-svg')
await showcase(['--only', 'lobby', '--view', `${CARD.width}x780@2`, '--bare', '--params', JSON.stringify({ ...NO_GLOW, 'lobby.wordmark': 1 }),
  '--css', '.shell-logo { margin-top: -4000px !important; animation: none !important; }', '--out', galaxyRun])
const galaxy = join(galaxyRun, label, 'lobby.png')
if (pngSize(galaxy).join() !== `${CARD.width * 2},1560`) throw new Error(`galaxy capture is ${pngSize(galaxy).join(' x ')}`)
execFileSync('npx', ['tsx', join(here, 'brand/card-svg.ts'), svgDir], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
const composed = await compose(galaxy, svgDir)
// Six bits per channel, rounded (see the header), for the galaxy card; the starfield is lossless.
const SIX_BITS = "bitand(min(val+2\\,255)\\,252)"
const cards = {}
for (const [name, data] of Object.entries(composed)) {
  const full = join(out, `share-card-${name}-full.png`), file = join(out, `share-card-${name}.png`)
  writeFileSync(full, data)
  const vf = name === 'galaxy' ? ['-vf', `format=rgb24,lutrgb=r='${SIX_BITS}':g='${SIX_BITS}':b='${SIX_BITS}'`] : ['-vf', 'format=rgb24']
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', full, ...vf, '-compression_level', '100', '-pred', 'mixed', file])
  if (pngSize(file).join() !== `${CARD.width},${CARD.height}`) throw new Error(`${file} is ${pngSize(file).join(' x ')}`)
  cards[name] = file
}
const card = cards[cardChoice]

/** Both cards, drawn in a headless page's canvas from the generator's SVGs and the galaxy frame. */
async function compose(galaxyFile, dir) {
  const { chromium } = await import('playwright-core')
  const font = readFileSync(join(root, 'public/fonts/barlow-condensed-600-latin.woff2')).toString('base64')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', (route) => route.abort())
    const r = await page.evaluate(async ({ sky, mark, box, galaxy, font, W, H, y }) => {
      const img = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i }
      const svg = (s) => img(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`)
      const S = await svg(sky), M = await svg(mark), G = await img(`data:image/png;base64,${galaxy}`)
      const face = new FontFace('Mira', `url(data:font/woff2;base64,${font})`); await face.load(); document.fonts.add(face)
      const make = (onGalaxy) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')
        if (!onGalaxy) x.drawImage(S, 0, 0)
        else {
          x.drawImage(G, 0, 0, G.width, H * G.width / W, 0, 0, W, H)
          // The galaxy dimmed behind the mark only, the ellipse ending above the sun.
          x.save(); x.translate(box.x + box.width / 2, box.y + box.height / 2 - 20); x.scale(1, 0.62)
          const g = x.createRadialGradient(0, 0, 0, 0, 0, box.width * 0.72)
          g.addColorStop(0, 'rgba(3,6,11,0.5)'); g.addColorStop(0.6, 'rgba(3,6,11,0.375)'); g.addColorStop(1, 'rgba(3,6,11,0)')
          x.fillStyle = g; x.fillRect(-W, -W, 2 * W, 2 * W); x.restore()
          x.drawImage(M, 0, 0)
        }
        // generate.ts's tagline; over the galaxy a soft shadow keeps it clear of the rays.
        x.textAlign = 'center'; x.fillStyle = '#edf3ff'; x.font = '38px Mira'
        if (onGalaxy) { x.shadowColor = 'rgba(0,0,0,0.7)'; x.shadowBlur = 8 }
        x.fillText('Your galaxy awaits.', W / 2, y)
        return c.toDataURL('image/png').split(',')[1]
      }
      return { starfield: make(false), galaxy: make(true) }
    }, {
      sky: readFileSync(join(dir, 'sky.svg'), 'utf8'), mark: readFileSync(join(dir, 'mark.svg'), 'utf8'), box: JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8')),
      galaxy: readFileSync(galaxyFile).toString('base64'), font, W: CARD.width, H: CARD.height, y: TAGLINE_Y,
    })
    return { starfield: Buffer.from(r.starfield, 'base64'), galaxy: Buffer.from(r.galaxy, 'base64') }
  } finally { await browser.close() }
}

if (!options['card-only']) {
  console.log(`\nlobby still: ${join(still, 'lobby.jpg')} (${bytes(join(still, 'lobby.jpg'))} bytes), ${join(still, 'lobby-1600.webp')} (${bytes(join(still, 'lobby-1600.webp'))} bytes)`)
  if (!options['no-clip']) console.log(`dive clip: ${join(still, 'clip-dive.webp')} (${bytes(join(still, 'clip-dive.webp'))} bytes), ${join(still, 'clip-dive.mp4')}`)
}
for (const [name, file] of Object.entries(cards)) console.log(`share card ${name}: ${file} (${bytes(file)} bytes)`)

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

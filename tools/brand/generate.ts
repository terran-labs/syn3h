/** Explicit brand export. Ordinary builds use the committed platform fallbacks.
 * Run: npx tsx tools/brand/generate.ts [output-directory]
 * Requires installed Chrome, or SYN3H_CHROME pointing to a Chromium executable.
 * No bitmap inputs, network requests or game server required.
 */
import { chromium } from 'playwright-core'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logoSvg, LOGO_STILLS } from '../../src/ui/brand/LogoMark'

const directory = resolve(process.argv[2] ?? 'public/brand')
const font = (await readFile(new URL('../../public/fonts/barlow-condensed-600-latin.woff2', import.meta.url))).toString('base64')
const browser = await chromium.launch({
  ...(process.env.SYN3H_CHROME ? { executablePath: process.env.SYN3H_CHROME } : { channel: 'chrome' }),
  headless: true,
})
const files = new Map<string, Buffer>()
try {
  const page = await browser.newPage()
  await page.route('**/*', route => route.abort())
  for (const still of LOGO_STILLS) {
    if (still.name === 'favicon-32.png') continue
    const svg = logoSvg({ width: still.width, height: still.height, layout: still.layout, space: true })
    const encoded = await page.evaluate(async ({ svg, font, width, height, card }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      ctx.drawImage(image, 0, 0)
      if (card) {
        const face = new FontFace('Syn3h', `url(data:font/woff2;base64,${font})`)
        await face.load(); document.fonts.add(face)
        ctx.textAlign = 'center'; ctx.fillStyle = '#edf3ff'; ctx.font = '38px Syn3h'
        ctx.fillText('Your galaxy awaits.', width / 2, 492)
        ctx.fillStyle = '#a9bed9'; ctx.font = '23px Syn3h'
        ctx.fillText('From the creator of Mars Explorer', width / 2, 550)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    }, { svg, font, width: still.width, height: still.height, card: still.layout === 'card' })
    const data = Buffer.from(encoded, 'base64')
    if (data.readUInt32BE(16) !== still.width || data.readUInt32BE(20) !== still.height) throw new Error(`Wrong size: ${still.name}`)
    files.set(still.name, data)
  }
  files.set('favicon.svg', Buffer.from(logoSvg({ width: 32, height: 32, layout: 'icon', space: true })))
} finally { await browser.close() }
// Rendering must finish before any existing fallback is replaced.
await mkdir(directory, { recursive: true })
for (const [name, data] of files) {
  const target = resolve(directory, name), temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, target)
  console.log(`${name}: ${data.length} bytes`)
}

/**
 * The social share card, generated at build time rather than tracked (AGENTS.md: generate it,
 * do not ship it). The owner's card of 25 November 2026: the earlier cards' black silhouette and
 * warm gold glow on their own dark starfield, drawn by their own generator (logoSvg's 'card'
 * layout, through tools/brand/card-svg.ts), so mark, glow and sky are pixel for pixel the earlier
 * card's, with "Your galaxy awaits." under it in generate.ts's face and colour (Barlow Condensed
 * 600, #edf3ff) at TAGLINE_SIZE, vertically centred in the space below the logo: the text's
 * optical centre (the mean of its cap-height and x-height middles, measured from the font) sits
 * midway between the bottom edge and where the glow fades out (the first row under the mark
 * where the mark-and-glow layer alone is nowhere more than 4/255 opaque).
 *
 * The rasteriser is the installed Chrome through playwright-core, as for every brand export
 * (tools/brand/generate.ts); MIRA_CHROME names another Chromium. The pixels go to an RGB PNG
 * encoded here with zlib, so the same inputs give the same bytes, and the file is named by them.
 *
 *   import { renderShareCard } from './tools/brand/share-card.mjs'
 *   const { png, name } = await renderShareCard()   // name: share-<8 hex of sha256>.png
 *
 * The build (shareCard in vite.config.ts) emits it as dist/brand/<name> and points index.html's
 * og:image and twitter:image at it. The game itself never requests it; only link crawlers do.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const CARD = { width: 1200, height: 630 }
/** The owner's choice of 25 November 2026 (the earlier cards had 38). */
export const TAGLINE_SIZE = 66
export const TAGLINE = 'Your galaxy awaits.'
/** The name index.html carries in the source; the build replaces it with the hashed name. */
export const SOURCE_NAME = 'share-card.png'

/** Point og:image and twitter:image at the card named `name`, keeping their absolute form. */
export function pointAtCard(html, name) {
  let count = 0
  const out = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content="https:\/\/mira\.cc\/brand\/)[^"]+(")/g, (_, a, b) => { count++; return `${a}${name}${b}` })
  if (count !== 2) throw new Error(`share card: expected one og:image and one twitter:image in index.html, found ${count}`)
  return out
}

/** RGBA pixels to an RGB PNG: per-row adaptive filtering, zlib level 9. Deterministic. */
export function encodePng(rgba, width, height) {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride)
    for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) row[x * 3 + c] = rgba[(y * width + x) * 4 + c]
    let best = null, bestCost = Infinity
    for (let f = 0; f < 5; f++) {
      const line = Buffer.alloc(stride); let cost = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        const v = (row[i] - pred) & 255; line[i] = v; cost += v < 128 ? v : 256 - v
      }
      if (cost < bestCost) { bestCost = cost; best = [f, line] }
    }
    raw[y * (stride + 1)] = best[0]; best[1].copy(raw, y * (stride + 1) + 1)
    prev = row
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Render the card. Returns its PNG bytes, its hashed file name and where the tagline sits. */
export async function renderShareCard({ size = TAGLINE_SIZE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mira-share-card-'))
  let browser
  try {
    execFileSync('npx', ['tsx', join(root, 'tools/brand/card-svg.ts'), dir], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({ ...(process.env.MIRA_CHROME ? { executablePath: process.env.MIRA_CHROME } : { channel: 'chrome' }), headless: true })
    const page = await browser.newPage()
    await page.route('**/*', (route) => route.abort())
    const font = readFileSync(join(root, 'public/fonts/barlow-condensed-600-latin.woff2')).toString('base64')
    const r = await page.evaluate(async ({ sky, mark, box, font, W, H, size, text }) => {
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
      x.textAlign = 'center'; x.fillStyle = '#edf3ff'; x.fillText(text, W / 2, baseline)
      const px = x.getImageData(0, 0, W, H).data
      let bin = ''; for (let k = 0; k < px.length; k += 0x8000) bin += String.fromCharCode(...px.subarray(k, k + 0x8000))
      return { rgba: btoa(bin), glowEnd, baseline, width: x.measureText(text).width }
    }, { sky: readFileSync(join(dir, 'sky.svg'), 'utf8'), mark: readFileSync(join(dir, 'mark.svg'), 'utf8'), box: JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8')), font, W: CARD.width, H: CARD.height, size, text: TAGLINE })
    const png = encodePng(Buffer.from(r.rgba, 'base64'), CARD.width, CARD.height)
    const name = `share-${createHash('sha256').update(png).digest('hex').slice(0, 8)}.png`
    return { png, name, glowEnd: r.glowEnd, baseline: r.baseline, width: r.width }
  } finally {
    await browser?.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The build step: renders the card once per build, emits it as brand/<hashed name> and points
 * index.html's og:image and twitter:image at it. Build only; the dev server keeps the source name.
 */
export function shareCardAsset() {
  let card = null
  return {
    name: 'mira-share-card',
    apply: 'build',
    async buildStart() {
      const started = Date.now()
      card = await renderShareCard()
      this.info?.(`share card brand/${card.name}, ${card.png.length} bytes, ${Date.now() - started} ms`)
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.filename.replaceAll('\\', '/').endsWith('/index.html') || !card) return html
        return pointAtCard(html, card.name)
      },
    },
    generateBundle() {
      if (!card) throw new Error('share card: not rendered')
      this.emitFile({ type: 'asset', fileName: `brand/${card.name}`, source: card.png })
    },
  }
}

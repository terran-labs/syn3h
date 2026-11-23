// The lobby's galaxy is never black for a frame when the screen's height changes. Bug caught
// (the owner, on an iPhone, 22 November 2026: "flashing black screens"): the canvas was resized
// (which clears it) in a ResizeObserver callback and redrawn only on the next frame, so the
// cleared canvas was shown each time the address bar showed or hid. Before the fix 17 of 20
// such resizes in WebKit showed a black sky in the screenshot taken straight after.
//   MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-resize.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import sharp from 'sharp'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5173/'
for (const [name, engine] of [['webkit', webkit], ['chrome', chromium]]) {
  const browser = engine === chromium ? await engine.launch({ channel: 'chrome', headless: true }) : await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(`${base}?room=lobby-resize-${Date.now()}`)
    await page.waitForFunction(() => { const g = window.mira?.shell?.galaxy; return document.documentElement.dataset.boot === 'done' && g && !g.opening && !document.documentElement.dataset.opening }, null, { timeout: 180000 })
    await page.waitForTimeout(1000)
    for (let i = 0; i < 8; i++) {
      // An address bar's height, showing then hiding.
      await page.setViewportSize({ width: 390, height: i % 2 ? 844 : 764 })
      const shot = await page.screenshot(), { width, height } = await sharp(shot).metadata()
      // The top third is sky (stars, the name): no pixel lit means the canvas was cleared.
      const { data } = await sharp(shot).extract({ left: 0, top: 0, width, height: Math.round(height / 3) }).greyscale().raw().toBuffer({ resolveWithObject: true })
      assert.ok(Math.max(...data) >= 20, `${name}: the sky is black straight after resize ${i}`)
      await page.waitForTimeout(300)
    }
    console.log(`${name}: ok`)
  } finally { await browser.close() }
}

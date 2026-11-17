// A phone opened in landscape and turned upright: the lobby's name must not become a pale box.
// The logo box grows on the turn, so the full-resolution wordmark pass (WordmarkCrisp) rebakes
// its distance field on a later frame. That bake once ran under the pass's own scissor, baked
// nothing, and the zeroed field drew a translucent box over the letters (seen on an iPhone).
// Checks the rebaked field itself: its corner texel is far outside every letter, never 0.
//   SYN3H_URL=http://127.0.0.1:5193/ node tests/ui/wordmark-rotate.mjs
import { webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const browser = await webkit.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 874, height: 402 }, deviceScaleFactor: 3, hasTouch: true })).newPage()
  await page.goto(process.env.SYN3H_URL ?? 'http://127.0.0.1:5193/')
  await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.syn3h?.shell?.galaxy?.markCrisp?.field?.bakes > 0, null, { timeout: 120000 })
  const bakes = await page.evaluate(() => window.syn3h.shell.galaxy.markCrisp.field.bakes)
  await page.setViewportSize({ width: 402, height: 874 })
  await page.waitForFunction(n => window.syn3h.shell.galaxy.markCrisp?.field?.bakes > n, bakes, { timeout: 20000 })
  const corner = await page.evaluate(() => {
    const crisp = window.syn3h.shell.galaxy.markCrisp, gl = crisp.gl, field = crisp.field
    gl.bindFramebuffer(gl.FRAMEBUFFER, field.framebuffer)
    const float = field.precise, out = float ? new Float32Array(4) : new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, out)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return float ? out[0] : out[0] / 255
  })
  // At least the field's 0.3 pad as a half-float distance, or 1 on the 8-bit curve; an unbaked field reads 0.
  assert.ok(corner > 0.2, `rebaked field corner should be far outside the letters, got ${corner}`)
  console.log('WORDMARK ROTATE OK', corner)
} finally { await browser.close() }

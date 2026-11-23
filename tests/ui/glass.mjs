// CSS fallback regression: dark backing must win over every glass weight.
// Run through tools/heavy.sh. No game or room server required.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright-core'
const css = await readFile(new URL('../../src/ui/inspector/inspector.css', import.meta.url), 'utf8') + await readFile(new URL('../../src/ui/exploration.css', import.meta.url), 'utf8')
for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await engine.launch({ headless: true, ...options })
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>${css}</style><main class="mira-shell exploration-ui" data-glass="0"><div class="wi-glass">Readable controls</div></main>`)
    for (const level of ['2', '0']) for (const glass of ['0', '1', '2']) {
      const result = await page.evaluate(({ level, glass }) => {
        document.documentElement.dataset.gfx = level
        document.querySelector('main').dataset.glass = glass
        const style = getComputedStyle(document.querySelector('.wi-glass'))
        return { body: style.getPropertyValue('--body').trim(), filter: style.backdropFilter || style.webkitBackdropFilter,
          safari: CSS.supports('font', '-apple-system-body') && CSS.supports('-webkit-appearance', 'none') }
      }, { level, glass })
      if (level === '0' || result.safari) {
        const alpha = Number(result.body.match(/\/\s*([.\d]+)/)?.[1])
        assert.ok(alpha >= 0.8, `${name} level ${level} glass ${glass}: ${JSON.stringify(result)}`)
      }
      if (level === '0') assert.equal(result.filter, 'none')
    }
    console.log(`${name}: all glass weights preserve fallback legibility`)
  } finally { await browser.close() }
}

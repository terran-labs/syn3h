// A browser with no GPU at all: Chrome with --disable-gpu --disable-software-rasterizer has
// neither WebGPU nor a WebGL 2 context. Bug caught: the player saw "Mira failed to start:
// Cannot read properties of null (reading 'getSupportedExtensions')" and a Reload that could
// not help. They must see the plain message with steps they can take, and no raw error text.
//
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/no-graphics.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { waitForState } from './stateWait.mjs'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/no-graphics'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--disable-software-rasterizer'] })
try {
  for (const [name, query, viewport] of [['desktop', '', { width: 1280, height: 800 }], ['phone-webgl', 'webgl=1', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`${base}?room=no-graphics-${name}-${Date.now()}${query ? `&${query}` : ''}`)
    await waitForState(page, 'the start-failure notice', () => document.getElementById('fatal')?.dataset.failure, undefined, 120)
    const shown = await page.evaluate(() => {
      const fatal = document.getElementById('fatal')
      return { kind: fatal.dataset.failure, text: document.body.innerText, buttons: [...fatal.querySelectorAll('button')].map(b => b.textContent), details: fatal.querySelector('details pre')?.textContent ?? '' }
    })
    await page.screenshot({ path: `${out}/${name}.png` })
    assert.equal(shown.kind, 'no-graphics', `${name}: the no-graphics notice`)
    assert.match(shown.text, /can’t draw on this browser or device/, `${name}: the plain message`)
    assert.match(shown.text, /hardware acceleration/, `${name}: what a person can do`)
    assert.deepEqual(shown.buttons, [], `${name}: no Reload where reloading cannot help`)
    // The raw error is behind Details (closed, so not in the page's visible text) and in the console.
    assert.doesNotMatch(shown.text, /getSupportedExtensions|failed to start|Cannot read properties/, `${name}: no raw error text on screen`)
    assert.ok(shown.details.length > 0, `${name}: the technical detail is kept behind Details`)
    console.log(`${name}: ${shown.kind} PASS (details: ${shown.details})`)
    await page.close()
  }
} finally { await browser.close() }

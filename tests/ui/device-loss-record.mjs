// A lost GPU device leaves its evidence for the next page (src/core/lossRecord.ts). Bug caught: the
// owner's iPhone lost the WebGPU device several times a day and the page asked him to reload, which
// threw the evidence away; a loss must write its record before the notice, keep the browser's
// reason and message as given, and the reloaded page's Diagnostics must carry it.
// The loss is forced with device.destroy() from the page, as a GPU process crash would end it.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/device-loss-record.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`${base}?autoplay=1&room=loss-${Date.now()}`)
  await waitForState(page, 'the world running', () => window.mira?.game?.tick > 30, undefined, 180)
  const backend = await page.evaluate(() => window.mira.game.backend)
  if (backend !== 'webgpu') { console.log(`skipped: this browser started ${backend}, and the record is for WebGPU device loss`); process.exit(0) }
  // A few seconds of play, so the record has a quality step or a view change to show.
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.mira.game.renderer.backend.device.destroy())
  await waitForState(page, 'the device-lost notice', () => !!document.getElementById('mira-device-lost'), undefined, 20)
  const notice = await page.evaluate(() => document.getElementById('mira-device-lost').textContent)
  assert.match(notice, /Reload to keep playing/, notice)
  const record = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mira.lastDeviceLoss')))
  assert.ok(record, 'a record was written before the notice')
  assert.equal(record.reason, 'destroyed')
  assert.equal(record.weDisposed, false, 'we did not dispose the renderer')
  assert.equal(record.api, 'WebGPU')
  assert.ok(record.commandBuffers && record.commandBuffers.submitted > 0, 'command buffers counted')
  assert.ok(record.memory && record.memory.textures > 0, "three's counts kept")
  // The page asks for a reload: the next page carries the record in its Diagnostics.
  await page.reload()
  await waitForState(page, 'the reloaded world', () => window.mira?.game?.lossRecorder, undefined, 180)
  const lines = await page.evaluate(() => window.mira.game.lossRecorder.reportLines().join('\n'))
  assert.match(lines, /Device loss on the previous page in this tab/)
  assert.match(lines, /reason 'destroyed', message .*, we did not dispose/)
  assert.match(lines, /command buffers: \d+ encoders/)
  console.log(`notice: ${notice}`)
  console.log(lines.split('\n').filter(l => /previous page|reason|command buffers/.test(l)).join('\n'))
  console.log('ok')
} finally { await browser.close() }

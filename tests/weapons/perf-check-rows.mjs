/**
 * Runs the in-game performance check (Performance, Run performance check) in a headless browser
 * with four bots, and prints its report. Evidence, not a test: read the G/P column of the gear
 * rows (Thunder burst, Laser hits, Grapple), which must be 0/0. Exits 1 only if the check could
 * not run or did not complete.
 *
 *   npx vite build && (MIRA_ROOM_PORT=<room> npx vite preview --port <port> &) && (PORT=<room> npm run server &)
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/perf-check-rows.mjs [out file]
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.MIRA_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.MIRA_URL) throw new Error('Set MIRA_URL')
const out = process.argv[2] ?? '/tmp/weapons-beauty/perf-check.txt'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?autoplay=1&room=perf-rows-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.shell?.playing && !window.mira.game.input.suspended && window.miraNet?.id, null, { timeout: 180000 })
  await page.evaluate(() => { const p = window.mira.params; if (p.get('bots.keepCount')) p.set('bots.keepCount', true); p.set('bots.count', 4) })
  await page.waitForFunction(() => window.mira.bots.vehicles.length === 4, null, { timeout: 90000 })
  await page.waitForTimeout(5000)
  const text = await page.evaluate(() => window.mira.shell.performancePanel.source.runPerformanceCheck(new AbortController().signal))
  await writeFile(out, text)
  console.log(text.split('\n').filter(l => /^(Mira performance check|Local step|Thunder burst|Laser hits|Chaser|Yoink gust|Grapple|Quality at entry)/.test(l)).join('\n'))
  if (errors.length) console.log('page errors:', errors.slice(0, 3))
  if (!/\| Complete \|/.test(text.split('\n')[0])) process.exit(1)
} finally { await browser.close() }

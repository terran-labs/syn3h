/**
 * Startup profile: where the time to the first frame goes.
 *
 *   tools/heavy.sh node tools/startup-profile.mjs URL [options]
 *
 * Options:
 *   --browser chrome|webkit   default chrome (the system Chrome channel, as smoke.mjs uses)
 *   --runs N                  cold runs, each in a fresh context with an empty cache (default 3)
 *   --warm N                  reloads in the last cold context, so the HTTP cache is warm (default 1)
 *   --cpu N                   Chrome only: CDP CPU throttling factor (default 1)
 *   --latency MS              Chrome only: added round trip latency per request (default 0)
 *   --down KBPS               Chrome only: download throughput in kilobits per second (default unlimited)
 *   --shots DIR               screenshots of what the player sees at 0.5, 1, 2, 4, 8, 16, 32 seconds
 *   --json FILE               write every run as JSON
 *   --label TEXT              a name for this configuration in the printed table
 *
 * Reads window.miraStartup (src/core/diagnostics.ts). It loads the lobby as a player would,
 * without ?autoplay, and closes the room socket so no room server is needed. The load
 * average is printed with every configuration because the machine is shared.
 */
import { chromium, webkit } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'

const args = process.argv.slice(2)
const url = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'http://127.0.0.1:5210/'
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const browserName = opt('browser', 'chrome')
const runs = Number(opt('runs', 3)), warm = Number(opt('warm', 1)), cpu = Number(opt('cpu', 1))
const latency = Number(opt('latency', 0)), down = Number(opt('down', 0))
const shots = opt('shots'), jsonOut = opt('json')
const label = opt('label', `${browserName} cpu${cpu}x lat${latency}ms${down ? ` ${down}kbps` : ''}`)
const DONE = 'frame 1 render end to next animation frame'

const browser = browserName === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })

const sep = url.includes('?') ? '&' : '?'
const results = []
const load0 = loadavg()[0]

async function measure(page, kind, index, shotDir) {
  const responses = []
  const onResponse = async response => {
    const request = response.request()
    let bytes = Number(response.headers()['content-length'] ?? 0)
    try { const sizes = await request.sizes(); bytes = sizes.responseBodySize + sizes.responseHeadersSize } catch {}
    responses.push({ url: response.url(), status: response.status(), bytes, type: request.resourceType() })
  }
  page.on('response', onResponse)
  const started = Date.now()
  const target = `${url}${sep}room=startup-${Date.now()}-${index}`
  if (kind === 'cold') await page.goto(target, { waitUntil: 'commit', timeout: 180000 })
  else await page.reload({ waitUntil: 'commit', timeout: 180000 })
  const shotTimes = shotDir ? [500, 1000, 2000, 4000, 8000, 16000, 32000] : []
  const shotFiles = []
  let finished = false
  const wait = page.waitForFunction(name => window.miraStartup ? window.miraStartup.phases.some(p => p.name === name) : window.mira?.game?.performance?.firstFrameMs > 0, DONE, { timeout: 180000, polling: 100 }).then(() => { finished = true })
  for (const t of shotTimes) {
    const delay = started + t - Date.now()
    if (delay > 0) await Promise.race([wait, new Promise(r => setTimeout(r, delay))])
    if (finished) break
    const file = `${shotDir}/${label.replace(/\W+/g, '-')}-${kind}${index}-${t}ms.png`
    await page.screenshot({ path: file }).catch(() => {})
    shotFiles.push(file)
  }
  await wait
  await page.waitForTimeout(300)
  if (shotDir) { const file = `${shotDir}/${label.replace(/\W+/g, '-')}-${kind}${index}-first-frame.png`; await page.screenshot({ path: file }); shotFiles.push(file) }
  page.off('response', onResponse)
  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const veil = document.documentElement.dataset.boot
    return {
      timing: window.miraStartup,
      firstDrawSubmittedMs: window.mira?.game?.performance?.firstFrameMs ?? null,
      backend: window.mira?.game?.backend,
      nav: nav ? { responseEnd: nav.responseEnd, domContentLoaded: nav.domContentLoadedEventEnd } : null,
      resources: resources.length,
      transfer: resources.reduce((s, r) => s + (r.transferSize || 0), 0),
      decoded: resources.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
      lastResourceEnd: resources.reduce((m, r) => Math.max(m, r.responseEnd), 0),
      veil,
    }
  })
  const largest = [...responses].sort((a, b) => b.bytes - a.bytes).slice(0, 6).map(r => `${(r.bytes / 1024).toFixed(0)} KB ${r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`)
  return { kind, index, label, load: loadavg()[0], requests: responses.length, responseBytes: responses.reduce((s, r) => s + r.bytes, 0), largest, shots: shotFiles, ...data }
}

try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true })
    const page = await context.newPage()
    await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    if (browserName === 'chrome') {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      if (latency || down) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: down ? down * 1024 / 8 : -1, uploadThroughput: down ? down * 1024 / 8 : -1 })
      if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
    }
    if (shots) await mkdir(shots, { recursive: true })
    results.push(await measure(page, 'cold', i, i === 0 ? shots : undefined))
    if (i === runs - 1) for (let w = 0; w < warm; w++) results.push(await measure(page, 'warm', w))
    await context.close()
  }
} finally { await browser.close() }

const median = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : NaN }
const table = kind => {
  const set = results.filter(r => r.kind === kind)
  if (!set.length) return ''
  const names = []
  for (const r of set) for (const p of r.timing?.phases ?? []) if (!names.includes(p.name)) names.push(p.name)
  const first = median(set.map(r => r.firstDrawSubmittedMs))
  const rows = names.map(name => {
    const ms = median(set.map(r => r.timing?.phases.find(p => p.name === name)?.ms))
    const start = median(set.map(r => r.timing?.phases.find(p => p.name === name)?.startMs))
    return `| ${name} | ${start.toFixed(0)} | ${ms.toFixed(0)} | ${(100 * ms / first).toFixed(0)}% |`
  })
  const r0 = set[0]
  return [
    `### ${label}, ${kind} (${set.length} run${set.length > 1 ? 's' : ''}), load ${set.map(r => r.load.toFixed(1)).join('/')}, backend ${r0.backend}`,
    '',
    `firstDrawSubmittedMs median ${first.toFixed(0)} (runs ${set.map(r => r.firstDrawSubmittedMs?.toFixed(0)).join(', ')}); requests ${median(set.map(r => r.requests))}, resource entries ${median(set.map(r => r.resources))}, transferred ${(median(set.map(r => r.transfer)) / 1024).toFixed(0)} KB (response sizes ${(median(set.map(r => r.responseBytes)) / 1024).toFixed(0)} KB), last resource ends ${median(set.map(r => r.lastResourceEnd)).toFixed(0)} ms`,
    r0.timing?.pipelines ? `pipelines after 3 frames: ${JSON.stringify(r0.timing.pipelines)}` : '',
    '',
    '| Phase | Starts at ms | Takes ms | Share of first draw |',
    '|---|---:|---:|---:|',
    ...rows,
    '',
    'Largest responses (first run):',
    ...r0.largest.map(l => `- ${l}`),
    '',
  ].join('\n')
}
console.log(`load average at start ${load0.toFixed(2)}, end ${loadavg()[0].toFixed(2)}`)
console.log(table('cold'))
console.log(table('warm'))
if (results[0]?.shots?.length) console.log(`screenshots:\n${results[0].shots.join('\n')}`)
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ url, label, load0, results }, null, 2))

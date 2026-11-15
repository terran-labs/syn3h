import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto(process.argv[2], { waitUntil: 'load' })
await p.waitForFunction(() => window.syn3h?.game?.time > 4, null, { timeout: 120000 })
console.log(JSON.stringify(await p.evaluate(async () => { const { params } = await import('/shared/params.ts'); return ['world.seaKind','water.waves','water.sinking','water.underwater','water.ripples','water.spray'].map((i) => params.get(i)?.value) })))
await b.close()

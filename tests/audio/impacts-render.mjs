// Renders every impact sound offline in real Chromium and checks each is audible, does not
// clip, and differs from the others the way its material should. Then checks the vehicle
// lab's Motor sound switch and bump buttons. Writes one WAV of every sound to listen to.
// Needs a dev server:  node tests/audio/impacts-render.mjs [http://127.0.0.1:5188]
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${origin}/vehicle-lab.html?vehicle=game-buggy`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 120000 })

  const result = await page.evaluate(async () => {
    const { SURFACES, synthImpact } = await import('/src/audio/Impacts.ts')
    const rate = 44100, seconds = 2
    const render = async impact => {
      const context = new OfflineAudioContext(1, rate * seconds, rate)
      synthImpact(context, context.destination, impact)
      const data = (await context.startRendering()).getChannelData(0)
      let peak = 0, square = 0, slope = 0, bad = 0, last = 0
      for (let i = 0; i < data.length; i++) { const v = data[i]; if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); square += v * v; if (i) slope += (v - data[i - 1]) ** 2; if (Math.abs(v) > 0.003) last = i }
      // `bright` is where the energy sits, in Hz; `length` is when it last rose above a whisper.
      return { data, peak, rms: Math.sqrt(square / data.length), bright: Math.sqrt(slope / square) * rate / (2 * Math.PI), length: last / rate, bad }
    }
    const out = {}, all = []
    for (const kind of ['vehicle', ...SURFACES]) for (const strength of [0.15, 0.9]) {
      const r = await render({ kind, strength, hull: 'buggy', seed: 7 })
      all.push(r.data)
      out[`${kind} ${strength}`] = { peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), bright: Math.round(r.bright), length: +r.length.toFixed(2), bad: r.bad }
    }
    for (const hull of ['tank', 'hovercraft', 'jet']) { const r = await render({ kind: 'vehicle', strength: 0.9, hull, seed: 7 }); all.push(r.data); out[`vehicle ${hull}`] = { peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), bright: Math.round(r.bright), length: +r.length.toFixed(2), bad: r.bad } }
    // One file with every sound in order, for listening.
    const total = all.reduce((n, d) => n + d.length, 0), bytes = new ArrayBuffer(44 + total * 2), view = new DataView(bytes)
    const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
    text(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, total * 2, true)
    let at = 44; for (const d of all) for (const v of d) { view.setInt16(at, Math.max(-1, Math.min(1, v)) * 32767, true); at += 2 }
    const u8 = new Uint8Array(bytes); let b = ''; for (let i = 0; i < u8.length; i += 32768) b += String.fromCharCode(...u8.subarray(i, i + 32768))
    return { out, wav: btoa(b) }
  })
  await mkdir('tests/audio/artifacts', { recursive: true })
  await writeFile('tests/audio/artifacts/impacts.wav', Buffer.from(result.wav, 'base64'))
  const r = result.out
  for (const [name, v] of Object.entries(r)) console.log(name.padEnd(20), `peak ${v.peak}  rms ${v.rms}  bright ${String(v.bright).padStart(5)} Hz  length ${v.length}s`)
  for (const [name, v] of Object.entries(r)) { assert.equal(v.bad, 0, name); assert.ok(v.peak > 0.05, `${name} is too quiet`); assert.ok(v.peak < 1, `${name} clips`) }
  for (const kind of ['vehicle', 'rock', 'sand', 'snow', 'ice', 'glass', 'dust', 'mud', 'soil']) {
    assert.ok(r[`${kind} 0.9`].rms > r[`${kind} 0.15`].rms * 1.8, `a harder ${kind} bump should be louder`)
    assert.ok(r[`${kind} 0.9`].length >= r[`${kind} 0.15`].length, `a harder ${kind} bump should not be shorter`)
  }
  const bright = kind => r[`${kind} 0.9`].bright
  assert.ok(bright('glass') > bright('rock') && bright('ice') > bright('rock'), 'glass and ice should be the brightest')
  assert.ok(bright('dust') < bright('soil') && bright('dust') < bright('sand'), 'moon dust should be the dullest')
  assert.ok(bright('rock') > bright('mud') * 2 && bright('rock') > bright('soil') * 2, 'rock should crack where mud and soil thud')
  assert.ok(r['vehicle 0.9'].length > r['rock 0.9'].length, 'metal should ring longer than rock')
  assert.ok(r['vehicle tank'].bright < r['vehicle 0.9'].bright && r['vehicle jet'].bright > r['vehicle tank'].bright, 'a tank should clang lower than a buggy or a jet')

  // The lab: a real click starts the motor, the voice follows the vehicle, the bump buttons play.
  await page.locator('label.toggle', { hasText: 'Motor sound' }).locator('input').click()
  await page.waitForFunction(() => vehicleLab.motor?.state === 'running')
  assert.equal(await page.evaluate(() => vehicleLab.motor.kind), 'buggy')
  const voices = {}
  for (const vehicle of ['game-jet', 'game-hovercraft', 'game-tank', 'tank', 'hover', 'buggy']) {
    await page.evaluate(v => vehicleLab.select(v), vehicle)
    await page.waitForFunction(v => vehicleLab.exhibit === v, vehicle, { timeout: 60000 })
    await page.waitForTimeout(300)
    voices[vehicle] = await page.evaluate(() => vehicleLab.motor.kind)
  }
  console.log('motor voices', voices)
  assert.deepEqual(voices, { 'game-jet': 'jet', 'game-hovercraft': 'hovercraft', 'game-tank': 'tank', tank: 'tank', hover: 'hovercraft', buggy: 'buggy' })
  const buttons = await page.locator('.sec', { hasText: 'Bump sounds' }).locator('button').allTextContents()
  console.log('bump buttons', buttons.join(', '))
  assert.equal(buttons.length, 9)
  await page.locator('button', { hasText: 'Another vehicle' }).click(); await page.locator('button', { hasText: 'Glass' }).click()
  assert.equal(await page.evaluate(() => vehicleLab.bumps), 2)
  await page.screenshot({ path: 'tests/audio/artifacts/vehicle-lab-sound.png' })
  assert.deepEqual(errors, [])
  console.log('impacts ok')
} finally { await browser.close() }

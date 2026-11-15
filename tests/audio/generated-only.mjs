// The owner's rule of 15 November 2026 in a real browser: no audio file is requested, the
// lobby has audible generated music from the first gesture, the three former recordings are
// synthesised and clean up after themselves, and the score survives main-thread stalls.
//
//   node tests/audio/generated-only.mjs            (expects the game on SYN3H_URL)
//
// Writes tests/audio/artifacts/generated-only.json with the measured levels and timings.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5198/'
const AUDIO_FILE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|weba)(\?|$)/i
/** Lowest acceptable lobby music level, RMS dBFS averaged over the listening window. */
const LOBBY_FLOOR = Number(process.env.LOBBY_FLOOR ?? -27)
await mkdir('tests/audio/artifacts', { recursive: true })
const report = {}
// Energy-average the output level for a while. The tab must stay visible: the score rests when hidden.
const listen = (page, ms) => page.evaluate(async ms => {
  const levels = []
  for (const end = performance.now() + ms; performance.now() < end;) { levels.push(syn3h.audio.outputLevel); await new Promise(r => setTimeout(r, 100)) }
  const power = levels.map(db => 10 ** (db / 10))
  return { mean: 10 * Math.log10(power.reduce((a, b) => a + b, 0) / power.length), peak: Math.max(...levels), quietest: Math.min(...levels), samples: levels.length }
}, ms)
for (const mode of (process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone'])) {
  const browser = await (mode === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch())
  try {
    const page = await browser.newPage(mode === 'desktop' ? { viewport: { width: 1440, height: 1000 } } : devices['iPhone 14'])
    const errors = [], audioRequests = []
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('request', r => { if (AUDIO_FILE.test(r.url()) || /\/audio\//.test(new URL(r.url()).pathname) && !/\/src\/audio\//.test(r.url())) audioRequests.push(r.url()) })
    await page.addInitScript(() => {
      localStorage.setItem('syn3h.musicTrack', 'Classic') // a choice saved by an older build
      window.__long = []
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push({ at: e.startTime, ms: e.duration }) }).observe({ entryTypes: ['longtask'] }) } catch { /* WebKit has no longtask entries. */ }
    })
    await page.goto(`${base}?room=ux-audio-${mode}-${Date.now()}`)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    assert.equal(await page.evaluate(() => syn3h.audio.state), 'locked', 'no audio before a gesture')
    await page.waitForTimeout(1500) // idle time: the mix is built ahead of the gesture
    assert.equal(await page.evaluate(() => localStorage.getItem('syn3h.musicTrack')), null, 'the retired track choice is cleared')
    assert.equal(await page.locator('#shell-track, .rail-music select').count(), 0, 'no track selector remains')
    // The first gesture, in the lobby. Shift changes nothing else on the page.
    const first = await page.evaluate(() => performance.now())
    await page.keyboard.press('Shift')
    await page.waitForFunction(() => syn3h.audio.state === 'running', null, { timeout: 20000 })
    const running = await page.evaluate(() => performance.now())
    await page.waitForFunction(() => syn3h.audio.outputLevel > -50, null, { timeout: 20000 })
    const audible = await page.evaluate(() => performance.now())
    const unlock = await page.evaluate(first => ({ cost: { ...syn3h.audio.unlockCost }, longTasks: window.__long.filter(t => t.at >= first - 5 && t.at < first + 3000) }), first)
    await page.waitForTimeout(2500) // past the fade in
    const lobby = await listen(page, 8000)
    console.log(`${mode}: lobby level ${JSON.stringify(lobby)}, unlock ${JSON.stringify(unlock)}, audible after ${Math.round(audible - first)} ms`)
    const lobbyScore = await page.evaluate(() => ({ ...syn3h.audio.diagnostics.score, enabled: syn3h.audio.enabled }))
    assert.equal(lobbyScore.playing, true); assert.equal(lobbyScore.enabled, false, 'still in the lobby')
    assert.ok(lobby.mean >= LOBBY_FLOOR, `lobby music is audible: ${lobby.mean.toFixed(1)} dBFS, floor ${LOBBY_FLOOR}`)
    assert.ok(lobby.peak < -1, `lobby does not clip: ${lobby.peak.toFixed(1)} dBFS`)
    // The former recordings, synthesised: each plays, is audible and removes its graph.
    const cues = {}
    for (const [sound, wait, options] of [['laserShot', 450], ['laserHit', 800], ['materialize', 2800], ['materialize', 4800, { seconds: 3 }]]) {
      cues[options ? `${sound} ${options.seconds}s` : sound] = await page.evaluate(async ([sound, wait, options]) => {
        const before = syn3h.audio.diagnostics.oneShots, music = syn3h.params.get('audio.music').value
        syn3h.params.set('audio.music', 0); await new Promise(r => setTimeout(r, 400)) // hear the cue alone
        syn3h.audio.play(sound, undefined, options)
        const during = syn3h.audio.diagnostics.oneShots; let peak = -Infinity
        for (const end = performance.now() + wait; performance.now() < end;) { peak = Math.max(peak, syn3h.audio.outputLevel); await new Promise(r => setTimeout(r, 20)) }
        syn3h.params.set('audio.music', music)
        return { before, during, after: syn3h.audio.diagnostics.oneShots, peak }
      }, [sound, wait, options])
    }
    for (const [name, c] of Object.entries(cues)) {
      assert.equal(c.during, c.before + 1, `${name} started`); assert.equal(c.after, c.before, `${name} released its nodes`)
      assert.ok(c.peak > -45 && c.peak < -3, `${name} is audible and does not clip: ${c.peak.toFixed(1)} dBFS`)
    }
    // Enter the world and listen to the mix in ordinary play.
    // By now the idle lobby may be in its attract tour, so start play the way Return to Game does.
    await page.evaluate(() => syn3h.shell.play())
    await page.waitForFunction(() => syn3h.shell.playing && !syn3h.shell.dropping, null, { timeout: 120000 })
    await page.waitForTimeout(3000)
    const solo = await listen(page, 8000)
    console.log(`${mode}: solo level ${JSON.stringify(solo)}, cues ${JSON.stringify(cues)}`)
    assert.ok(solo.mean >= LOBBY_FLOOR - 3, `solo play is audible: ${solo.mean.toFixed(1)} dBFS`)
    // Stalls. A short one is covered by the lookahead; a long one restarts cleanly, once.
    const stall = await page.evaluate(async () => {
      const block = ms => { const end = performance.now() + ms; while (performance.now() < end); }
      const settle = () => new Promise(r => setTimeout(r, 600))
      await settle(); const start = syn3h.audio.diagnostics.score.stalls
      block(250); await settle(); const short = syn3h.audio.diagnostics.score.stalls
      block(1200); await settle(); const long = syn3h.audio.diagnostics.score.stalls
      await new Promise(r => setTimeout(r, 1500))
      return { short: short - start, long: long - short, levelAfter: syn3h.audio.outputLevel, playing: syn3h.audio.diagnostics.score.playing }
    })
    assert.equal(stall.short, 0, 'a 250 ms stall drops no notes')
    assert.ok(stall.long <= 1, 'a long stall restarts once, with no catch-up burst')
    assert.ok(stall.playing && stall.levelAfter > -45, `music continues after a long stall: ${stall.levelAfter.toFixed(1)} dBFS`)
    assert.deepEqual(audioRequests, [], 'no audio file is requested')
    assert.deepEqual(await page.evaluate(() => syn3h.audio.errors), [])
    assert.deepEqual(errors, [])
    report[mode] = { firstGestureToRunningMs: Math.round(running - first), firstGestureToAudibleMs: Math.round(audible - first), unlock, lobby, lobbyScore: { mode: lobbyScore.mode, tempo: lobbyScore.tempo, mood: lobbyScore.mood }, solo, cues, stall, audioRequests: audioRequests.length }
    console.log(`${mode}: lobby ${lobby.mean.toFixed(1)} dBFS, solo ${solo.mean.toFixed(1)} dBFS, audible ${Math.round(audible - first)} ms after the first gesture, no audio files requested`)
  } finally {
    await writeFile('tests/audio/artifacts/generated-only.json', JSON.stringify(report, null, 2))
    await browser.close()
  }
}

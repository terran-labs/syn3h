// Renders the adaptive score offline in real Chromium for each lab scene and checks that it
// is audible, unclipped and that the mood inputs change what comes out.
// Run a dev server first: SYN3H_NO_ROOM_SERVER=1 npx vite --port 5188, then
//   node tests/audio/score-render.mjs [http://127.0.0.1:5188]
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const scenes = ['Lobby', 'Parked', 'Cruise', 'Flat out', 'Tag chase', 'Soaring', 'Underwater', 'Lava field', 'Holding the hill', 'Contested hill']
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${origin}/score.html`)
  await mkdir('tests/audio/artifacts', { recursive: true })
  const report = {}
  for (const name of scenes) {
    const result = await page.evaluate(async name => {
      const { renderScene, wav } = await import('/src/audio/score/demo.ts')
      const started = performance.now(), r = await renderScene(name, 24)
      const bytes = new Uint8Array(wav(r.left, r.right, r.rate))
      let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768))
      const { left, right, ...rest } = r
      return { ...rest, renderMs: Math.round(performance.now() - started), wav: btoa(text) }
    }, name)
    await writeFile(`tests/audio/artifacts/score-${name.toLowerCase().replaceAll(' ', '-')}.wav`, Buffer.from(result.wav, 'base64'))
    delete result.wav
    report[name] = result
    console.log(name.padEnd(17), `peak ${result.peak.toFixed(2)}  rms ${result.rms.toFixed(3)}  width ${result.width.toFixed(3)}  bright ${Math.round(result.brightness)}  ${result.mode} ${Math.round(result.tempo)}bpm  ${result.renderMs}ms`)
  }
  await writeFile('tests/audio/artifacts/score-levels.json', JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [])
  for (const [name, r] of Object.entries(report)) {
    assert.equal(r.bad, 0, `${name}: non-finite samples`)
    assert.ok(r.rms > 0.02, `${name}: too quiet (${r.rms})`)
    assert.ok(r.peak < 1, `${name}: clips before the limiter (${r.peak})`)
    delete r.envelope; delete r.roles
    assert.ok(r.width > 0.005, `${name}: not stereo`)
  }
  const r = report
  assert.ok(r['Flat out'].rms > r.Parked.rms, 'speed should raise the level')
  assert.ok(r['Tag chase'].rms > r.Cruise.rms * 1.2, 'a tag chase should be heavier than a cruise')
  assert.ok(r.Underwater.brightness < r.Cruise.brightness * 0.7, 'submersion should muffle the mix')
  assert.equal(r['Tag chase'].mode, 'phrygian'); assert.equal(r['Lava field'].mode, 'phrygian'); // Taking off surges into a release, which arrives in the major.
  assert.equal(r.Soaring.mode, 'major')
  assert.ok(r['Tag chase'].tempo > r.Parked.tempo + 20, 'a tag chase should raise the tempo')
  // Each worklet instrument alone, in a release: it must sound, and the shimmer's feedback must not run away.
  for (const [layer, floor] of [['choir', 0.04], ['shimmer', 0.05], ['strings', 0.01], ['pluck', 0.01]]) {
    const solo = await page.evaluate(async layer => {
      const { renderScene } = await import('/src/audio/score/demo.ts')
      const r = await renderScene('Cruise', 30, 1234, 44100, 'surge', layer === 'shimmer' ? ['shimmer', 'pad', 'choir', 'bells'] : [layer])
      return { envelope: r.envelope, peak: r.peak, bad: r.bad }
    }, layer)
    const loud = Math.max(...solo.envelope), late = solo.envelope.slice(-5).reduce((a, b) => a + b, 0) / 5
    console.log(`solo ${layer.padEnd(8)} loudest second ${loud.toFixed(4)}  last five ${late.toFixed(4)}  peak ${solo.peak.toFixed(2)}`)
    assert.equal(solo.bad, 0); // The sub drop and the swell are not layers, so they set the loudest second; judge the layer by the sustained release that follows.
    assert.ok(late > floor, `${layer} is silent`); assert.ok(solo.peak < 1, `${layer} clips`)
  }
  // The lighter tier for phones plays the same passage: audible, unclipped, a release that still lands.
  const lite = await page.evaluate(async () => {
    const { renderScene } = await import('/src/audio/score/demo.ts')
    const r = await renderScene('Cruise', 30, 1234, 44100, 'surge', undefined, true)
    return { envelope: r.envelope, peak: r.peak, bad: r.bad, nodes: r.nodes }
  })
  const liteRelease = Math.max(...lite.envelope.slice(8, 20)), liteStart = lite.envelope[2]
  console.log(`lighter tier: ${lite.nodes} nodes, start ${liteStart.toFixed(3)}, release ${liteRelease.toFixed(3)}, peak ${lite.peak.toFixed(2)}`)
  assert.equal(lite.bad, 0); assert.ok(lite.peak < 1, 'the lighter tier clips'); assert.ok(liteRelease > liteStart * 1.2, 'the lighter tier should still land its release')
  // The modelled string must sound the pitch it is asked for.
  for (const hz of [130.81, 220, 440, 523.25]) {
    const pitch = await page.evaluate(async hz => (await import('/src/audio/score/demo.ts')).pluckPitch(hz), hz)
    const cents = 1200 * Math.log2(pitch.hz / hz)
    console.log(`pluck ${hz} Hz sounds ${pitch.hz.toFixed(2)} Hz (${cents.toFixed(1)} cents), level ${pitch.level.toFixed(3)}`)
    assert.ok(pitch.level > 0.01, 'the string should sound')
    assert.ok(Math.abs(cents) < 6, `the string is out of tune by ${cents.toFixed(1)} cents`)
  }
  // The arc: cue a build during a cruise and check the breath dips and the release lands above it.
  const arc = await page.evaluate(async () => {
    const { renderScene, wav } = await import('/src/audio/score/demo.ts')
    const r = await renderScene('Cruise', 60, 1234, 44100, 'climb')
    const bytes = new Uint8Array(wav(r.left, r.right, r.rate))
    let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return { envelope: r.envelope, roles: r.roles, peak: r.peak, wav: btoa(text) }
  })
  await writeFile('tests/audio/artifacts/score-arc.wav', Buffer.from(arc.wav, 'base64'))
  const landed = arc.roles.indexOf('release')
  console.log('arc', arc.roles.map((role, second) => `${second}:${role[0]}${arc.envelope[second].toFixed(2)}`).join(' '))
  assert.ok(landed > 10, 'the release should follow a build')
  const build = arc.envelope.slice(4, landed - 4), mean = build.reduce((a, b) => a + b, 0) / build.length
  const breath = Math.min(...arc.envelope.slice(landed - 3, landed + 1)), release = Math.max(...arc.envelope.slice(landed, landed + 6))
  console.log(`build ${mean.toFixed(3)}  breath ${breath.toFixed(3)}  release ${release.toFixed(3)}  peak ${arc.peak.toFixed(2)}`)
  assert.ok(breath < mean * 0.8, 'the breath should fall below the build')
  assert.ok(release > mean * 1.25, 'the release should land above the build')
  console.log('score render ok')
} finally { await browser.close() }

/**
 * Captures the `track` role on a test belt in the running game: a loop of quads round two
 * wheels, built here from the role's contract (u across the belt 0 to 1, v along it in metres),
 * beside a row of six belts drawn as one instanced mesh with a per-instance `trackScroll`. Near
 * and far, noon and night, at rest and scrolled half a lug, at shading tiers 1 and 3.
 *
 *   node tests/vehicles2/track-capture.mjs [baseUrl] [outDir] [extra query, e.g. &webgl]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5207/'
const out = process.argv[3] ?? '/tmp/syn3h-vehicles2/track'
const extra = process.argv[4] ?? ''
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
await page.goto(`${base}?autoplay=1&world=alpine.7~terrain.planetSize=0&room=trackcap${Date.now().toString(36)}${extra}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 90000 })

await page.evaluate(async () => {
  const s = window.syn3h, game = s.game, pl = s.player
  // The very module instance the game uses: the pre-bundled URL Vite gave showroom.ts.
  const served = await (await fetch('/src/vehicles/skins/showroom.ts')).text()
  const three = await import(served.match(/import \* as T from ["']([^"']*three_webgpu\.js[^"']*)["']/)[1])
  const { applyShowroom, setRole, TRACK_LUGS } = await import('/src/vehicles/skins/showroom.ts')
  const { addNightReadability } = await import('/src/vehicles/skins/nightReadability.ts')
  const { addLavaGlow } = await import('/src/vehicles/skins/lavaGlow.ts')
  const { vehicleShading } = await import('/src/core/quality.ts')
  const { Group, Mesh, InstancedMesh, BufferGeometry, BufferAttribute, InstancedBufferAttribute, MeshStandardMaterial, CylinderGeometry, Matrix4, Vector3 } = three

  /** A belt of width `w` looped round wheels of radius `r` at z = -half and +half. */
  function belt(w, r, half, segments = 160) {
    const len = 4 * half + 2 * Math.PI * r, pos = [], nrm = [], uvs = [], idx = []
    for (let i = 0; i <= segments; i++) {
      // Walk the loop by arc length: top run toward -z, front arc, bottom run toward +z, back arc.
      const t = i / segments * len
      let y, z, ny, nz
      if (t < 2 * half) { z = half - t; y = r; ny = 1; nz = 0 }
      else if (t < 2 * half + Math.PI * r) { const a = (t - 2 * half) / r; z = -half - Math.sin(a) * r; y = Math.cos(a) * r; ny = Math.cos(a); nz = -Math.sin(a) }
      else if (t < 4 * half + Math.PI * r) { z = -half + (t - 2 * half - Math.PI * r); y = -r; ny = -1; nz = 0 }
      else { const a = (t - 4 * half - Math.PI * r) / r; z = half + Math.sin(a) * r; y = -Math.cos(a) * r; ny = -Math.cos(a); nz = Math.sin(a) }
      for (const u of [0, 1]) { pos.push((u - .5) * w, y, z); nrm.push(0, ny, nz); uvs.push(u, t) }
      if (i < segments) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    g.setIndex(idx)
    return g
  }
  const t = s.terrain, p = pl.object.position
  const at = new Vector3(p.x + 8, 0, p.z)
  at.y = t.heightAt(at.x, at.z) + 1.4
  const root = new Group(); root.name = 'Track test'; root.position.copy(at); game.scene.add(root)
  const rubber = setRole(new MeshStandardMaterial({ color: 0x1b1b1d }), 'track'); rubber.name = 'Test belt'
  const hub = setRole(new MeshStandardMaterial({ color: 0x3a3c40 }), 'frame')
  // Two single belts side by side, scrolling at different speeds through one shared material.
  const singles = [-.45, .45].map((x) => { const m = new Mesh(belt(.6, .36, .8), rubber); m.position.x = x; root.add(m); return m })
  for (const x of [-.45, .45]) for (const z of [-.8, .8]) { const c = new Mesh(new CylinderGeometry(.33, .33, .5, 24), hub); c.rotation.z = Math.PI / 2; c.position.set(x, 0, z); root.add(c) }
  // Six belts as one instanced draw, each instance with its own scroll.
  const g6 = belt(.5, .3, .6); const scroll6 = new InstancedBufferAttribute(new Float32Array(6), 1); g6.setAttribute('trackScroll', scroll6)
  const six = new InstancedMesh(g6, rubber, 6)
  for (let i = 0; i < 6; i++) six.setMatrixAt(i, new Matrix4().makeTranslation(-2.5 + i * 1, 0, -3.4))
  root.add(six)
  const detach = applyShowroom(root, (r) => { addNightReadability(r); addLavaGlow(r) })
  const cam = game.camera
  const state = { view: 'near', scroll: 0 }
  const views = {
    near: { from: [1.25, .75, .55], to: [.1, .3, -.25] },
    six: { from: [1.4, 1.3, -2.2], to: [-.4, 0, -3.6] },
    mid: { from: [6, 2.6, 4.5], to: [0, 0, -1.2] },
    far: { from: [22, 9, 18], to: [0, 0, -1.2] },
  }
  game.add({
    update() {
      const v = views[state.view]
      cam.position.set(at.x + v.from[0], at.y + v.from[1], at.z + v.from[2]); cam.lookAt(at.x + v.to[0], at.y + v.to[1], at.z + v.to[2]); cam.updateMatrixWorld()
      // Belt one runs at the given scroll, belt two the other way at half of it.
      singles[0].userData.trackScroll = state.scroll; singles[1].userData.trackScroll = -state.scroll / 2
      for (let i = 0; i < 6; i++) scroll6.setX(i, state.scroll * (i + 1) / 6)
      scroll6.needsUpdate = true
    },
  })
  window.__track = {
    set(view, scroll, tier, hour) {
      state.view = view; state.scroll = scroll
      s.params.set(vehicleShading.def.id, tier); s.params.set('sun.timeOfDay', hour); s.params.set('bots.count', 0)
    },
    info() { return { tier: vehicleShading.value, material: singles[0].material.type, instanced: six.material.userData.instancedScroll, single: singles[0].material.userData.instancedScroll, sharedSingle: singles[0].material === singles[1].material, pitch: TRACK_LUGS.pitch } },
    detach,
  }
})
const report = { base, extra, shots: [] }
const pitch = 0.16
for (const hour of [12, 0]) for (const tier of [3, 1]) for (const view of ['near', 'six', 'mid', 'far']) for (const scroll of view === 'near' || view === 'six' ? [0, pitch / 2] : [0]) {
  await page.evaluate(([v, sc, ti, h]) => window.__track.set(v, sc, ti, h), [view, scroll, tier, hour])
  // A few frames for the sky and the tier swap to settle.
  await page.waitForTimeout(700)
  const name = `${hour === 12 ? 'noon' : 'night'}-tier${tier}-${view}-${scroll ? 'scrolled' : 'rest'}`
  await page.screenshot({ path: `${out}/${name}.png` })
  report.shots.push({ name, ...(await page.evaluate(() => window.__track.info())) })
}
report.errors = errors
await browser.close()
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify({ shots: report.shots.length, first: report.shots[0], errors }, null, 1))

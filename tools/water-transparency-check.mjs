/** Controlled evidence through ordinary entry. No water feature query or room interception.
 * node tools/water-transparency-check.mjs BASE OUT [webgpu|webgl] [visual|sync|cost|leak|crossing|dive|sky]
 * Run via the absolute shared heavy limiter. WATER_HEADED=1 for a real window.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [base, out, backend = 'webgpu', mode = 'visual'] = process.argv.slice(2)
if (!base || !out) throw Error('BASE and OUT required')
mkdirSync(out, { recursive: true })
const report = { backend, mode, headed: process.env.WATER_HEADED === '1', errors: [], cases: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: !report.headed,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const room = `water-clear-${Date.now()}`
async function enter(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`))
  const url = new URL(base); url.searchParams.set('room', room); url.searchParams.set('name', name)
  if (backend === 'webgl') url.searchParams.set('webgl', '1')
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h.game.time > 3, null, { timeout: 120000 })
  const entry = await page.evaluate(() => ({ backend: window.syn3h.game.backend, waves: window.syn3h.params.get('water.waves').value, connected: window.syn3hNet.connected }))
  assert.equal(entry.backend, backend); assert.equal(entry.waves, true)
  report.cases.push({ name, entry })
  await page.screenshot({ path: `${out}/${name}-ordinary-entry.png` })
  return page
}
async function configure(page) {
  await page.evaluate(async () => {
    const s = window.syn3h
    const { applyPlanet } = await import('/src/world/planets.ts')
    applyPlanet('alpine', 7)
    for (const [id, value] of Object.entries({ 'bots.count': 0, 'gfx.auto': false, 'gfx.level': 2, 'sun.timeOfDay': 12, 'sun.dayLength': 0, 'world.curve': 0, 'weather.storminess': 0 })) s.params.set(id, value)
  })
  await page.waitForTimeout(2500)
}
async function scene(page, kind) {
  return page.evaluate(async kind => {
    const T = await import((await (await fetch('/src/world/water/bubbles.ts')).text()).match(/from ["']([^"']*three_webgpu[^"']*)["']/)[1]), s = window.syn3h, t = s.terrain, level = s.params.get('world.lavaAltitude').value
    let spot
    const good = (x, z, surface, lo = 1.6, hi = 4.5) => {
      const bed = t.heightAt(x, z), actual = t.liquidHeightAt(x, z)
      if (t.liquidKindAt(x, z) === 'water' && Math.abs(actual - surface) < 1 && surface - bed >= lo && surface - bed <= hi) return { x, z, y: surface, bed }
    }
    if (kind === 'pool') {
      for (const p of [t.data.lava.lake, ...t.data.lava.pools].filter(Boolean)) {
        for (let r = .1; r < .98 && !spot; r += .05) for (let a = 0; a < 6.28 && !spot; a += .25) spot = good(p.x + Math.cos(a) * p.radius * r, p.z + Math.sin(a) * p.radius * r, p.surface)
        if (spot) break
      }
    } else if (kind === 'river') {
      for (const r of t.data.lava.rivers) {
        for (let i = 1; i < r.points.length; i++) { const p = r.points[i], prev = r.points[i - 1]; if (Math.abs(p.y - prev.y) / Math.max(.1, Math.hypot(p.x - prev.x, p.z - prev.z)) > .08) continue; spot = good(p.x, p.z, p.y, .5, 4.5); if (spot) break }
        if (spot) break
      }
    } else {
      const size = t.wrapSize
      outer: for (let x = -size / 2 + 32; x < size / 2 - 32; x += 8) for (let z = -size / 2 + 32; z < size / 2 - 32; z += 8) {
        spot = good(x, z, level, kind === 'deep' ? 25 : kind === 'submerged' ? 9 : 1.6, kind === 'deep' ? 60 : kind === 'submerged' ? 16 : 4.5)
        if (spot) break outer
      }
    }
    if (!spot) throw Error(`No natural ${kind} test location`)
    if (window.waterClear) { s.game.scene.remove(window.waterClear.markers); window.waterClear.markers.traverse(o => { o.geometry?.dispose(); o.material?.dispose() }) }
    const markers = new T.Group(), positions = []
    for (const [dx, color] of [[-1.8, 0xff2020], [0, 0xffffff], [1.8, 0x111111]]) {
      const x = spot.x + dx, y = Math.min(spot.y - .6, t.heightAt(x, spot.z) + .35)
      const box = new T.Mesh(new T.BoxGeometry(1.1, .6, 1.5), new T.MeshStandardMaterial({ color, roughness: .7 }))
      box.position.set(x, y, spot.z); markers.add(box); positions.push({ x, y, z: spot.z, topBelowWater: spot.y - y - .3 })
    }
    s.game.scene.add(markers)
    const state = { spot, markers, below: false, overhead: false }
    window.waterClear = state
    if (!window.waterClearCamera) {
      window.waterClearCamera = true
      const cameraSystem = { update() {
        const q = window.waterClear; if (!q) return
        const p = q.spot
        if(q.horizon){
          const angle=(q.heading??238)*Math.PI/180
          s.game.camera.position.set(p.x-Math.sin(angle)*8,p.y-(q.depth??3),p.z-Math.cos(angle)*8)
          s.game.camera.lookAt(p.x,p.y-(q.depth??3)-.3,p.z)
        }else{
          s.game.camera.position.set(p.x + (q.below ? 0 : 7), p.y + (q.below ? -1.3 : 13), p.z + (q.below ? 3 : 13))
          s.game.camera.lookAt(p.x, p.y + (q.below ? 2 : -1), p.z)
        }

      }, fixedUpdate() {
        const p = window.waterClear?.spot; if (!p) return
        s.player.body.setTranslation({ x: p.x + 4, y: p.y - (window.waterClear.horizon ? (window.waterClear.depth??3)+1 : .2), z: p.z }, true)
        s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        s.player.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
      } }
      s.game.systems.splice(s.game.systems.findIndex(system=>system.underwater),0,cameraSystem)
    }
    return { kind, spot, markers: positions }
  }, kind)
}
async function shot(page, label) {
  await page.waitForTimeout(1200)
  const state = await page.evaluate(async () => {
    const s = window.syn3h, v = s.terrain.volcanics
    const T = await import((await (await fetch('/src/world/water/bubbles.ts')).text()).match(/from ["']([^"']*three_webgpu[^"']*)["']/)[1])
    const markerProof = window.waterClear?.markers.children.map(o => {
      o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox, corners = []
      for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
        const px = o.position.x + x, pz = o.position.z + z, top = o.position.y + b.max.y
        corners.push({ x:px, z:pz, top, surface:s.terrain.liquidHeightAt(px,pz), ground:s.terrain.heightAt(px,pz) })
      }
      return { color:o.material.color.getHexString(), corners, fullySubmerged:corners.every(c=>Number.isFinite(c.surface)&&c.top<c.surface) }
    })
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(.1,.83),s.game.camera)
    const rectangleHits = ray.intersectObjects(v.group.children,true).slice(0,3).map(h=>({point:h.point.toArray(), material:h.object.material.uuid, path:v.meshes.findIndex(m=>m.mesh===h.object), geometry:h.object.geometry.type, attributes:Object.keys(h.object.geometry.attributes), ground:s.terrain.heightAt(h.point.x,h.point.z), surface:s.terrain.liquidHeightAt(h.point.x,h.point.z)}))
    return { markerProof, rectangleHits, cameraAboveSpotSurface:window.waterClear ? s.game.camera.position.y-s.terrain.liquidHeightAt(window.waterClear.spot.x,window.waterClear.spot.z):null, waves: s.params.get('water.waves').value, quality: s.params.get('gfx.level').value, perf: s.game.performance,
      materials: ['newSea','newStill','newRiver','waterSea','waterStill'].map(k => ({ name: k, transparent: v[k].material.transparent, depthWrite: v[k].material.depthWrite, displaced: !!v[k].material.positionNode })),
      bubbles: (()=>{const e=s.game.systems.find(system=>system.bubbles);return e&&{active:e.bubbles.field.particles.length,capacity:e.bubbles.capacity,visible:e.bubbles.mesh?.visible}})(), connected: window.syn3hNet.connected, camera: s.game.camera.position.toArray() }
  })
  await page.screenshot({ path: `${out}/${label}.png` }); report.cases.push({ label, ...state })
}
try {
  const a = await enter('A'); await configure(a)
  if (mode === 'visual' || mode === 'proof') {
    for (const waves of [true, false]) {
      await a.evaluate(v => window.syn3h.params.set('water.waves', v), waves)
      for (const kind of ['sea', 'pool', 'river', 'deep']) {
        report.cases.push(await scene(a, kind))
        await shot(a, `${kind}-${waves ? 'waves' : 'flat'}-above`)
        if (mode === 'proof') {
          await a.evaluate(()=>{window.syn3h.terrain.volcanics.group.visible=false})
          await shot(a, `${kind}-${waves ? 'waves' : 'flat'}-reference`)
          await a.evaluate(()=>{window.syn3h.terrain.volcanics.group.visible=true})
        }
        if (kind === 'sea') {
          await a.evaluate(() => { window.waterClear.below = true }); await shot(a, `sea-${waves ? 'waves' : 'flat'}-below`)
          await a.evaluate(() => { window.waterClear.below = false }); await shot(a, `sea-${waves ? 'waves' : 'flat'}-returned`)
        }
      }
    }
    await scene(a, 'sea')
    for (const waves of [true, false]) for (const tier of [0, 1, 2]) {
      await a.evaluate(({t,w}) => { window.syn3h.params.set('gfx.level', t); window.syn3h.params.set('water.waves', w) }, {t:tier,w:waves})
      await shot(a, `tier-${tier}-${waves ? 'waves' : 'flat'}`)
    }
    for (const world of ['volcanic', 'moon']) {
      await a.evaluate(async world => { window.waterClear = null; const { applyPlanet } = await import('/src/world/planets.ts'); applyPlanet(world, 7) }, world)
      await a.waitForTimeout(2000)
      report.cases.push(await a.evaluate(world => {
        const v = window.syn3h.terrain.volcanics
        return { world, seaCount: v.sea.length, lavaTransparent: v.lavaSea.material.transparent }
      }, world))
      await a.screenshot({ path: `${out}/${world}.png` })
    }
    assert.equal(report.cases.find(x => x.world === 'volcanic').lavaTransparent, false)
    assert.equal(report.cases.find(x => x.world === 'moon').seaCount, 0)
  }
  if (mode === 'leak') {
    // The live public presence is read only. No public socket, hello or parameter mutation.
    report.publicPresence=await (await fetch('https://www.syn3h.com/presence')).json()
    await a.evaluate(async()=>{const {applyPlanet}=await import('/src/world/planets.ts');applyPlanet('swamp',7)})
    await a.waitForTimeout(2000)
    report.cases.push(await scene(a,'submerged'))
    await a.evaluate(()=>{window.waterClear.horizon=true;window.waterClear.markers.visible=false})
    for(const waves of [true,false]) for(const tier of [0,2]) for(const depth of [1,7]) {
      await a.evaluate(({waves,tier,depth})=>{const s=window.syn3h;s.params.set('water.waves',waves);s.params.set('gfx.level',tier);window.waterClear.depth=depth}, {waves,tier,depth})
      await a.waitForTimeout(3000)
      const name=`swamp-${waves?'waves':'flat'}-tier${tier}-depth${depth}`
      await shot(a,name)
      if(depth===7&&tier===2&&waves){
        for(const layer of ['water','sky','post','vehicle']){
          await a.evaluate(layer=>{
            const s=window.syn3h
            if(layer==='water')s.terrain.volcanics.group.visible=false
            if(layer==='sky'){const sky=s.game.scene.children.find(o=>o.sunDirection&&o.betaR);window.leakSky=sky;if(sky)sky.visible=false}
            if(layer==='post'){window.leakPost=s.game.postChain;s.game.setPostChain(null)}
            if(layer==='vehicle')s.player.object.visible=false
          },layer)
          await shot(a,`${name}-without-${layer}`)
          await a.evaluate(layer=>{const s=window.syn3h;if(layer==='water')s.terrain.volcanics.group.visible=true;if(layer==='sky'&&window.leakSky)window.leakSky.visible=true;if(layer==='post')s.game.setPostChain(window.leakPost);if(layer==='vehicle')s.player.object.visible=true},layer)
        }
      }
    }
    await a.evaluate(()=>{window.waterClear.horizon=false;window.waterClear.below=false})
    await shot(a,'swamp-exit')
    assert.equal(report.cases.at(-1).bubbles.active,0)
  }
  if (mode === 'crossing') {
    report.cases.push(await scene(a, 'submerged'))
    await a.evaluate(() => {
      const g=window.syn3h.game,b=g.renderer.backend
      window.crossCounts={pipelines:0,programs:0}
      for(const [method,key] of [['createRenderPipeline','pipelines'],['createProgram','programs']]){
        const original=b[method];b[method]=function(...args){window.crossCounts[key]++;return original.apply(this,args)}
      }
      window.waterClear.markers.visible=false
      window.waterClear.horizon=true;window.waterClear.depth=-2
    })
    for(const tier of [0,1,2]){
      await a.evaluate(tier=>window.syn3h.params.set('gfx.level',tier),tier)
      await a.waitForTimeout(4000)
      const trace=await a.evaluate(async()=>{
        const rows=[],g=window.syn3h.game
        let last=performance.now()
        for(let phase=0;phase<21;phase++){
          const below=phase%2===1
          window.waterClear.depth=below?2:-2
          for(let frame=0;frame<35;frame++){
            const before={...window.crossCounts},fog=g.scene.fogNode?.id,postBuilds=g.postChain?.builds??0
            await new Promise(requestAnimationFrame)
            const now=performance.now()
            const e=g.systems.find(x=>x.underwater),cp=g.camera.position
            rows.push({lensDepth:+(window.syn3h.terrain.liquidHeightAt(cp.x,cp.z)-cp.y).toFixed(3),blend:+e.underwater.amount.toFixed(3),bubbles:e.bubbles.mesh.geometry.instanceCount,phase,below,frame,rafMs:now-last,gameMs:g.performance.frameMs,pipelines:window.crossCounts.pipelines-before.pipelines,programs:window.crossCounts.programs-before.programs,fogBefore:fog,fogAfter:g.scene.fogNode?.id,postBuilds:(g.postChain?.builds??0)-postBuilds})
            last=now
          }
        }
        return rows
      })
      report.cases.push({tier,trace})
      writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2))
      const crossings = trace.filter(x => x.phase > 0)
      assert.ok(crossings.every(x => x.pipelines === 0 && x.programs === 0 && x.postBuilds === 0), `Tier ${tier}: crossing rebuilt pipelines or post graph`)
      assert.ok(crossings.every(x => x.fogBefore === x.fogAfter), `Tier ${tier}: fog graph changed`)
      assert.ok(crossings.filter(x => x.frame === 34).every(x => x.below ? x.lensDepth > 0 && x.blend === 1 : x.lensDepth < 0 && x.blend === 0), `Tier ${tier}: camera did not cross and settle`)
      console.log(JSON.stringify({tier,crossings:trace.filter(x=>x.phase>0&&x.frame<3),maxMs:Math.max(...trace.map(x=>x.rafMs))}))
    }
  }
    // Fixed simulated steps: stop the loop and drive Game.frame with a faked 1/30 s clock, so
    // every screenshot is a known simulated time regardless of how slowly headless Chrome runs.
    if (mode === 'dive') {
      report.cases.push(await scene(a, 'submerged'))
      await a.evaluate(() => { window.waterClear.markers.visible = false; window.waterClear.horizon = true; window.waterClear.depth = -1.2; window.syn3h.params.set('water.waves', true); window.syn3h.params.set('gfx.level', 2) })
      await a.waitForTimeout(4000)
      await a.evaluate(() => window.syn3h.game.renderer.setAnimationLoop(null))
      const step = () => a.evaluate(() => { const g = window.syn3h.game, e = g.systems.find(x => x.underwater), p = g.camera.position, t = window.syn3h.terrain
        g.last = performance.now() - 1000 / 30; g.frame()
        return { time: +g.time.toFixed(3), lensY: +p.y.toFixed(3), surface: +t.liquidHeightAt(p.x, p.z).toFixed(3), lens: { ...e.lens }, blend: +e.underwater.amount.toFixed(3), bubbles: e.bubbles.mesh.geometry.instanceCount } })
      const rows = []
      // Desired lens: 1.2 m above, then a step to 2.5 m below (the vehicle dives), then back.
      for (const [label, depth, frames] of [['above', -1.2, 15], ['dive', 2.5, 60], ['surface', -1.2, 60]]) {
        await a.evaluate(d => { window.waterClear.depth = d }, depth)
        for (let i = 0; i < frames; i++) {
          const row = { label, i, desiredDepth: depth, ...(await step()) }; rows.push(row)
          if (label !== 'above' && i % 4 === 0 || label === 'above' && i === 14) { const name = `dive-${String(rows.length).padStart(3, '0')}-${label}-${i}`; row.shot = name; await a.screenshot({ path: `${out}/${name}.png` }) }
        }
      }
      report.cases.push({ dive: rows })
      await a.evaluate(() => window.syn3h.game.start())
    }
  if (mode === 'sky') {
    // Bright strip and reflection proof. The leak scene: swamp, horizontal view under water.
    await a.evaluate(async()=>{const {applyPlanet}=await import('/src/world/planets.ts');applyPlanet('swamp',7)})
    await a.waitForTimeout(2000)
    report.cases.push(await scene(a,'submerged'))
    await a.evaluate(()=>{window.waterClear.horizon=true;window.waterClear.markers.visible=false;window.waterClear.depth=-3;window.syn3h.params.set('water.waves',true);window.syn3h.params.set('gfx.level',2)})
    const recapture = () => a.evaluate(async () => {
      // Force a sky-only reflection capture now, through the real schedule (param invalidation).
      const s = window.syn3h, g = s.game, sky = g.scene.children.find(o => o.sunDirection && o.betaR), id = 'sky.turbidity', v = s.params.get(id).value
      if (!window.pmremHooked) { window.pmremHooked = true; const T = await import((await (await fetch('/src/world/water/bubbles.ts')).text()).match(/from ["']([^"']*three_webgpu[^"']*)["']/)[1]), original = T.PMREMGenerator.prototype.fromScene; T.PMREMGenerator.prototype.fromScene = function (...args) { const target = original.apply(this, args); window.lastPmrem = target; return target } }
      const log = window.skyMixLog ??= []
      if (!window.skyMixWrapped) { window.skyMixWrapped = true; const node = sky.underwaterMix, original = node.update; node.update = function (frame) { const r = original.call(this, frame); log.push({ player: frame.camera === g.camera, value: this.value }); return r } }
      const before = s.game.scene.userData.skyEnvironment.captures
      s.params.set(id, v + .01); await new Promise(r => setTimeout(r, 900)); s.params.set(id, v); await new Promise(r => setTimeout(r, 1500))
      const rt = window.lastPmrem, w = rt.width, h = rt.height
      if (g.scene.environment !== rt.texture) throw Error('Captured PMREM target is not scene.environment')
      const px = await g.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)
      let sum = 0; for (let i = 0; i < px.length; i++) sum += Number(px[i])
      let hash = 2166136261; const bytes = new Uint8Array(px.buffer, px.byteOffset, px.byteLength); for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0
      const e = g.systems.find(x => x.underwater)
      return { captures: s.game.scene.userData.skyEnvironment.captures - before, size: [w, h], sum, hash: hash.toString(16), blend: e.underwater.amount, skyAmount: sky.underwaterAmount, nonPlayerNonZero: log.filter(x => !x.player && x.value !== 0).length, nonPlayer: log.filter(x => !x.player).length, playerNonZero: log.filter(x => x.player && x.value > 0).length }
    })
    const above = await recapture(); report.cases.push({ reflection: 'above', ...above })
    await shot(a, 'sky-above')
    for (const depth of [1, 7]) {
      await a.evaluate(d => { window.waterClear.depth = d }, depth)
      await a.waitForTimeout(3000)
      await shot(a, `sky-under-depth${depth}`)
      report.cases.push({ reflection: `under-${depth}`, ...(await recapture()) })
      await a.evaluate(()=>{const sky=window.syn3h.game.scene.children.find(o=>o.sunDirection&&o.betaR);window.leakSky=sky;sky.visible=false})
      await shot(a, `sky-under-depth${depth}-without-sky`)
      await a.evaluate(()=>{window.leakSky.visible=true})
    }
    await a.evaluate(() => { window.waterClear.depth = -3 })
    await a.waitForTimeout(3000)
    report.cases.push({ reflection: 'returned', ...(await recapture()) })
  }
  if (mode === 'cost') {
    for (const kind of ['sea','pool','river']) {
      report.cases.push(await scene(a, kind))
      const rows = await a.evaluate(async () => {
        const s = window.syn3h, g = s.game, r = g.renderer, v = s.terrain.volcanics
        const N = await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/three_tsl.js')).name)
        const materials = ['newSea','newStill','newRiver','waterSea','waterStill'].map(k=>v[k].material)
        const original = materials.map(m=>m.opacityNode)
        const rows=[]
        const distribution = list => { const a=[...list].sort((a,b)=>a-b); return {p50:a[Math.floor(a.length*.5)],p90:a[Math.floor(a.length*.9)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)} }
        for (const transparent of [false,true,false,true]) {
          for(let i=0;i<materials.length;i++){materials[i].transparent=transparent;materials[i].opacityNode=transparent?original[i]:N.float(1);materials[i].needsUpdate=true}
          // Include the real post chain. Warm compilation separately from steady-state timing.
          const warmStart=performance.now()
          for(let i=0;i<45;i++)await new Promise(requestAnimationFrame)
          const samples=[]
          for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);samples.push({...g.performance})}
          const geometry = new Set(), meshes=[...v.sea.map(x=>x.mesh),...v.meshes.map(x=>x.mesh)]
          if(v.apron)meshes.push(v.apron)
          let attributeBytes=0,indexBytes=0
          for(const mesh of meshes){const geo=mesh.geometry;if(geometry.has(geo))continue;geometry.add(geo);for(const a of Object.values(geo.attributes))attributeBytes+=a.array.byteLength;indexBytes+=geo.index?.array.byteLength??0}
          rows.push({transparent, comparator:transparent?'current blending':'same geometry/shader forced opaque; isolates blending, not full old release',warmupAndSampleMs:performance.now()-warmStart,frameMs:distribution(samples.map(x=>x.frameMs)),physicsMs:distribution(samples.map(x=>x.physicsMs)),drawCalls:distribution(samples.map(x=>x.drawCalls)),triangles:distribution(samples.map(x=>x.triangles)),stallsOver50ms:samples.filter(x=>x.frameMs>50).length,memory:{...r.info.memory},attributeBytes,indexBytes,backend:g.backend,pixelRatio:r.getPixelRatio(),size:[r.domElement.width,r.domElement.height]})
        }
        return rows
      })
      report.cases.push({kind,cost:rows})
    }
  }
  if (mode === 'sync') {
    const b = await enter('B')
    await Promise.all([a, b].map(p => p.waitForFunction(() => window.syn3hNet.clock.synced && [...window.syn3hNet.players.values()].filter(v => !v.bot).length === 2, null, { timeout: 60000 })))
    await a.waitForTimeout(3000)
    for (const page of [a, b]) {
      report.cases.push(await scene(page, 'deep'))
      await page.evaluate(() => {
        const s = window.syn3h
        s.params.set('gfx.auto', false); s.params.set('gfx.level', 0)
        s.game.add({ update() {
          const target = window.waterFreezeTarget, n = window.syn3hNet
          if (!target || n.seaTime < target) return
          const nodes = [], seen = new Set()
          s.terrain.volcanics.newSea.material.positionNode.traverse(node => {
            if (node.isUniformNode && node.value?.isVector4 && !seen.has(node.id)) { seen.add(node.id); nodes.push(node.value.toArray()) }
          })
          window.waterFrozen = { target, seaTime: n.seaTime, roomTime: n.clock.now(), phases: nodes, camera: s.game.camera.position.toArray(), at: Date.now() }
          window.waterFreezeTarget = null
          s.game.renderer.setAnimationLoop(null)
        } })
      })
    }
    await a.evaluate(()=>{window.syn3h.params.set('water.waveHeight',2)})
    await a.waitForTimeout(5000)
    for (let i = 0; i < 3; i++) {
      const target = await a.evaluate(() => window.syn3hNet.seaTime + 4)
      await Promise.all([a, b].map(p => p.evaluate(target => {
        window.waterFrozen = null; window.waterFreezeTarget = target; window.syn3h.game.start()
      }, target)))
      await Promise.all([a, b].map(p => p.waitForFunction(() => !!window.waterFrozen, null, { timeout: 30000 })))
      const states = await Promise.all([a, b].map(p => p.evaluate(() => window.waterFrozen)))
      assert.ok(states.every(x => x.phases.length > 0), 'No actual rendered wave uniforms captured')
      const timeDifference = Math.abs(states[0].seaTime - states[1].seaTime)
      const phaseDifference = Math.max(...states[0].phases.map((v, k) => Math.abs(Math.atan2(Math.sin(v[2] - states[1].phases[k][2]), Math.cos(v[2] - states[1].phases[k][2])))))
      report.cases.push({ pair: i, timeDifference, phaseDifference, states })
      await Promise.all([a, b].map((p, k) => p.screenshot({ path: `${out}/sync-${i}-${k ? 'B' : 'A'}.png` })))
      assert.ok(timeDifference < .15, 'Client render times diverged by more than150ms')
      assert.ok(phaseDifference < .15, 'Rendered wave phases diverged by more than0.15rad')
    }
  }
  assert.deepEqual(report.errors, [])
} catch (e) { report.failure = e.stack; throw e }
finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close() }

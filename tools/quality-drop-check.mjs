// Run against a local release build before claiming an automatic quality step is free.
// node tools/quality-drop-check.mjs ORIGIN webgpu|webgl 2|3|4|5 OUTPUT.json [desktop|phone] [stock|unshed|empty] [solo|peer|arrival|manual] [waterfall|volcanic]
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'

const [origin, backend, entry, output, viewport = 'desktop', fleet = 'stock', multiplayer = 'solo', world] = process.argv.slice(2)
assert(['stock','unshed','empty'].includes(fleet) && ['solo','peer','arrival','manual'].includes(multiplayer))
const url = new URL(origin), entryLevel = Number(entry)
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
assert(['webgpu','webgl'].includes(backend) && [2,3,4,5].includes(entryLevel) && output && ['desktop','phone'].includes(viewport))
assert(!world || ['waterfall','volcanic'].includes(world))
if (world) url.searchParams.set('planet', world === 'waterfall' ? 'alpine' : 'volcanic')
url.searchParams.set('seed', world === 'waterfall' ? '4' : '1')
if (world === 'waterfall') url.searchParams.set('vehicle','hovercraft')
url.searchParams.set('room','quality-check-'+randomUUID().slice(0,8))
if (backend === 'webgl') url.searchParams.set('webgl','1')
const browser = await chromium.launch({channel:'chrome', headless:false})
try {
  const phone = viewport === 'phone'
  const page = await browser.newPage({viewport:phone ? {width:390,height:844} : {width:1280,height:720},
    deviceScaleFactor:phone ? 2 : 1, isMobile:phone, hasTouch:phone})
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', msg => { if (msg.type()==='error') console.error(msg.text()) })
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.game)
  await page.evaluate(({level,fleet,multiplayer}) => {
    const {game, shell, params} = window.syn3h
    if (fleet === 'empty') params.set('bots.count',0)
    // The stock pacer can reduce the fleet before measurement on a busy host.
    // Keep the requested count during setup, then restore stock shedding at the start.
    if (fleet === 'unshed' || (fleet === 'stock' && multiplayer === 'solo')) params.set('bots.keepCount',true)
    if (multiplayer === 'arrival') {
      const bots = window.syn3h.bots, arrive = bots.arrive
      bots.arrive = function(index) {
        if (index !== 3) return arrive.call(this,index)
        bots.arrive = arrive
        return new Promise(resolve => {
          window.releaseFourthBot = () => { delete window.releaseFourthBot; resolve(arrive.call(this,index)) }
        })
      }
    }
    game.quality.setLevel(level)
    game.quality.setAuto(true)
    // Stage the requested entry level until the test subjects exist. Stock bot pacing
    // keeps measuring real frames. The descent itself uses the production governor.
    window.sampleBeforeRoster = game.quality.governor.sample
    game.quality.governor.sample = () => null
    void shell.play(true)
  },{level:entryLevel,fleet,multiplayer})
  await page.waitForFunction(() => window.syn3hNet?.isHost && window.syn3h.shell.playing &&
    !window.syn3h.shell.transitioning, null, {timeout:90000})
  if (multiplayer === 'arrival') {
    await page.waitForFunction(() => typeof window.releaseFourthBot === 'function',null,{timeout:120000})
  } else if (fleet !== 'empty') {
    await page.waitForFunction(() => {
      const {bots,materialize} = window.syn3h
      const vehicles = bots.vehicles
      return vehicles.length === 4 && ['buggy','hovercraft','jet'].every(kind => vehicles.some(v => v.kind === kind))
        && vehicles.every(v => !materialize.isMaterializing(v))
    }, null, {timeout:120000})
  }
  let peerId = null
  if (multiplayer === 'peer') {
    const peer = await browser.newPage({viewport:{width:640,height:480}})
    const peerUrl = new URL(url)
    peerUrl.searchParams.set('vehicle','jet')
    await peer.goto(peerUrl.href)
    await peer.waitForFunction(() => window.syn3h?.shell)
    await peer.evaluate(() => { window.syn3h.game.quality.setLevel(0); return window.syn3h.shell.play(true) })
    await peer.waitForFunction(() => window.syn3hNet?.id && window.syn3h.shell.playing && !window.syn3h.shell.transitioning)
    peerId = await peer.evaluate(() => window.syn3hNet.id)
    const at = await page.evaluate(() => {
      const {game,player,terrain} = window.syn3h
      const point = game.camera.getWorldDirection(player.object.position.clone()).multiplyScalar(12).add(game.camera.position)
      return [point.x, terrain.heightAt(point.x,point.z)+2, point.z]
    })
    await peer.evaluate(at => {
      const {player} = window.syn3h
      player.teleport(player.object.position.clone().fromArray(at),0)
    },at)
    await page.bringToFront()
    await page.waitForFunction(id => window.syn3hNet?.remotes.get(id)?.vehicle,peerId)
  }
  if (world === 'waterfall') await page.evaluate(async () => {
    const { game, camera, player, terrain } = window.syn3h
    const origins = game.scene.getObjectByName('waterfall-mist')?.geometry.getAttribute('mistOrigin')
    if (!origins?.count) throw Error('Waterfall fixture has no plunge pool')
    const foot = game.camera.position.clone().fromBufferAttribute(origins,0)
    // Stage a real hovercraft over water. Its cushion disturbs the field through WaterEffects.
    const height = terrain.liquidHeightAt(foot.x,foot.z)
    if (terrain.liquidKindAt(foot.x,foot.z) !== 'water' || !Number.isFinite(height)) throw Error('Expected water at the plunge pool')
    player.teleport(foot.clone().setY(height+1),0)
    camera.setCinematicPose(foot.clone().add({x:8,y:5,z:12}),foot)
    const field = game.systems.find(system => system.ripples && system.spray).ripples
    const start = performance.now(), passes = field.stats.passes
    while (field.stats.passes === passes) {
      if (performance.now()-start>8000) throw Error('The hovercraft did not disturb the water during setup')
      await new Promise(requestAnimationFrame)
    }
  })
  const result = await page.evaluate(async ({peerId, multiplayer, fleet}) => {
    const {game} = window.syn3h, q = game.quality, governor = q.governor, b = game.renderer.backend
    governor.sample = window.sampleBeforeRoster
    delete window.sampleBeforeRoster
    const roster = () => window.syn3h.bots.vehicles.map(v => ({kind:v.kind,id:v.object.id,arriving:window.syn3h.materialize.isMaterializing(v)}))
    const initialRoster = roster()
    if (fleet === 'stock' && multiplayer === 'solo') window.syn3h.params.set('bots.keepCount',false)
    const peerVehicle = peerId === null ? undefined : window.syn3hNet.remotes.get(peerId)?.vehicle
    const peerDrawLevels = new Set()
    const minimalDraws = new Set()
    const roots = new Set(initialRoster.map(v => v.id))
    const draw = b.draw
    if (peerId !== null || fleet === 'unshed') b.draw = function(source,...args) {
      const result = draw.call(this,source,...args)
      if (fleet === 'unshed' && governor.level === 0) {
        for (let o = source.object; o; o = o.parent) {
          if (roots.has(o.id)) minimalDraws.add(o.id)
        }
      }
      if (peerId !== null && window.syn3hNet.remotes.get(peerId)?.vehicle.object.getObjectById(source.object.id)) peerDrawLevels.add(governor.level)
      return result
    }
    const entered = governor.level, start = performance.now(), calls = [], changes = []
    function record(kind, source) {
      const actor = window.syn3h.bots.vehicles.find(vehicle => vehicle.object.getObjectById(source.object?.id))

      const fx = window.syn3h.materialize
      const effect = source.object === fx.cloud.mesh ? 'arrival cloud' : fx.looks.flatMap((look,i) =>
        ['volume','ground','flash','beam'].filter(key=>look[key]===source.object).map(key=>key+' '+i))[0]
      calls.push({peer:!!peerVehicle?.object.getObjectById(source.object?.id),effect,ghost:source.object?.userData.arrivalGhost,parent:source.object?.parent?.name,materialId:source.material?.id,kind, level:governor.level, frame:game.frames, ms:performance.now()-start,
        bot:actor?.kind, botRoot:actor?.object.id, object:source.object?.name, material:source.material?.name || source.material?.type})
    }
    const make = b.createNodeBuilder, pipeline = b.createRenderPipeline, sample = governor.sample
    b.createNodeBuilder = function(...args) {
      const node = make.apply(this,args), build = node.build
      node.build = function(...args) { record('graph',this); return build.apply(this,args) }
      return node
    }
    b.createRenderPipeline = function(ro,...args) { record('pipeline',ro); return pipeline.call(this,ro,...args) }
    const unsubscribe = q.subscribeQuality(s => changes.push({ms:performance.now()-start,level:s.level,rung:s.rung,roster:roster()}))
    // Bots keep driving during the governor's evidence windows. Stage the real actors
    // in front of the current camera just before Minimal so an offscreen jet cannot
    // turn an empty submission count into a passing unshed run.
    function stageFleet() {
      const { camera } = game
      const forward = camera.getWorldDirection(camera.position.clone()).setY(0).normalize()
      const right = forward.clone().cross(camera.up).normalize()
      window.syn3h.bots.vehicles.forEach((vehicle, index) => {
        const at = camera.position.clone().addScaledVector(forward, 22 + 4 * (index % 2))
          .addScaledVector(right, (index - 1.5) * 4)
        at.y = window.syn3h.terrain.heightAt(at.x,at.z) + 2
        vehicle.teleport(at,0)
      })
    }
    let accumulated = 0
    // The controller receives slow evidence at wall-clock pace. Every normal game draw,
    // settle period, rung, bot budget and level decision stays in the production loop.
    governor.sample = function(ms,visible) {
      if (multiplayer === 'manual') return null
      if (!visible) return sample.call(this,ms,false)
      accumulated += ms
      if (accumulated < 75) return null
      if (window.releaseFourthBot && governor.rung + 1 === governor.ladder.length &&
          governor.slowMs + governor.windowMs + accumulated >= governor.shedTiming().shedMs) {
        window.releaseFourthBot()
      }
      if (fleet === 'unshed' && governor.level === 1 && governor.rung + 1 === governor.ladder.length &&
          governor.slowMs + governor.windowMs + accumulated >= governor.shedTiming().shedMs) stageFleet()
      const interval = accumulated
      accumulated = 0
      return sample.call(this,interval,true)
    }
    try {
      if (multiplayer === 'manual') {
        for (let target = entered - 1; target >= 0; target--) {
          if (fleet === 'unshed' && target === 0) stageFleet()
          q.setLevel(target)
          const requested = performance.now()
          while (governor.level !== target || document.querySelector('.quality-change-veil')) {
            if (performance.now() - requested > 20000) throw new Error('Manual quality change timed out at '+target)
            await new Promise(resolve => setTimeout(resolve,50))
          }
          await new Promise(resolve => setTimeout(resolve,650))
        }
      }
      while (governor.level && performance.now()-start < 150000) await new Promise(resolve=>setTimeout(resolve,100))
      await new Promise(resolve=>setTimeout(resolve,1500))
      return {entered,initialRoster,finalRoster:roster(),minimalDraws:[...minimalDraws],peerKind:peerVehicle?.kind,peerDrawLevels:[...peerDrawLevels],backend:game.backend,final:governor.level,calls,changes}
    } finally { governor.sample=sample; unsubscribe(); b.createNodeBuilder=make; b.createRenderPipeline=pipeline; b.draw=draw }
  },{peerId, multiplayer, fleet})
  if (world) {
    result.effectReturn = await page.evaluate(async ({world,entryLevel}) => {
      const {game} = window.syn3h, backend = game.renderer.backend
      const effect = world === 'waterfall' ? 'waterfall-mist' : 'lava-flames'
      const sweep = game.quality.beginDiagnosticSweep(), steps = []
      const draw = backend.draw, build = backend.createNodeBuilder, pipeline = backend.createRenderPipeline
      let row
      backend.draw = function(source,...args) {
        if (source.object?.name === effect) row.draws++
        if (source.object?.name === 'water-ripple-simulation') row.wakeDraws++
        return draw.call(this,source,...args)
      }
      backend.createNodeBuilder = function(...args) {
        const builder = build.apply(this,args), original = builder.build
        builder.build = function(...args) {
          row.graphs.push(this.object?.name || this.material?.type)
          return original.apply(this,args)
        }
        return builder
      }
      backend.createRenderPipeline = function(source,...args) {
        row.pipelines.push(source.object?.name || source.material?.type)
        return pipeline.call(this,source,...args)
      }
      try {
        for (let level=1; level<=entryLevel; level++) {
          row = { level, effect, draws:0, wakeDraws:0, graphs:[], pipelines:[] }
          sweep.step(level)
          for (let i=0;i<42;i++) await new Promise(requestAnimationFrame)
          steps.push(row)
        }
      } finally {
        backend.draw = draw
        backend.createNodeBuilder = build
        backend.createRenderPipeline = pipeline
        sweep.restore()
      }
      return steps
    },{world,entryLevel})
  }
  await writeFile(output,JSON.stringify({...result,viewport,fleet,multiplayer,errors},null,2))
  for (const row of result.effectReturn ?? []) {
    assert(row.draws > 0, row.effect+' must draw on the forced return to '+row.level)
    assert(!row.graphs.includes(row.effect) && !row.pipelines.includes(row.effect),
      row.effect+' built on the forced return to '+row.level)
  }
  if (world === 'waterfall') {
    for (const row of result.effectReturn) {
      assert(row.wakeDraws>0, 'The vehicle wake must run on the return to '+row.level)
      assert.deepEqual([row.graphs,row.pipelines],[[],[]], 'Cold draws on Alpine return to '+row.level)
    }
  }
  assert.deepEqual(errors,[])
  assert.equal(result.backend,backend)
  assert.equal(result.entered,entryLevel)
  if (fleet !== 'empty' && multiplayer !== 'arrival') assert.equal(result.initialRoster.length, 4, 'Full fleet required at measurement start')
  if (fleet === 'unshed') {
    const ids = roster => roster.map(v => v.id).sort((a,b) => a-b)
    const expected = ids(result.initialRoster)
    for (const row of result.changes) assert.deepEqual(ids(row.roster),expected,'The unshed fleet changed during relief')
    assert.deepEqual(ids(result.finalRoster),expected)
    assert.deepEqual(result.minimalDraws.sort((a,b) => a-b),expected,'Each retained bot must draw at Minimal')
  }
  if (peerId !== null) assert.equal(result.peerKind,'jet')
  assert.equal(result.final,0)
  if (multiplayer === 'arrival') assert(result.changes.some(change => change.level === entryLevel-1 &&
    change.roster.some(v => v.kind === 'jet' && v.arriving)), 'Fourth bot must still be arriving when relief lands')
  for(let level=entryLevel-1;level>=0;level--){
    if (peerId !== null) assert(result.peerDrawLevels.includes(level), 'No remote human draw at level '+level)
    const calls=result.calls.filter(call=>call.level===level)
    console.log({entryLevel,backend,level,graphs:calls.filter(c=>c.kind==='graph').length,pipelines:calls.filter(c=>c.kind==='pipeline').length})
    if(calls.length)process.exitCode=1
  }
} finally { await browser.close() }

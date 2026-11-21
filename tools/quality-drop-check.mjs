// Run against a local release build before claiming an automatic quality step is free.
// node tools/quality-drop-check.mjs ORIGIN webgpu|webgl 2|3|4|5 OUTPUT.json [desktop|phone] [stock|empty] [solo|peer]
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'

const [origin, backend, entry, output, viewport = 'desktop', fleet = 'stock', multiplayer = 'solo'] = process.argv.slice(2)
assert(['stock','empty'].includes(fleet) && ['solo','peer'].includes(multiplayer))
const url = new URL(origin), entryLevel = Number(entry)
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
assert(['webgpu','webgl'].includes(backend) && [2,3,4,5].includes(entryLevel) && output && ['desktop','phone'].includes(viewport))
url.searchParams.set('seed','1')
url.searchParams.set('room','quality-check-'+randomUUID().slice(0,8))
if (backend === 'webgl') url.searchParams.set('webgl','1')
const browser = await chromium.launch({channel:'chrome', headless:false})
try {
  const phone = viewport === 'phone'
  const page = await browser.newPage({viewport:phone ? {width:390,height:844} : {width:1280,height:720},
    deviceScaleFactor:phone ? 2 : 1, isMobile:phone, hasTouch:phone})
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.game)
  await page.evaluate(({level,fleet}) => {
    const {game, shell, params} = window.syn3h
    if (fleet === 'empty') params.set('bots.count',0)
    game.quality.setLevel(level)
    game.quality.setAuto(true)
    void shell.play(true)
  },{level:entryLevel,fleet})
  await page.waitForFunction(() => window.syn3hNet?.isHost && window.syn3h.shell.playing &&
    !window.syn3h.shell.transitioning, null, {timeout:90000})
  let peerId = null
  if (multiplayer === 'peer') {
    const peer = await browser.newPage({viewport:{width:640,height:480}})
    const peerUrl = new URL(url)
    peerUrl.searchParams.set('vehicle','jet')
    await peer.goto(peerUrl.href)
    await peer.waitForFunction(() => window.syn3h?.shell)
    await peer.evaluate(() => window.syn3h.shell.play(true))
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
  if (fleet === 'stock') {
    await page.waitForFunction(() => {
      const {bots,materialize} = window.syn3h
      const vehicles = bots.vehicles
      return vehicles.length === 4 && ['buggy','hovercraft','jet'].every(kind => vehicles.some(v => v.kind === kind))
        && vehicles.every(v => !materialize.isMaterializing(v))
    }, null, {timeout:120000})
  }
  const result = await page.evaluate(async peerId => {
    const {game} = window.syn3h, q = game.quality, governor = q.governor, b = game.renderer.backend
    const roster = () => window.syn3h.bots.vehicles.map(v => ({kind:v.kind,id:v.object.id}))
    const initialRoster = roster()
    const peerDrawLevels = new Set()
    const draw = b.draw
    if (peerId !== null) b.draw = function(source,...args) {
      const result = draw.call(this,source,...args)
      if (window.syn3hNet.remotes.get(peerId)?.vehicle.object.getObjectById(source.object.id)) peerDrawLevels.add(governor.level)
      return result
    }
    const entered = governor.level, start = performance.now(), calls = [], changes = []
    function record(kind, source) {
      const actor = window.syn3h.bots.vehicles.find(vehicle => vehicle.object.getObjectById(source.object?.id))

      calls.push({kind, level:governor.level, frame:game.frames, ms:performance.now()-start,
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
    let accumulated = 0
    // The controller receives slow evidence at wall-clock pace. Every normal game draw,
    // settle period, rung, bot budget and level decision stays in the production loop.
    governor.sample = function(ms,visible) {
      if (!visible) return sample.call(this,ms,false)
      accumulated += ms
      if (accumulated < 75) return null
      const interval = accumulated
      accumulated = 0
      return sample.call(this,interval,true)
    }
    try {
      while (governor.level && performance.now()-start < 150000) await new Promise(resolve=>setTimeout(resolve,100))
      await new Promise(resolve=>setTimeout(resolve,1500))
      return {entered,initialRoster,peerDrawLevels:[...peerDrawLevels],backend:game.backend,final:governor.level,calls,changes}
    } finally { governor.sample=sample; unsubscribe(); b.createNodeBuilder=make; b.createRenderPipeline=pipeline; b.draw=draw }
  },peerId)
  await writeFile(output,JSON.stringify({...result,viewport,fleet,multiplayer,errors},null,2))
  assert.deepEqual(errors,[])
  assert.equal(result.backend,backend)
  assert.equal(result.entered,entryLevel)
  assert.equal(result.final,0)
  for(let level=entryLevel-1;level>=0;level--){
    if (peerId !== null) assert(result.peerDrawLevels.includes(level), 'No remote human draw at level '+level)
    const calls=result.calls.filter(call=>call.level===level)
    console.log({entryLevel,backend,level,graphs:calls.filter(c=>c.kind==='graph').length,pipelines:calls.filter(c=>c.kind==='pipeline').length})
    if(calls.length)process.exitCode=1
  }
} finally { await browser.close() }

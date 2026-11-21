// Run against a local release build before claiming an automatic quality step is free.
// node tools/quality-drop-check.mjs ORIGIN webgpu|webgl 2|3|4|5 OUTPUT.json [desktop|phone] [stock|empty] [solo|peer|arrival]
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'

const [origin, backend, entry, output, viewport = 'desktop', fleet = 'stock', multiplayer = 'solo'] = process.argv.slice(2)
assert(['stock','empty'].includes(fleet) && ['solo','peer','arrival'].includes(multiplayer))
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
  await page.evaluate(({level,fleet,multiplayer}) => {
    const {game, shell, params} = window.syn3h
    if (fleet === 'empty') params.set('bots.count',0)
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
    void shell.play(true)
  },{level:entryLevel,fleet,multiplayer})
  await page.waitForFunction(() => window.syn3hNet?.isHost && window.syn3h.shell.playing &&
    !window.syn3h.shell.transitioning, null, {timeout:90000})
  if (multiplayer === 'arrival') {
    await page.waitForFunction(() => typeof window.releaseFourthBot === 'function',null,{timeout:120000})
  } else if (fleet === 'stock') {
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
  const result = await page.evaluate(async ({peerId, multiplayer}) => {
    const {game} = window.syn3h, q = game.quality, governor = q.governor, b = game.renderer.backend
    const roster = () => window.syn3h.bots.vehicles.map(v => ({kind:v.kind,id:v.object.id,arriving:window.syn3h.materialize.isMaterializing(v)}))
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

      const fx = window.syn3h.materialize
      const effect = source.object === fx.cloud.mesh ? 'arrival cloud' : fx.looks.flatMap((look,i) =>
        ['volume','ground','flash','beam'].filter(key=>look[key]===source.object).map(key=>key+' '+i))[0]
      calls.push({effect,ghost:source.object?.userData.arrivalGhost,parent:source.object?.parent?.name,materialId:source.material?.id,kind, level:governor.level, frame:game.frames, ms:performance.now()-start,
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
      if (window.releaseFourthBot && governor.rung + 1 === governor.ladder.length &&
          governor.slowMs + governor.windowMs + accumulated >= governor.shedTiming().shedMs) {
        window.releaseFourthBot()
      }
      const interval = accumulated
      accumulated = 0
      return sample.call(this,interval,true)
    }
    try {
      while (governor.level && performance.now()-start < 150000) await new Promise(resolve=>setTimeout(resolve,100))
      await new Promise(resolve=>setTimeout(resolve,1500))
      return {entered,initialRoster,peerDrawLevels:[...peerDrawLevels],backend:game.backend,final:governor.level,calls,changes}
    } finally { governor.sample=sample; unsubscribe(); b.createNodeBuilder=make; b.createRenderPipeline=pipeline; b.draw=draw }
  },{peerId, multiplayer})
  await writeFile(output,JSON.stringify({...result,viewport,fleet,multiplayer,errors},null,2))
  assert.deepEqual(errors,[])
  assert.equal(result.backend,backend)
  assert.equal(result.entered,entryLevel)
  if (fleet === 'stock' && multiplayer !== 'arrival') assert.equal(result.initialRoster.length, 4, 'Full fleet required at measurement start')
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

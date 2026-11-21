// Run against a local release build before claiming an automatic quality step is free.
// node tools/quality-drop-check.mjs ORIGIN webgpu|webgl 3|5 OUTPUT.json
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'

const [origin, backend, entry, output] = process.argv.slice(2)
const url = new URL(origin), entryLevel = Number(entry)
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
assert(['webgpu','webgl'].includes(backend) && [3,5].includes(entryLevel) && output)
url.searchParams.set('seed','1')
url.searchParams.set('room','quality-check-'+randomUUID().slice(0,8))
if (backend === 'webgl') url.searchParams.set('webgl','1')
const browser = await chromium.launch({channel:'chrome', headless:false})
try {
  const page = await browser.newPage({viewport:{width:1280,height:720}})
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.game)
  await page.evaluate(level => {
    const {game, shell, params} = window.syn3h
    params.set('bots.count',0)
    game.quality.setLevel(level)
    game.quality.setAuto(true)
    void shell.play(true)
  },entryLevel)
  await page.waitForFunction(() => window.syn3hNet?.isHost && window.syn3h.shell.playing &&
    !window.syn3h.shell.transitioning, null, {timeout:90000})
  const result = await page.evaluate(async () => {
    const {game} = window.syn3h, q = game.quality, governor = q.governor, b = game.renderer.backend
    const entered = governor.level, start = performance.now(), calls = [], changes = []
    function record(kind, source) {
      calls.push({kind, level:governor.level, frame:game.frames, ms:performance.now()-start,
        object:source.object?.name, material:source.material?.name || source.material?.type})
    }
    const make = b.createNodeBuilder, pipeline = b.createRenderPipeline, sample = governor.sample
    b.createNodeBuilder = function(...args) {
      const node = make.apply(this,args), build = node.build
      node.build = function(...args) { record('graph',this); return build.apply(this,args) }
      return node
    }
    b.createRenderPipeline = function(ro,...args) { record('pipeline',ro); return pipeline.call(this,ro,...args) }
    const unsubscribe = q.subscribeQuality(s => changes.push({ms:performance.now()-start,level:s.level,rung:s.rung}))
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
      return {entered,backend:game.backend,final:governor.level,calls,changes}
    } finally { governor.sample=sample; unsubscribe(); b.createNodeBuilder=make; b.createRenderPipeline=pipeline }
  })
  await writeFile(output,JSON.stringify({...result,errors},null,2))
  assert.deepEqual(errors,[])
  assert.equal(result.backend,backend)
  assert.equal(result.entered,entryLevel)
  assert.equal(result.final,0)
  for(let level=entryLevel-1;level>=0;level--){
    const calls=result.calls.filter(call=>call.level===level)
    console.log({entryLevel,backend,level,graphs:calls.filter(c=>c.kind==='graph').length,pipelines:calls.filter(c=>c.kind==='pipeline').length})
    if(calls.length)process.exitCode=1
  }
} finally { await browser.close() }

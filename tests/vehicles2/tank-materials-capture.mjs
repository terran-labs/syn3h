// Run as the lane's sole heavy.sh job, after release clearance.
// node tests/vehicles2/tank-materials-capture.mjs BEFORE_URL AFTER_URL OUTPUT_DIR
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const [before, after, out] = process.argv.slice(2)
assert.ok(before && after && out)
await mkdir(out, { recursive: true })
const report = { errors: [], lineup: {}, tiers: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', e => report.errors.push(e.message))
const frames = n => page.evaluate(n => new Promise(resolve => { let left=n; const f=()=>--left<=0?resolve():requestAnimationFrame(f); requestAnimationFrame(f) }), n)
try {
 for (const [label, base] of [['before', before], ['after', after]]) {
  await page.goto(base + '/vehicle-lab.html?vehicle=lineup&design=all')
  await page.waitForFunction(() => window.vehicleLab?.ready && window.vehicleLab.stats().designs.length===4, null, { timeout: 180000 })
  await page.evaluate(async () => { const l=window.vehicleLab; l.setIdle(0); l.setMotion(false); l.setTurntable(false); await l.setLod(0); l.orbit(30,20); await l.frames(30) })
  await page.screenshot({ path: `${out}/lineup-${label}.png` })
  const geometry = await page.evaluate(() => {
   const root=window.vehicleLab.scene.getObjectByName('Exploration tank'), meshes=[]
   if(!root) throw Error('Tank missing from lineup')
   root.traverse(o=>{if(o.isMesh) meshes.push({name:o.name,position:Array.from(o.geometry.attributes.position.array),normal:Array.from(o.geometry.attributes.normal.array),index:o.geometry.index?Array.from(o.geometry.index.array):null})})
   return meshes
  })
  report.lineup[label]={stats:await page.evaluate(()=>window.vehicleLab.stats()),geometryHash:createHash('sha256').update(JSON.stringify(geometry)).digest('hex')}
 }
 assert.equal(report.lineup.before.geometryHash,report.lineup.after.geometryHash,'Approved geometry or normals changed')
 for (const tier of [0,1,2,3]) {
  await page.goto(after+'/?autoplay=1&vehicle=buggy&room=tank-materials-check')
  await page.waitForFunction(()=>window.mira?.game.tick>2,null,{timeout:180000})
  await page.evaluate(tier=>{const s=window.mira;s.params.set('gfx.auto',false);s.params.set('gfx.vehicleShading',tier);s.params.set('bots.count',0);s.params.set('sun.timeOfDay',12);s.params.set('sun.dayLength',0)},tier)
  await page.waitForFunction(()=>window.mira.game.scene.userData.playerVehicleCache?.pending===false,null,{timeout:180000})
  await frames(120)
  await page.evaluate(()=>{window.__tankPipelines=0;const d=window.mira.game.renderer.backend.device;if(!d)throw Error('WebGPU required for pipeline evidence');for(const k of ['createRenderPipeline','createRenderPipelineAsync']){const original=d[k].bind(d);d[k]=(...args)=>{window.__tankPipelines++;return original(...args)}}})
  await page.evaluate(()=>window.mira.shell.switchVehicle('tank'))
  await frames(120)
  const result=await page.evaluate(()=>{const s=window.mira;let lights=0;s.game.scene.traverse(o=>{if(o.isLight)lights++});return {tier:s.params.get('gfx.vehicleShading').value,kind:s.player.kind,ownLamps:s.player.object.userData.ownLamps,pipelines:window.__tankPipelines,lights}})
  report.tiers.push(result)
  console.log(JSON.stringify(result))
  await page.evaluate(()=>{const s=window.mira,v=s.player,p=v.object.position.clone(),eye=p.clone().add({x:9,y:5,z:-10});s.camera.setCinematicPose(eye,p.clone().add({x:0,y:1,z:0}),55)})
  await frames(90)
  await page.screenshot({path:`${out}/tank-tier-${tier}.png`})
  if(tier===2) for(const [name,body] of [['blue','#1768b4'],['red','#b42632']]) for(const [time,hour] of [['day',12],['night',23]]) {
   await page.evaluate(({body,hour})=>{const s=window.mira;s.player.setColors(body,'#49e6ff');s.params.set('sun.timeOfDay',hour)},{body,hour})
   await frames(120)
   await page.screenshot({path:`${out}/tank-${name}-${time}.png`})
  }
  assert.equal(result.kind,'tank');assert.equal(result.ownLamps,true);assert.equal(result.tier,tier)
 }
 assert.equal(report.errors.length,0)
 for(const tier of report.tiers)assert.equal(tier.pipelines,0,`Tier ${tier.tier} compiled during warmed tank switch`)
} catch(e) {report.failure=String(e);process.exitCode=1} finally {
 await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));await browser.close()
 console.log(JSON.stringify(report))
}

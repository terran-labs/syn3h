/** Normal-entry lighting/tier checks. Run serially through tools/heavy.sh. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [base, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { results: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('room', `post-entry-${Date.now()}`)
  if (process.argv.includes('--webgl')) url.searchParams.set('webgl', '1')
  // No post/cinematic/quality opt-ins. Enter through the ordinary lobby button.
  await page.goto(url.href, { timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 90000 })
  const target = await page.evaluate(() => window.syn3h.shell.galaxy.screen.find(s => s.id === window.syn3h.planets.currentPlanet().id))
  assert.ok(target, 'current planet has a normal lobby target')
  await page.mouse.click(target.x, target.y)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && !window.syn3h.shell.dropping, null, { timeout: 120000 })
  const enteredAt = await page.evaluate(() => window.syn3h.game.tick)
  await page.waitForFunction(tick => window.syn3h.game.tick > tick + 120, enteredAt, { timeout: 120000 })
  const entry = await page.evaluate(() => {
    const s = window.syn3h, g = s.game
    const ids = ['post.on','post.gi','post.clouds','post.temporal','light.bounce','light.shadowSoftness','light.shadowStrength','terrain.relief','terrain.detailNormal','terrain.surfaceResponse','terrain.macroColour','terrain.accent','weather.aerial']
    return { name:'normal-entry', backend:g.backend, tier:g.postChain.tier, values:Object.fromEntries(ids.map(id=>[id,s.params.get(id)?.value])) }
  })
  assert.equal(entry.values['post.gi'], 1); assert.equal(entry.values['post.on'], true);
  assert.equal(entry.values['post.clouds'], 1)
  assert.equal(entry.values['post.temporal'], true)
  assert.equal(entry.values['light.bounce'], 1); assert.equal(entry.values['terrain.relief'], .2)
  assert.equal(entry.values['weather.aerial'], 1)
  for (const id of ['terrain.detailNormal','terrain.surfaceResponse','terrain.macroColour','terrain.accent']) assert.equal(entry.values[id], 1)
  report.results.push(entry)
  await page.screenshot({path:`${out}/normal-entry.png`})
  await page.evaluate(() => {
    const g = window.syn3h.game
    g.renderer.setAnimationLoop(null)
    window.entryEnvironment = g.systems.find(s=>s.sunDirection && s.sunColor)
  })
  const cases = [
    {name:'low-sun',hour:17.6,level:2},
    {name:'low-previous-relief',hour:17.6,level:2,relief:1},
    {name:'noon',hour:12,level:2},
    {name:'noon-no-occlusion',hour:12,level:2,ao:0,contact:0},
    {name:'night',hour:23,level:2},
    {name:'lite',hour:12,level:1},
    {name:'safe',hour:12,level:0},
    {name:'toggle-off',hour:12,level:2,on:false},
    {name:'restore-full',hour:12,level:2},
  ]
  for (const c of cases) {
    const result = await page.evaluate(async c => {
      const s=window.syn3h,g=s.game,p=s.params
      p.set('gfx.level',c.level);p.set('post.on',c.on??true)
      p.set('terrain.relief',c.relief??.2);p.set('post.ao',c.ao??1);p.set('post.contact',c.contact??1)
      p.set('sun.timeOfDay',c.hour)
      for(let i=0;i<32;i++) {
        window.entryEnvironment.update(.25)
        for(const system of g.systems) if(system.vehicles instanceof Map)system.update(0)
        g.postChain.render(g.renderer,g.scene,g.camera,16.667)
        await new Promise(requestAnimationFrame)
      }
      const lights=[];g.scene.traverse(o=>{if(o.isDirectionalLight&&o.castShadow)lights.push({radius:o.shadow.radius,intensity:o.shadow.intensity})})
      const env=window.entryEnvironment, sky=g.scene.children.find(o=>'cloudLayerVisible' in o)
      return {name:c.name,tier:g.postChain.tier,level:p.get('gfx.level').value,budget:g.quality.postBudget,lights,temporal:!!g.postChain.built?.temporalNode,clouds:!!g.postChain.built?.clouds,fallback:sky?.cloudLayerVisible,cloudInputs:{coverage:env.clouds.coverage,density:env.clouds.density,air:env.clouds.atmosphere}}
    },c)
    const expected=c.on===false||c.level===0?'off':result.budget<=0?'base':c.level===1?'lite':'full'
    assert.equal(result.tier,expected)
    assert.equal(result.temporal,expected==='full')
    const cloudExpected=expected==='full'&&result.cloudInputs.coverage>0&&result.cloudInputs.density>0&&result.cloudInputs.air>0
    assert.equal(result.clouds,cloudExpected);assert.equal(result.fallback,!cloudExpected)
    for(const l of result.lights){assert.equal(l.radius,2);assert.equal(l.intensity,.85)}
    report.results.push(result)
    await page.screenshot({path:`${out}/${c.name}.png`})
  }
  assert.deepEqual(report.errors,[])
} finally {
  writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  await browser.close()
}

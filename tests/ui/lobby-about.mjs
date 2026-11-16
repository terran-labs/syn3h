import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const out='tests/ui/artifacts/lobby-about'; await mkdir(out,{recursive:true})
const report=[]
for(const mode of ['desktop','phone','short-phone']){
 const browser=await(mode==='desktop'?chromium.launch({channel:'chrome',headless:true}):webkit.launch())
 try{
  const context=await browser.newContext(mode==='desktop'?{viewport:{width:1440,height:1000}}:{...devices['iPhone 14'],...(mode==='short-phone'?{viewport:{width:390,height:560}}:{})})
  const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`${process.env.SYN3H_URL}?room=about-${mode}-${Date.now()}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  await page.waitForTimeout(5000)
  const canvas=await page.locator('.galaxy-canvas').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{x:r.x,y:r.y,w:r.width,h:r.height,mask:s.maskImage||s.webkitMaskImage,vw:innerWidth,vh:innerHeight}})
  assert.equal(canvas.mask,'none');assert.ok(canvas.x<=0&&canvas.y<=0&&canvas.w>=canvas.vw&&canvas.h>=canvas.vh)
  await page.screenshot({path:`${out}/${mode}-animated.png`})
  // Detach only the test's logo renderer while the galaxy keeps drawing. This exercises
  // the existing SVG bridge without changing styling or racing onLogo each frame.
  await page.evaluate(() => { const g=syn3h.shell.galaxy; window.__savedLogo=g.logo; g.logo=null; g.wake=2; document.querySelector('.syn3h-shell').classList.remove('has-animated-logo') })
  try { await page.waitForFunction(()=>document.querySelector('.shell-logo').getAnimations().every(a=>a.playState!=='running'),null,{timeout:10000}) }
  catch(error){ console.log('SVG entrance timeout',await page.locator('.shell-logo').evaluate(el=>el.getAnimations().map(a=>({state:a.playState,time:a.currentTime,timing:a.effect.getComputedTiming()}))));throw error }
  assert.equal(await page.locator('.shell-logo').evaluate(el=>getComputedStyle(el).opacity),'1')
  assert.equal(await page.evaluate(()=>syn3h.shell.galaxy.logo),null)
  await page.screenshot({path:`${out}/${mode}-static.png`})
  await page.evaluate(()=>{ const g=syn3h.shell.galaxy;g.logo=window.__savedLogo;g.wake=2 })
  await page.waitForFunction(()=>document.querySelector('.syn3h-shell').classList.contains('has-animated-logo'))
  const nav=page.locator('.galaxy-links')
  await nav.locator('[data-goto=about]').click()
  await page.waitForFunction(()=>document.querySelector('.lobby-panels').dataset.busy==='false')
  const about=page.locator('[data-panel=about]')
  const geometry=await page.locator('.lobby-panels').evaluate(el=>{const r=el.getBoundingClientRect();return {layoutWidth:getComputedStyle(el).width,rect:{x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom},stageTransform:getComputedStyle(el.closest('.lobby-stage')).transform,viewportWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth}})
  console.log(JSON.stringify({mode,geometry}))
  if(mode==='desktop')assert.equal(geometry.layoutWidth,'900px')
  assert.ok(geometry.rect.x>=0 && geometry.rect.right<=geometry.viewportWidth,'projected panel fits viewport')
  assert.ok(geometry.scrollWidth<=geometry.viewportWidth,'no horizontal document overflow')
  assert.equal(await about.locator('a[href="https://aubreyfalconer.com"]').count(),1)
  assert.equal(await about.locator('a[href="https://github.com/terran-labs/syn3h"]').count(),1)
  assert.equal(await about.locator('a[href*="tarranlabmoods"]').count(),0)
  const cols=await about.locator('.about-columns').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)
  assert.equal(cols,mode==='desktop'?2:1)
  await page.screenshot({path:`${out}/${mode}-about-top.png`})
  await about.locator('.shell-credits summary').click()
  assert.equal(await about.locator('.shell-credits').evaluate(el=>el.open),true)
  assert.equal(await about.locator('a[href^="/brand/licenses/"]').count(),10)
  await about.locator('.panel-back').scrollIntoViewIfNeeded()
  await page.screenshot({path:`${out}/${mode}-about-credits-bottom.png`})
  assert.ok(await about.locator('.panel-back').isVisible())
  const backPaths=[]
  for(const id of ['about','explore','worlds','settings','music','multiplayer','advanced']){
   await page.evaluate(id=>syn3h.shell.showPanel(id),id)
   await page.waitForFunction(()=>document.querySelector('.lobby-panels').dataset.busy==='false')
   const back=page.locator(`[data-panel=${id}] .panel-back`);await back.scrollIntoViewIfNeeded();await back.focus()
   const r=await back.boundingBox();assert.ok(r.height>=44);if(mode==='desktop')assert.ok(r.width>=160)
   assert.equal(await back.locator('[aria-hidden=true]').innerText(),'←')
   await page.keyboard.press('Enter'); await page.locator('.lobby-panels').waitFor({state:'hidden'})
   assert.equal(await nav.locator('button').first().evaluate(el=>el===document.activeElement),true)
   backPaths.push({id,width:r.width,height:r.height})
  }
  await nav.locator('[data-goto=multiplayer]').click();await page.locator('[data-panel=multiplayer] [data-join]').click()
  const invite=page.locator('.join-view'), back=invite.locator('.join-close');await invite.waitFor({state:'visible'})
  assert.equal(await back.evaluate(el=>el===document.activeElement),true)
  const r=await back.boundingBox();assert.ok(r.height>=44);if(mode==='desktop')assert.ok(r.width>=160)
  await page.screenshot({path:`${out}/${mode}-invite.png`});await page.keyboard.press('Enter');await invite.waitFor({state:'hidden'})
  backPaths.push({id:'invite',width:r.width,height:r.height})
  await page.keyboard.press('Escape');await page.locator('.lobby-panels').waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);report.push({mode,canvas,geometry,cols,backPaths,errors});console.log(JSON.stringify(report.at(-1)))
 }finally{await browser.close()}
}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))

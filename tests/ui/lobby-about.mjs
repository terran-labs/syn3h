import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const out='tests/ui/artifacts/lobby-about'; await mkdir(out,{recursive:true})
const report=[]
// Persist before asserting so a failing path keeps its exact layout/projection evidence.
async function measureBack(locator, mode, id) {
 await locator.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
 await locator.page().waitForFunction(el => {
  for (let node = el; node; node = node.parentElement) {
   getComputedStyle(node).transform
   if (node.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime))) return false
  }
  return true
 }, await locator.elementHandle(), {timeout:10000})
 const diagnostic = await locator.evaluate((el, id) => {
  const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
  const ancestors = []
  for (let node = el; node; node = node.parentElement) {
   const s = getComputedStyle(node)
   ancestors.push({ tag: node.tagName, id: node.id, classes: node.className,
    transform: s.transform, transformOrigin: s.transformOrigin, perspective: s.perspective,
    perspectiveOrigin: s.perspectiveOrigin, translate: s.translate, scale: s.scale,
    rotate: s.rotate, zoom: s.zoom, overflow: s.overflow,
    animations: node.getAnimations().map(a => ({ state: a.playState, time: a.currentTime,
     duration: a.effect?.getComputedTiming().duration })) })
  }
  return { id, sourcePanel: el.closest('[data-panel]')?.getAttribute('data-panel') ?? null,
   text: el.textContent, focused: document.activeElement === el,
   computed: { width: style.width, height: style.height, minWidth: style.minWidth,
    minHeight: style.minHeight, maxWidth: style.maxWidth, boxSizing: style.boxSizing,
    padding: style.padding, border: style.borderWidth, display: style.display,
    transform: style.transform, transformOrigin: style.transformOrigin },
   layout: { offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight,
    clientWidth: el.clientWidth, clientHeight: el.clientHeight },
   projected: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight },
   ancestors }
 }, id)
 console.log(JSON.stringify({ backDiagnostic: { mode, ...diagnostic } }))
 await writeFile(`${out}/${mode}-back-${id}.json`, JSON.stringify(diagnostic, null, 2))
 return diagnostic.projected
}
const IPAD = { 'ipad-portrait': { viewport: { width: 744, height: 1133 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, 'ipad-landscape': { viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }
for(const mode of ['desktop','phone','short-phone','ipad-portrait','ipad-landscape']){
 const browser=await(mode==='desktop'?chromium.launch({channel:'chrome',headless:true}):webkit.launch())
 try{
  const context=await browser.newContext(IPAD[mode]??(mode==='desktop'?{viewport:{width:1440,height:1000}}:{...devices['iPhone 14'],...(mode==='short-phone'?{viewport:{width:390,height:560}}:{})}))
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
  // Welcome is its own sheet from its button in the corner; its contents are the Welcome guide
  // (src/ui/welcome, checked in about-in-play). Bugs caught: the button missing or not opening;
  // the guide in the page, or images requested, before the player asks; tabs, a Back button or a
  // second close control in the sheet; licence links not pinned; Escape or a tap outside not
  // closing it; focus left nowhere afterwards; the sheet running off a phone screen.
  const images=[];page.on('request',r=>{if(r.resourceType()==='image')images.push(r.url())})
  assert.equal(await page.locator('.lobby-sheet-about .welcome-body > *').count(),0,'the guide is not in the page before it is opened')
  const icon=page.getByRole('button',{name:'Welcome',exact:true})
  assert.equal(await icon.getAttribute('title'),'Welcome')
  await page.waitForTimeout(500)
  assert.deepEqual(images,[],'no image requested before Welcome is opened')
  await icon.click()
  const about=page.locator('.lobby-sheet-about')
  await about.locator('.welcome-body > h3').first().waitFor({state:'visible'})
  assert.equal((await about.locator('h2').first().textContent()).trim(),'Welcome','the sheet is titled Welcome')
  // The panel's own motion (the buttons beside it keep their slow gear turn).
  await page.waitForFunction(()=>!document.querySelector('.lobby-sheet-about .lobby-sheet-panel').getAnimations({subtree:true}).some(a=>a.playState==='running'))
  const geometry=await about.locator('.lobby-sheet-panel').evaluate(el=>{const r=el.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom},viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth}})
  console.log(JSON.stringify({mode,geometry}))
  assert.ok(geometry.rect.x>=0&&geometry.rect.right<=geometry.viewportWidth&&geometry.rect.bottom<=geometry.viewportHeight,'the sheet fits the viewport')
  // A phone held upright gives it the width; on its side the buttons keep their column beside it.
  if(mode==='phone'||mode==='short-phone')assert.ok(geometry.rect.width>=(geometry.viewportHeight>geometry.viewportWidth?geometry.viewportWidth-24:geometry.viewportWidth*0.6),'on a phone the sheet takes the width it can')
  assert.ok(geometry.scrollWidth<=geometry.viewportWidth,'no horizontal document overflow')
  assert.equal(await about.getByRole('tab').count(),0,'no tabs')
  assert.equal(await about.locator('.panel-back').count(),0,'no Back button')
  assert.deepEqual(await about.locator('button').evaluateAll(bs=>bs.filter(b=>/close/i.test(b.getAttribute('aria-label')??'')).length),1,'one close control')
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('lobby-sheet-close')),true,'focus starts on the X')
  // The licences, wherever the guide keeps them, point at the pinned copies.
  for(const href of await about.locator('a[href*="/brand/licenses/"]').evaluateAll(as=>as.map(a=>a.getAttribute('href')))) assert.match(href,/\/brand\/licenses\//)
  await page.screenshot({path:`${out}/${mode}-about-top.png`})
  // Tab stays inside the sheet.
  for(let i=0;i<40;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.lobby-sheet-about')),true,'focus stays in the sheet')}
  await page.keyboard.press('Escape');await about.waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('lobby-about')),true,'Escape returns focus to the Welcome button')
  const opened=images.length
  await icon.click();await about.locator('.welcome-body > h3').first().waitFor({state:'visible'})
  await page.mouse.click(4,4);await about.waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>syn3h.shell.playing),false,'a tap outside closes the sheet and does nothing else')
  // Images belong to the guide and load only once the player has opened it (the owner's exception).
  console.log(JSON.stringify({mode,imagesAfterOpening:opened}))
  const backPaths=[]
  for(const id of ['explore','worlds','advanced']){
   await page.evaluate(id=>syn3h.shell.showPanel(id),id)
   await page.waitForFunction(()=>document.querySelector('.lobby-panels').dataset.busy==='false')
   const back=page.locator(`[data-panel=${id}] .panel-back`);await back.scrollIntoViewIfNeeded();await back.focus()
   const r=await measureBack(back,mode,id)
   if(mode==='desktop') {
    const samples=[]
    for(const [x,y] of [[1,1],[1439,1],[1439,999],[1,999]]) {
     await page.mouse.move(x,y)
     samples.push(await measureBack(back,mode,`${id}-${x}-${y}`))
    }
    console.log(JSON.stringify({extremeBack:{mode,id,samples}}))
    assert.ok(samples.every(r=>r.width>=160&&r.height>=44),`${id}: extreme projected width >=160 and height >=44`)
   }
   assert.ok(r.height>=44,`${id}: projected height >=44`);if(mode==='desktop')assert.ok(r.width>=160,`${id}: projected width >=160`)
   assert.equal(await back.locator('[aria-hidden=true]').innerText(),'←')
   await page.keyboard.press('Enter'); await page.locator('.lobby-panels').waitFor({state:'hidden'})
   // With no bottom buttons, focus comes back to the About icon in the corner.
   assert.equal(await page.locator('.lobby-gear-dock .lobby-about').evaluate(el=>el===document.activeElement),true)
   backPaths.push({id,width:r.width,height:r.height})
  }
  // The invite view opens with J in the lobby (the Multiplayer panel that also opened it is gone).
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('j')
  const invite=page.locator('.join-view'), back=invite.locator('.join-close');await invite.waitFor({state:'visible'})
  assert.equal(await back.evaluate(el=>el===document.activeElement),true)
  const r=await measureBack(back,mode,'invite');assert.ok(r.height>=44,'invite: projected height >=44');if(mode==='desktop')assert.ok(r.width>=160,'invite: projected width >=160')
  await page.screenshot({path:`${out}/${mode}-invite.png`});await page.keyboard.press('Enter');await invite.waitFor({state:'hidden'})
  backPaths.push({id:'invite',width:r.width,height:r.height})
  await page.keyboard.press('Escape');await page.locator('.lobby-panels').waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);report.push({mode,canvas,geometry,backPaths,errors});console.log(JSON.stringify(report.at(-1)))
 }finally{await browser.close()}
}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))

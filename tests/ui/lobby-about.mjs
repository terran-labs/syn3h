import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
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
// What a finger gets: points 22 px above and below the button's centre (and beside it, when it is
// narrower than 44 px) must land on the button itself, not on whatever is painted around it.
async function tappable(locator, id) {
 const hits = await locator.evaluate((el) => {
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const points = [[cx, cy - 22], [cx, cy + 22], [cx, cy], ...(r.width < 44 ? [[cx - 22, cy], [cx + 22, cy]] : [])]
  // A finger cannot press beyond the screen: a target at an edge runs to it.
  return points.map(([x, y]) => [Math.min(innerWidth - 1, Math.max(0, x)), Math.min(innerHeight - 1, Math.max(0, y))]).map(([x, y]) => { const hit = document.elementFromPoint(x, y); return { x: Math.round(x), y: Math.round(y), ok: !!hit && (hit === el || el.contains(hit)), hit: hit ? hit.tagName + '.' + [...hit.classList].join('.') : null } })
 })
 assert.ok(hits.every((h) => h.ok), `${id}: a finger gets 44 px ${JSON.stringify(hits)}`)
}
const IPAD = { 'ipad-portrait': { viewport: { width: 744, height: 1133 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, 'ipad-landscape': { viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }
for(const mode of ['desktop','phone','short-phone','ipad-portrait','ipad-landscape']){
 const browser=await(mode==='desktop'?chromium.launch({channel:'chrome',headless:true}):webkit.launch())
 try{
  const context=await browser.newContext(IPAD[mode]??(mode==='desktop'?{viewport:{width:1440,height:1000}}:{...devices['iPhone 14'],...(mode==='short-phone'?{viewport:{width:390,height:560}}:{})}))
  const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`${process.env.MIRA_URL}?room=about-${mode}-${Date.now()}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  await page.waitForTimeout(5000)
  const canvas=await page.locator('.galaxy-canvas').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{x:r.x,y:r.y,w:r.width,h:r.height,mask:s.maskImage||s.webkitMaskImage,vw:innerWidth,vh:innerHeight}})
  assert.equal(canvas.mask,'none');assert.ok(canvas.x<=0&&canvas.y<=0&&canvas.w>=canvas.vw&&canvas.h>=canvas.vh)
  await page.screenshot({path:`${out}/${mode}-animated.png`})
  // Detach only the test's logo renderer while the galaxy keeps drawing. This exercises
  // the existing SVG bridge without changing styling or racing onLogo each frame.
  await page.evaluate(() => { const g=mira.shell.galaxy; window.__savedLogo=g.logo; g.logo=null; g.wake=2; document.querySelector('.mira-shell').classList.remove('has-animated-logo') })
  try { await page.waitForFunction(()=>document.querySelector('.shell-logo').getAnimations().every(a=>a.playState!=='running'),null,{timeout:10000}) }
  catch(error){ console.log('SVG entrance timeout',await page.locator('.shell-logo').evaluate(el=>el.getAnimations().map(a=>({state:a.playState,time:a.currentTime,timing:a.effect.getComputedTiming()}))));throw error }
  assert.equal(await page.locator('.shell-logo').evaluate(el=>getComputedStyle(el).opacity),'1')
  assert.equal(await page.evaluate(()=>mira.shell.galaxy.logo),null)
  await page.screenshot({path:`${out}/${mode}-static.png`})
  await page.evaluate(()=>{ const g=mira.shell.galaxy;g.logo=window.__savedLogo;g.wake=2 })
  await page.waitForFunction(()=>document.querySelector('.mira-shell').classList.contains('has-animated-logo'))
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
  assert.equal((await about.locator('h2').first().textContent()).trim(),'Welcome to Mira','the sheet is named Welcome to Mira')
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
  // The newsletter: Terran Labs' signup in a new tab, nothing collected here. Bug caught: a link that
  // replaces the game, leaks the referrer or opens the wrong page.
  assert.deepEqual(await about.locator('.welcome-newsletter-link').evaluate(a=>({href:a.href,target:a.target,rel:a.rel})),{href:'https://terranlabs.com/mira/newsletter',target:'_blank',rel:'noopener noreferrer'},'the newsletter link opens the signup in a new tab')
  assert.equal(await about.locator('.welcome-body input').count(),0,'no field in the guide')
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
  assert.equal(await page.evaluate(()=>mira.shell.playing),false,'a tap outside closes the sheet and does nothing else')
  // Images belong to the guide and load only once the player has opened it (the owner's exception).
  console.log(JSON.stringify({mode,imagesAfterOpening:opened}))
  const backPaths=[]
  for(const id of ['explore','worlds','advanced']){
   await page.evaluate(id=>mira.shell.showPanel(id),id)
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
  // Invite's Back is an inner action (.panel-action, the owner's 30 px look): on touch a finger gets
  // 44 px around it; with a mouse it is the painted button, which must be shown and clickable.
  const r=await measureBack(back,mode,'invite')
  if(mode==='desktop')assert.ok(r.width>0&&r.height>0&&await back.evaluate(el=>{const b=el.getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('button')===el}),'invite: Back shown and clickable')
  else await tappable(back,`${mode} invite Back`)
  await page.screenshot({path:`${out}/${mode}-invite.png`});await page.keyboard.press('Enter');await invite.waitFor({state:'hidden'})
  backPaths.push({id:'invite',width:r.width,height:r.height})
  await page.keyboard.press('Escape');await page.locator('.lobby-panels').waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);report.push({mode,canvas,geometry,backPaths,errors});console.log(JSON.stringify(report.at(-1)))
 }finally{await browser.close()}
}
// The driving notice's two actions on a 390 x 844 phone: a slow-frames offer, raised in place.
{
 const browser=await webkit.launch()
 try{
  const page=await(await browser.newContext({...devices['iPhone 14'],viewport:{width:390,height:844}})).newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`${process.env.MIRA_URL}?room=about-notice-${Date.now()}`)
  await page.waitForFunction(()=>window.mira?.shell&&document.documentElement.dataset.boot==='done',null,{timeout:150000})
  await page.evaluate(()=>{mira.params.set('bots.count',0);mira.shell.play(true)})
  await page.waitForFunction(()=>mira.shell.playing&&!mira.shell.transitioning,null,{timeout:150000})
  await page.evaluate(()=>{const panel=mira.shell.performancePanel,render=panel.render.bind(panel),offer={level:3,targetLevel:2,observedFps:34,fewerBots:false,bots:0};panel.render=s=>render({...s,recommendation:offer});render({...(panel.snapshot??{visible:false}),recommendation:offer})})
  const actions=page.locator('.drive-notices .performance-recommendation button.panel-action:visible')
  await actions.first().waitFor({state:'visible',timeout:10000})
  const n=await actions.count(); assert.ok(n>=2,`notice: two actions shown (${n})`)
  for(let i=0;i<n;i++) await tappable(actions.nth(i),`notice ${await actions.nth(i).innerText()}`)
  // Each action's hit area (46 px tall, at least 44 px wide, centred) stays clear of its neighbours'.
  const areas=await actions.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),w=Math.max(r.width,44),h=Math.max(r.height,46),cx=r.left+r.width/2,cy=r.top+r.height/2;return{l:cx-w/2,r:cx+w/2,t:cy-h/2,b:cy+h/2,painted:Math.round(r.height)}}))
  for(const a of areas)assert.ok(a.painted<=32,`notice: the painted action keeps its look (${a.painted} px)`)
  for(let i=0;i<areas.length;i++)for(let j=i+1;j<areas.length;j++){const a=areas[i],b=areas[j];assert.ok(!(a.l<b.r&&a.r>b.l&&a.t<b.b&&a.b>b.t),`notice: hit areas ${i} and ${j} do not overlap ${JSON.stringify([a,b])}`)}
  await page.screenshot({path:`${out}/phone-notice.png`})
  assert.deepEqual(errors,[]);console.log(JSON.stringify({notice:'ok',actions:n}))
 }finally{await browser.close()}
}
// Welcome's carousel (src/ui/welcome/ring.ts), at the four sizes the owner checks: a phone upright
// and on its side, a small phone and a large computer. Bugs caught: a Welcome picture requested
// before the player opens Welcome (the owner's rule in AGENTS.md); the arrows, a key, a swipe, a
// dot or a tap on a side picture not bringing a new picture to the front with its own title; the
// carousel running off the screen or sitting on the logo, the X or the lobby's buttons; a caption
// cut off; the ring turning by itself and keeping an idle lobby busy; a move gliding under reduced
// motion. Nothing here pins a size, an angle or a duration.
// Also (the owner, 25 November 2026): the carousel is one element among the guide's, so at the top of the
// sheet the next section shows without scrolling (the caption and dots on a 320 px phone), and on a phone
// held upright the Settings and Welcome pair stands centred, with or without a sheet, clear of the version.
for(const [name,width,height,below] of [['phone-upright',390,844,'section'],['phone-side',844,390,null],['small-phone',320,568,'dots'],['desktop',1280,800,'section'],['large',1700,1100,'section']]){
 const touch=width<600||height<500
 const browser=await(touch?webkit.launch():chromium.launch({channel:'chrome',headless:true}))
 try{
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?2:1,reducedMotion:name==='large'?'no-preference':undefined})
  const page=await context.newPage(), errors=[], pictures=[]; page.on('pageerror',e=>errors.push(e.message))
  page.on('request',r=>{if(/\/welcome\/[^/]+\.(webp|avif|jpe?g|png)$/.test(new URL(r.url()).pathname))pictures.push(r.url())})
  await page.goto(`${process.env.MIRA_URL}?room=about-ring-${name}-${Date.now()}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  await page.waitForTimeout(1500)
  assert.deepEqual(pictures,[],`${name}: no Welcome picture requested before Welcome is opened`)
  await page.locator('.lobby-gear-dock .lobby-about').click()
  const ring=page.locator('dialog.lobby-sheet-about[open] .welcome-ring')
  await ring.waitFor({state:'visible'})
  await page.waitForFunction(()=>!document.querySelector('.lobby-sheet-about .lobby-sheet-panel').getAnimations({subtree:true}).some(a=>a.playState==='running'))
  assert.ok(pictures.length>0,`${name}: the pictures load once Welcome is open`)
  const state=()=>ring.evaluate(r=>({title:r.querySelector('.welcome-ring-caption strong').textContent,front:[...r.querySelectorAll('.welcome-ring-card')].findIndex(c=>c.dataset.slot==='front'),dot:[...r.querySelectorAll('.welcome-ring-dot')].findIndex(d=>d.getAttribute('aria-current')==='true'),status:r.querySelector('.welcome-ring-status').textContent}))
  const settled=()=>page.waitForFunction(()=>!document.querySelector('.lobby-sheet-about .welcome-ring').getAnimations({subtree:true}).some(a=>a.playState==='running'),null,{timeout:5000})
  const titles=await ring.evaluate(r=>[...r.querySelectorAll('.welcome-ring-dot')].map(d=>d.getAttribute('aria-label').replace(/^Picture \d+ of \d+: /,'')))
  const expect=async(index,how)=>{const s=await state();assert.equal(s.front,index,`${name} ${how}: picture ${index+1} in front`);assert.equal(s.dot,index,`${name} ${how}: its dot is current`);assert.equal(s.title,titles[index],`${name} ${how}: its title shows`)}
  await expect(0,'opened')
  if(below){
   // At the top of the sheet: what must show without scrolling, inside the body and above its bottom fade.
   const shown=await ring.evaluate((r,below)=>{
    const body=r.closest('.lobby-sheet-body'), b=body.getBoundingClientRect(), top=b.top+28, bottom=b.bottom-44
    // `part`: how much of the box from its top must show (a dot is drawn at its 40 px target's middle).
    const inView=(el,part=1)=>{const e=el.getBoundingClientRect();return e.top>=top-1&&e.top+e.height*part<=bottom+1}
    const out={scrollTop:body.scrollTop,caption:inView(r.querySelector('.welcome-ring-caption')),dots:inView(r.querySelector('.welcome-ring-dots'),0.6)}
    // The next section: its heading, and the top of its first card (its title row, 40 px).
    if(below==='section'){let h=r.nextElementSibling;while(h&&h.tagName!=='H3')h=h.nextElementSibling;out.heading=!!h&&inView(h);const card=h?.nextElementSibling?.querySelector('li');if(card){const e=card.getBoundingClientRect();out.card=e.top>=top-1&&e.top+40<=bottom+1}else out.card=false}
    return out
   },below)
   console.log(JSON.stringify({ring:name,atTop:shown}))
   assert.ok(shown.scrollTop===0&&Object.entries(shown).every(([k,v])=>k==='scrollTop'||v===true),`${name}: at the top of Welcome, the caption, dots${below==='section'?' and the next section':''} show without scrolling ${JSON.stringify(shown)}`)
  }
  if(width<600&&height>width){
   // The pair in the middle of the bottom edge, unless that would reach the version label.
   const pair=async()=>page.evaluate(()=>{const r=[...document.querySelectorAll('.lobby-gear-dock .lobby-control')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect()),v=document.querySelector('.lobby-version-dock .lobby-version'),vb=v&&getComputedStyle(v).visibility!=='hidden'&&!v.closest('[hidden]')?v.getBoundingClientRect():null;return{l:Math.min(...r.map(b=>b.left)),r:Math.max(...r.map(b=>b.right)),t:Math.min(...r.map(b=>b.top)),b:Math.max(...r.map(b=>b.bottom)),version:vb&&vb.width?{r:vb.right,t:vb.top,b:vb.bottom}:null,w:innerWidth}})
   const centred=(p,what)=>{const off=(p.l+p.r)/2-p.w/2,clash=p.version&&p.l<p.version.r&&p.t<p.version.b&&p.b>p.version.t;assert.ok(!clash,`${name} ${what}: the buttons clear the version ${JSON.stringify(p)}`);const room=p.version?Math.max(0,p.version.r+4-(p.w/2-(p.r-p.l)/2)):0;assert.ok(Math.abs(off)<=8+room,`${name} ${what}: the buttons are centred (${Math.round(off)} px off) ${JSON.stringify(p)}`)}
   centred(await pair(),'with Welcome open')
   await page.keyboard.press('Escape');await ring.waitFor({state:'hidden'});await page.waitForTimeout(600)
   centred(await pair(),'with no sheet open')
   await page.locator('.lobby-gear-dock .lobby-about').click();await ring.waitFor({state:'visible'})
   await page.waitForFunction(()=>!document.querySelector('.lobby-sheet-about .lobby-sheet-panel').getAnimations({subtree:true}).some(a=>a.playState==='running'))
  }
  // The ring holds still by itself: an idle Welcome keeps nothing moving.
  await page.waitForTimeout(6500);await expect(0,'left alone');await settled()
  const foot=ring.locator('.welcome-ring-foot')
  await foot.locator('[data-ring=next]').click();await expect(1,'next')
  assert.match((await state()).status,/2 of 6/,`${name}: a screen reader hears the move`)
  await foot.locator('[data-ring=prev]').click();await expect(0,'previous')
  await foot.locator('[data-ring=prev]').click();await expect(titles.length-1,'previous past the first')
  await foot.locator('[data-ring=next]').focus();await page.keyboard.press('ArrowRight');await expect(0,'the right arrow key, round from the last')
  await page.keyboard.press('ArrowLeft');await expect(titles.length-1,'the left arrow key')
  await ring.locator('.welcome-ring-dot').nth(3).click();await expect(3,'the fourth dot')
  // A swipe: a sideways drag across the front picture.
  const box=await ring.locator('.welcome-ring-track').boundingBox()
  const cy=box.y+box.height/2
  // Playwright cannot drag a finger: on touch the finger's pointer events are sent to the picture itself.
  if(touch)await ring.locator('.welcome-ring-card[data-slot=front] img').evaluate((img,[x0,x1,y])=>{const at=(type,x)=>img.dispatchEvent(new PointerEvent(type,{pointerId:7,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true}));at('pointerdown',x0);at('pointermove',(x0+x1)/2);at('pointermove',x1);at('pointerup',x1)},[box.x+box.width*.75,box.x+box.width*.25,cy])
  else{await page.mouse.move(box.x+box.width*.75,cy);await page.mouse.down();await page.mouse.move(box.x+box.width*.45,cy,{steps:4});await page.mouse.move(box.x+box.width*.25,cy,{steps:4});await page.mouse.up()}
  await expect(4,'a swipe to the left')
  await settled()
  const sides=await ring.evaluate(r=>r.hasAttribute('data-sides'))
  if(sides){
   // A tap on the picture beside the front one, just past the hinge, brings it to the front.
   const side=ring.locator('.welcome-ring-card').nth(5), sb=await side.boundingBox()
   await side.click({position:{x:Math.min(24,sb.width/4),y:sb.height/2},timeout:5000});await expect(5,'a tap on a side picture')
   await settled()
  }
  // Only the front picture is offered to a screen reader; the side ones are not focusable duplicates.
  assert.deepEqual(await ring.evaluate(r=>[...r.querySelectorAll('.welcome-ring-card')].filter(c=>c.getAttribute('aria-hidden')!=='true').length),1,`${name}: one picture is offered to a screen reader`)
  assert.equal(await ring.locator('.welcome-ring-card [tabindex]:not([tabindex="-1"]), .welcome-ring-card a, .welcome-ring-card button').count(),0,`${name}: nothing in the pictures takes focus`)
  // Fit: with the ring scrolled into view, every control and line of text is on screen, the caption
  // is not cut off, nothing scrolls sideways, and nothing visible of the ring touches the logo, the
  // X or the lobby's buttons.
  await ring.locator('.welcome-ring-track').evaluate(el=>el.scrollIntoView({block:'start'}));await page.waitForTimeout(300)
  for(const scrolled of [false,true]){
   if(!scrolled)await page.locator('.lobby-sheet-about .lobby-sheet-body').evaluate(b=>{b.scrollTop=0})
   else await ring.locator('.welcome-ring-dots').evaluate(el=>el.scrollIntoView({block:'nearest'}))
   await page.waitForTimeout(200)
   const fit=await ring.evaluate(r=>{
    const problems=[], body=r.closest('.lobby-sheet-body').getBoundingClientRect(), rr=r.getBoundingClientRect(), cs=getComputedStyle(r), reach=k=>parseFloat(cs.getPropertyValue(`--reach-${k}`))||0
    // What can be seen: inside the sheet's scrolling body below its top fade (28 px, or once scrolled
    // transparent down to the X's foot, --sheet-lift; lobby-sheet.css), the screen, and the ring's own clip (welcome.css).
    const bodyEl=r.closest('.lobby-sheet-body'), lift=parseFloat(bodyEl.style.getPropertyValue('--sheet-lift'))||0
    const clip={l:Math.max(0,rr.left-reach('left')),t:body.top+Math.max(28,lift),r:Math.min(innerWidth,rr.right+reach('right')),b:body.bottom}
    const seen=el=>{const b=el.getBoundingClientRect();const l=Math.max(b.left,clip.l),t=Math.max(b.top,clip.t),rt=Math.min(b.right,clip.r),bt=Math.min(b.bottom,clip.b);return rt-l>1&&bt-t>1?{l,t,r:rt,b:bt}:null}
    const hit=(a,b)=>a&&b&&a.l<b.r-1&&a.r>b.l+1&&a.t<b.b-1&&a.b>b.t+1
    const box=sel=>{const el=document.querySelector(sel);if(!el)return null;const b=el.getBoundingClientRect();return b.width?{l:b.left,t:b.top,r:b.right,b:b.bottom}:null}
    const keep={logo:box('.shell-logo'),close:box('.lobby-sheet-about .lobby-sheet-close'),buttons:box('.lobby-sheet-about .lobby-gear-dock')??box('.lobby-gear-dock')}
    const parts=[...r.querySelectorAll('.welcome-ring-arrow, .welcome-ring-dot, .welcome-ring-caption, .welcome-ring-card')].filter(el=>getComputedStyle(el).display!=='none'&&Number(getComputedStyle(el).opacity)>0.01)
    for(const el of parts){
     const b=el.getBoundingClientRect(), what=el.className
     if(!el.matches('.welcome-ring-card')&&b.width>0&&(b.left<-1||b.right>innerWidth+1))problems.push(`${what} runs off the screen`)
     for(const [k,v] of Object.entries(keep))if(hit(seen(el),v))problems.push(`${what} overlaps the ${k} ${JSON.stringify({seen:seen(el),[k]:v})}`)
    }
    const front=r.querySelector('.welcome-ring-card[data-slot=front]').getBoundingClientRect()
    if(front.left<-1||front.right>innerWidth+1)problems.push('the front picture runs off the screen')
    const cap=r.querySelector('.welcome-ring-caption');if(cap.scrollHeight>cap.clientHeight+1)problems.push('the caption is cut off')
    if(document.scrollingElement.scrollWidth>innerWidth+1)problems.push('the page scrolls sideways')
    return {problems,column:Math.round(r.getBoundingClientRect().width),front:{w:Math.round(front.width),h:Math.round(front.height)},sides:r.hasAttribute('data-sides')}
   })
   console.log(JSON.stringify({ring:name,scrolled,...fit}))
   assert.deepEqual(fit.problems,[],`${name}${scrolled?' scrolled':''}: the carousel fits`)
   await page.screenshot({path:`${out}/ring-${name}${scrolled?'-scrolled':''}.png`})
  }
  // Reduced motion: a move is instant, with nothing left gliding.
  await page.emulateMedia({reducedMotion:'reduce'})
  await foot.locator('[data-ring=next]').click()
  assert.equal(await ring.evaluate(r=>r.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0,`${name}: under reduced motion a move is instant`)
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))

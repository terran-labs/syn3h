import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5198/'
await mkdir('tests/ui/artifacts/follow-on', { recursive:true })
for (const mode of (process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop','ipad','phone','landscape'])) {
  const browser = await (mode === 'desktop' ? chromium.launch({channel:'chrome',headless:true}) : webkit.launch())
  try {
    const page = await browser.newPage(mode === 'desktop' ? {viewport:{width:1440,height:1000}} : devices[mode === 'ipad' ? 'iPad (gen 7)' : mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'])
    const errors=[], sockets=[]
    page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('websocket',ws=>sockets.push(ws.url()))
    const room=`ux-follow-${mode}-${Date.now()}`
    await page.goto(`${base}?room=${room}`)
    await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
    await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(()=>window.syn3h?.shell.playing && window.syn3hNet?.connected && !syn3h.shell.dropping,null,{timeout:120000})
    assert.ok(sockets.some(url=>url===`ws://127.0.0.1:${process.env.UX_ROOM_PORT??'5298'}/ws?room=${room}`),'the room server started for this run, and a disposable room')
    // Fixture drives the presentation contract only. It does not claim core eligibility tests.
    await page.evaluate(async()=>{
      const {effectiveQuality}=await import('/src/core/quality.ts')
      window.fixture={listeners:new Set(),calls:{ignore:0,lower:0},snapshot:{visible:false,quality:effectiveQuality(),levelPinned:false,history:Array.from({length:140},(_,i)=>({timeMs:i*1000,frameMs:20+i%8,p50Ms:20,p90Ms:29,p95Ms:35,physicsMs:2,drawCalls:100,triangles:20000,stalls:0,frames:50})),recommendation:null,environment:{backend:'webgpu',adapter:null,memoryGB:null,maxTextureSize:null,fallbackReason:'WebGPU unavailable; using WebGL',deviceLost:null}}}
      const f=window.fixture
      f.emit=()=>{for(const listener of f.listeners)listener(f.snapshot)}
      f.source={getPerformanceSnapshot:()=>f.snapshot,subscribePerformance:listener=>{f.listeners.add(listener);listener(f.snapshot);return()=>f.listeners.delete(listener)},setDiagnosticsVisible:visible=>{f.snapshot={...f.snapshot,visible};f.emit()},ignoreRecommendation:()=>{f.calls.ignore++;f.snapshot={...f.snapshot,recommendation:null};f.emit()},lowerRecommendedTier:()=>{f.calls.lower++;return true}}
      syn3h.shell.configurePerformance(f.source)
      syn3h.shell.configurePerformance(f.source)
      // A fake quality controller: six levels, Auto, and the calls the panel makes.
      const names=['Minimal','Low','Medium','High','Ultra','Cinematic']
      f.qualityListeners=new Set();f.qualityCalls={level:[],auto:[]}
      f.qualityState=Object.freeze({level:4,name:'Ultra',auto:true,pinned:false,rung:0,rungs:3,easing:null,ceiling:5,postTier:'full',presetIds:[],preset:{},overrides:{}})
      f.emitQuality=patch=>{f.qualityState=Object.freeze({...f.qualityState,...patch});for(const listener of f.qualityListeners)listener(f.qualityState)}
      f.quality={qualityLevels:names.map((name,index)=>({index,name})),getQualityState:()=>f.qualityState,
        setLevel:level=>{f.qualityCalls.level.push(level);f.emitQuality({level,name:names[level],pinned:true})},
        stepUp:()=>false,stepDown:()=>false,setAuto:on=>{f.qualityCalls.auto.push(on);f.emitQuality({auto:on})},clearOverride:()=>{},clearOverrides:()=>{},
        subscribeQuality:listener=>{f.qualityListeners.add(listener);listener(f.qualityState);return()=>f.qualityListeners.delete(listener)}}
      syn3h.shell.performancePanel.configureQuality(f.quality)
      syn3h.shell.performancePanel.configureQuality(f.quality)
    })
    assert.equal(await page.evaluate(()=>fixture.listeners.size),1,'reconfigure replaces subscription')
    assert.equal(await page.evaluate(()=>fixture.qualityListeners.size),1,'reconfiguring quality replaces its subscription')
    if(await page.evaluate(()=>!!document.pointerLockElement)){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement)}if(await page.locator('.inspector-toggle').isVisible()&&await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').click();await page.locator('.world-inspector').waitFor({state:'visible'}); await page.locator('.wi-card[data-section=performance] .wi-head').click()
    // Diagnostics are a fold in the Performance card; opening it asks the source to sample.
    await page.locator('.performance-diagnostics > summary').click()
    await page.waitForFunction(()=>fixture.snapshot.visible)
    assert.equal(await page.locator('.performance-card .performance-body').isVisible(),true)
    // Six levels from the quality source, the active one selected; choosing calls setLevel.
    const level=page.getByRole('combobox',{name:'Quality level'})
    assert.deepEqual(await level.locator('option').allInnerTexts(),['Minimal','Low','Medium','High','Ultra','Cinematic'])
    assert.equal(await level.inputValue(),'4')
    await level.selectOption('2'); assert.deepEqual(await page.evaluate(()=>fixture.qualityCalls.level),[2])
    assert.match(await page.locator('.performance-quality').innerText(),/^Medium\b.*Auto on.*Pinned/)
    await page.locator('.wi-auto input').uncheck(); assert.deepEqual(await page.evaluate(()=>fixture.qualityCalls.auto),[false])
    await page.evaluate(()=>fixture.emitQuality({level:4,name:'Ultra',auto:true,pinned:false,easing:'resolution'}))
    assert.equal(await level.inputValue(),'4'); assert.equal(await page.locator('.wi-auto input').isChecked(),true)
    assert.match(await page.locator('.performance-quality').innerText(),/^Ultra\b.*Auto on.*Not pinned.*Resolution reduced automatically/)
    assert.equal(await page.locator('.performance-chart polyline').evaluate(el=>el.getAttribute('points').split(' ').length),120)
    assert.match(await page.locator('.performance-body').innerText(),/Unavailable/)
    assert.match(await page.locator('.performance-body').innerText(),/Fallback/)
    // Diagnostics can scroll the short landscape card. Verify the level row remains reachable.
    await page.locator('.wi-level').scrollIntoViewIfNeeded()
    const fit=await page.locator('.wi-level').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})
    assert.ok(fit,'level row inside viewport')
    for(const head of await page.locator('.wi-head').all())await head.click()
    // Headers are finger-sized now, so on a phone the stack may scroll; what matters is that
    // with the diagnostics open every card header can still be reached and nothing scrolls sideways.
    await page.waitForFunction(()=>!document.querySelector('.wi-cards').getAnimations({subtree:true}).some(a=>a.playState==='running'))
    const reach=await page.evaluate(()=>{const stack=document.querySelector('.wi-cards');const all=[...document.querySelectorAll('.wi-head')].every(el=>{el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),s=stack.getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=s.bottom+1});stack.scrollTop=0;return{all,sideways:stack.scrollWidth>stack.clientWidth+1}})
    assert.ok(reach.all,'diagnostics do not put any card header out of reach');assert.equal(reach.sideways,false,'the card stack does not scroll sideways')
    await page.screenshot({path:`tests/ui/artifacts/follow-on/${mode}-performance.png`})
    await page.evaluate(()=>{fixture.snapshot={...fixture.snapshot,recommendation:{level:2,targetLevel:1,observedFps:20}};fixture.emit()})
    const recommendationCard=page.locator('.wi-card[data-section=performance]')
    if(!await recommendationCard.evaluate(el=>el.classList.contains('is-open')))await recommendationCard.locator('.wi-head').click()
    await page.locator('.performance-recommendation').scrollIntoViewIfNeeded()
    assert.equal(await page.locator('.performance-recommendation').evaluate(el=>getComputedStyle(el).position),'static','recommendation occupies its own space in the pinned footer')
    await page.screenshot({path:`tests/ui/artifacts/follow-on/${mode}-recommendation.png`})
    assert.match(await page.locator('.performance-recommendation').innerText(),/Running slow at Medium \(20 fps\). Switch to Low\?/)
    assert.match(await page.locator('[data-performance=lower]').innerText(),/^Switch to Low$/)
    // Retired vocabulary never reaches the player.
    for(const selector of ['.performance-card','.performance-recommendation'])assert.doesNotMatch(await page.locator(selector).innerText(),/\b(tiers?|safe|mobile|desktop|unmeasured)\b/i,selector)
    // The same notice remains in play, clear of controls and the mode HUD.
    if(mode==='desktop')await page.mouse.click(100,150)
    else await page.locator('.inspector-toggle').tap()
    await page.locator('.world-inspector').waitFor({state:'hidden'})
    assert.ok(await page.locator('.performance-recommendation').isVisible(),'notice remains visible while driving')
    const overlap=await page.locator('.performance-recommendation').evaluate(el=>{
      const r=el.getBoundingClientRect()
      return [...document.querySelectorAll('.match-hud,.race-hud,.gear-selector,.gear-actions,.shell-minimap,.touch-actions,.touch-stick,.inspector-toggle')].filter(other=>{
        const style=getComputedStyle(other),b=other.getBoundingClientRect()
        return style.display!=='none'&&style.visibility!=='hidden'&&b.width>0&&b.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top
      }).map(el=>el.className)
    })
    assert.deepEqual(overlap,[],'recommendation has its own space')
    await page.screenshot({path:`tests/ui/artifacts/follow-on/${mode}-recommendation-driving.png`})
    if(mode==='desktop')await page.keyboard.press('Escape')
    else await page.locator('.inspector-toggle').tap()
    await page.locator('.world-inspector').waitFor({state:'visible'})
    await page.locator('[data-performance=ignore]').click()
    assert.equal(await page.evaluate(()=>fixture.calls.ignore),1)
    assert.equal(await page.locator('.performance-recommendation').isVisible(),false)
    await page.evaluate(()=>{fixture.snapshot={...fixture.snapshot,recommendation:{level:2,targetLevel:1,observedFps:20}};fixture.emit()})
    await page.locator('[data-performance=lower]').click(); assert.equal(await page.evaluate(()=>fixture.calls.lower),1)
    await page.evaluate(()=>{fixture.snapshot={...fixture.snapshot,recommendation:null};fixture.emit()})
    if(!await page.locator('.wi-card[data-section=performance]').evaluate(el=>el.classList.contains('is-open')))await page.locator('.wi-card[data-section=performance] .wi-head').click()
    await page.locator('.performance-diagnostics > summary').click()
    await page.waitForFunction(()=>!fixture.snapshot.visible)
    if(mode==='desktop') {
      const search=page.locator('.wi-search')
      await page.evaluate(()=>{document.activeElement?.blur();window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))})
      assert.equal(await page.evaluate(()=>syn3h.game.input.poll().y),1)
      // W outside any field means "drive": it captures the cursor and the panels close. Wait for
      // that to settle either way, free the cursor again, then move focus into a field.
      await page.waitForFunction(()=>document.pointerLockElement===syn3h.game.canvas,null,{timeout:3000}).catch(()=>{})
      if(await page.evaluate(()=>!!document.pointerLockElement))await page.keyboard.press('Escape')
      await page.locator('.world-inspector').waitFor({state:'visible'})
      await search.focus(); await page.keyboard.up('KeyW')
      assert.equal(await page.evaluate(()=>syn3h.game.input.poll().y),0,'keyup after field focus clears held drive')
      for(const locator of [search,page.locator('.wi-head').first(),page.locator('.rail-pause')]) {
        await locator.focus()
        const result=await locator.evaluate(el=>{
          const input=syn3h.game.input, before={...input.poll()}
          el.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}))
          const after={...input.poll()};el.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',bubbles:true}));return{before,after}
        })
        assert.deepEqual(result.after,result.before,'native controls cannot toggle special')
      }
      await search.focus();await page.keyboard.press('F3');assert.equal(await page.locator('#frame-time-hud').count(),0,'native input F3 does not open diagnostics')
      await page.mouse.click(650,400)
      await page.waitForFunction(()=>document.pointerLockElement===syn3h.game.canvas)
      assert.equal(await page.evaluate(()=>syn3h.game.input.mouseFire),false)
      await page.keyboard.press('Escape')
      await page.waitForFunction(()=>!document.pointerLockElement)
      assert.equal(await page.evaluate(()=>syn3h.shell.menuOpen),false)
      // Rejected raw and fallback capture must settle without an unhandled rejection.
      await page.evaluate(async()=>{
        const canvas=syn3h.game.canvas, original=canvas.requestPointerLock
        let calls=0;canvas.requestPointerLock=()=>{calls++;return Promise.reject(new Error('fixture denied'))}
        await syn3h.shell.captureCursor();canvas.requestPointerLock=original
        if(calls!==2)throw new Error(`Expected raw and fallback, got ${calls}`)
      })
    }
    if(await page.evaluate(()=>!!document.pointerLockElement)){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement)}if(await page.locator('.inspector-toggle').isVisible()&&await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').click();await page.locator('.world-inspector').waitFor({state:'visible'})
    await page.locator('.exit-world').click(); await page.locator('.exit-leave').click(); await page.waitForFunction(()=>!syn3h.shell.playing)
    await page.locator('.galaxy-label.is-current').focus();await page.keyboard.press('Enter')
    await page.waitForFunction(()=>syn3h.shell.playing&&!syn3h.shell.dropping,null,{timeout:60000})
    assert.equal(await page.evaluate(()=>fixture.listeners.size),1,'lobby return does not duplicate subscription')
    assert.equal(await page.evaluate(()=>fixture.qualityListeners.size),1,'lobby return does not duplicate the quality subscription')
    await page.evaluate(()=>syn3h.shell.performancePanel.dispose())
    assert.equal(await page.evaluate(()=>fixture.listeners.size),0,'dispose releases subscription')
    assert.equal(await page.evaluate(()=>fixture.qualityListeners.size),0,'dispose releases the quality subscription')
    assert.equal(await page.locator('.wi-card[data-section=performance]').count(),0,'dispose removes the Performance card')
    const lifecycle = await page.evaluate(async()=>{
      const {PerformancePanel}=await import('/src/ui/PerformancePanel.ts')
      let maxRenderMs=0
      for(let i=0;i<3;i++){
        const panel=new PerformancePanel(syn3h.shell.element,()=>{},fixture.quality)
        syn3h.shell.element.append(panel.element)
        fixture.snapshot={...fixture.snapshot,visible:true}
        const start=performance.now();panel.configure(fixture.source);maxRenderMs=Math.max(maxRenderMs,performance.now()-start)
        panel.dispose()
        if(fixture.listeners.size||fixture.qualityListeners.size)throw new Error('Leaked subscription')
      }
      return{maxRenderMs,remaining:document.querySelectorAll('.performance-card').length}
    })
    assert.equal(lifecycle.remaining,0)
    console.log(`${mode}: fixture initial render max ${lifecycle.maxRenderMs.toFixed(2)}ms (shared host, not device benchmark)`)

    assert.deepEqual(errors,[])
    console.log(`${mode}: normal entry, panel lifecycle and cursor/forms passed`)
  }finally{await browser.close()}
}

import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { devices, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
await mkdir('tests/ui/artifacts/selection-controls', {recursive:true})
for(const device of ['iPhone 14','iPad Pro 11 landscape']) {
 const browser=await webkit.launch()
 try {
  const page=await browser.newPage({...devices[device]});const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`${process.env.MIRA_URL}?room=selection-controls-${Date.now()}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  await page.waitForFunction(()=>window.mira?.game.tick>25)
  const selectField=async(locator,value)=>{
   await locator.tap();await page.keyboard.press('Meta+A');await page.keyboard.type(value)
   assert.equal(await locator.inputValue(),value)
   await page.keyboard.press('Meta+A')
   assert.equal(await locator.evaluate(e=>e.selectionEnd-e.selectionStart),value.length,'native keyboard selects editable text')
  }
  await page.evaluate(()=>mira.shell.showPanel('explore'))
  await page.locator('#shell-room').waitFor({state:'visible'})
  await selectField(page.locator('#shell-room'),'editable-room')
  await selectField(page.locator('#shell-name'),'Editable Pilot')
  await page.keyboard.press('Escape');await page.evaluate(()=>mira.shell.showPanel('index'))
  await page.waitForTimeout(300)
  // Native mouse drag exercises the galaxy pointer path; mobile native taps follow below.
  const canvas=page.locator('canvas.galaxy-canvas');const galaxy=await page.locator('.galaxy').count()
  const box=await page.locator('#game').boundingBox()
  await page.mouse.move(box.width*.5,box.height*.25);await page.mouse.down();await page.mouse.move(box.width*.65,box.height*.3,{steps:12});await page.mouse.up()
  assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true,'galaxy drag selects no text')
  await page.locator('.galaxy-label.is-current').tap()
  await page.waitForFunction(()=>mira.shell.playing&&!mira.shell.dropping,null,{timeout:120000})
  if(await page.locator('.world-inspector').isHidden())await page.locator('.inspector-toggle').tap()
  await page.locator('.world-inspector').waitFor({state:'visible'})
  await selectField(page.locator('.wi-search'),'time of day')
  const row=page.locator('.wi-row[data-id="sun.timeOfDay"]')
  await row.locator('.wi-num').tap()
  await selectField(row.locator('.wi-num-edit'),'12')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(async()=> (await import('/shared/params.ts')).params.get('sun.timeOfDay').value),12)
  await row.locator('input[type=range]').tap()
  assert.ok(await page.evaluate(()=>(visualViewport?.scale??1)<=1.01))
  await page.screenshot({path:`tests/ui/artifacts/selection-controls/${device.replaceAll(' ','-')}-editing.png`})
  await page.locator('.wi-search').fill('');await page.locator('.wi-search').blur()
  await page.locator('.inspector-toggle').tap();await page.locator('.world-inspector').waitFor({state:'hidden'})
  const gear=page.locator('.gear-selector button:visible').first()
  if(await gear.count())await gear.tap()
  const drag=await page.evaluate(()=>{
    const map=document.querySelector('.shell-minimap').getBoundingClientRect(),x=innerWidth*.3,y=map.top>innerHeight*.5?map.top*.6:innerHeight*.6
    const target=document.elementFromPoint(x,y)
    for(const[type,dy]of[['pointerdown',0],['pointermove',-30]])target.dispatchEvent(new PointerEvent(type,{pointerId:71,pointerType:'touch',clientX:x,clientY:y+dy,bubbles:true,cancelable:true}))
    const active=document.querySelector('.touch-stick').classList.contains('is-active'),forward=mira.game.input.external.y
    target.dispatchEvent(new PointerEvent('pointerup',{pointerId:71,pointerType:'touch',clientX:x,clientY:y-30,bubbles:true,cancelable:true}))
    return {active,forward,released:mira.game.input.external.y}
  })
  assert.ok(drag.active&&drag.forward>0);assert.equal(drag.released,0)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({device,nativeFields:true,slider:true,galaxyDrag:true,simulatedStick:drag,errors}))
 }finally{await browser.close()}
}

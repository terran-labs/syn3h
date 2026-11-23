/** Visible text cannot be selected; editable fields retain native selection.
 * WebKit mouse gestures and Chromium browser touch protocol are automated checks,
 * not a physical iPad long-press acceptance. Runtime source stays unchanged.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { devices, webkit, chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
await mkdir('tests/ui/artifacts/no-select',{recursive:true})
for(const engine of ['webkit','chromium']) {
 const browser=await (engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome',headless:true}))
 try {
 for(const name of ['iPad Pro 11 landscape','iPhone 14']) {
  const context=await browser.newContext({...devices[name],defaultBrowserType:undefined}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{
   window.selectionEvidence={events:[],removals:0}
   const original=Selection.prototype.removeAllRanges
   Selection.prototype.removeAllRanges=function(){window.selectionEvidence.removals++;return original.call(this)}
   document.addEventListener('selectionchange',()=>{
    const s=getSelection(),node=n=>n?{name:n.nodeName,parent:n.parentElement?.tagName,id:n.id??'',cls:typeof n.className==='string'?n.className:''}:null
    window.selectionEvidence.events.push({active:node(document.activeElement),anchor:node(s.anchorNode),focus:node(s.focusNode),text:s.toString(),collapsed:s.isCollapsed})
   },true)
  })
  await page.goto(`${process.env.MIRA_URL??'http://127.0.0.1:5198/'}?room=no-select-${Date.now()}`)
  await page.locator('.boot-veil').waitFor({state:'hidden',timeout:120000})
  await page.evaluate(()=>mira.shell.showPanel('explore'))
  await page.waitForFunction(()=>document.querySelector('.lobby-panels').dataset.activePanel==='explore'&&document.querySelector('.lobby-panels').dataset.busy==='false')
  const css=await page.evaluate(()=>{
   const select=el=>getComputedStyle(el).webkitUserSelect||getComputedStyle(el).userSelect
   const bad=[...document.querySelectorAll('*')].filter(el=>!el.closest('input,textarea,[contenteditable]')&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&select(el)!=='none').map(el=>el.tagName+'.'+el.className)
   const field=document.querySelector('#shell-room'),label=document.querySelector('label[for="shell-room"]')
   const fire=(el,type)=>{const e=new Event(type,{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented}
   return {bad,body:select(document.body),field:select(field),selectstart:fire(label,'selectstart'),dragstart:fire(label,'dragstart'),fieldSelectstart:fire(field,'selectstart')}
  })
  assert.deepEqual(css.bad,[]);assert.equal(css.body,'none');assert.notEqual(css.field,'none');assert.equal(css.selectstart,true);assert.equal(css.dragstart,true);assert.equal(css.fieldSelectstart,false)
  const field=page.locator('#shell-room')
  await field.tap();await page.keyboard.press('Meta+A');await page.keyboard.type('Editable room')
  await page.keyboard.press('Meta+A')
  assert.equal(await field.inputValue(),'Editable room')
  assert.equal(await field.evaluate(e=>e.selectionEnd-e.selectionStart),13,'native field selection retained')
  await page.keyboard.press('ArrowRight')
  assert.equal(await field.evaluate(e=>e.selectionEnd-e.selectionStart),0)
  await field.blur()
  const checks=[]
  const clear=async()=>page.evaluate(()=>getSelection().removeAllRanges())
  const empty=async(label,gesture)=>{
   await page.waitForTimeout(150)
   const s=await page.evaluate((selector)=>{
    const selection=getSelection(),active=document.activeElement
    const node=n=>n?{type:n.nodeType,name:n.nodeName,parent:n.parentElement?.tagName,id:n.id??'',text:n.nodeType===3?n.textContent:null}:null
    const editable=active?.matches('input:not([type=range]):not([type=checkbox]),textarea')&&typeof active.selectionStart==='number'
    const input=editable?{id:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd}:null
    const ranges=Array.from({length:selection.rangeCount},(_,i)=>{const r=selection.getRangeAt(i);return{start:node(r.startContainer),end:node(r.endContainer),collapsed:r.collapsed,rects:[...r.getClientRects()].map(x=>({x:x.x,y:x.y,width:x.width,height:x.height}))}})
    const evidence={text:selection.toString(),collapsed:selection.isCollapsed,active:node(active),anchor:node(selection.anchorNode),focus:node(selection.focusNode),input,ranges,targetText:document.querySelector(selector)?.textContent,instrumentation:window.selectionEvidence}
    // WebKit exposes native input selection through window.getSelection(). Prove
    // ownership causally: collapsing only the input selection must remove it.
    // A separate page range is never cleared here and therefore still fails.
    let fieldOwned=false
    if(input&&input.end>input.start&&evidence.text===input.value.slice(input.start,input.end)) {
     active.setSelectionRange(input.end,input.end)
     fieldOwned=getSelection().toString()===''&&getSelection().isCollapsed
    }
    return {...evidence,fieldOwned}
   },label)
   console.log(JSON.stringify({engine,name,label,gesture,selection:s}))
   assert.ok(s.fieldOwned||(s.text===''&&s.collapsed),`${name} ${label} ${gesture}: forbidden page selection`)

   checks.push({label,gesture,...s})
  }
  for(const selector of ['label[for="shell-room"]','[data-panel="explore"] h2']) {
   const target=page.locator(selector);await target.scrollIntoViewIfNeeded();assert.ok(await target.isVisible())
   const r=await target.boundingBox();assert.ok(r.width>0&&r.height>0&&r.y>=0&&r.y+r.height<=page.viewportSize().height)
   await clear();await target.dblclick();await empty(selector,'native mouse double-click')
   await clear();await page.mouse.move(r.x+2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width-2,r.y+r.height/2,{steps:12});await page.mouse.up();await empty(selector,'native mouse drag')
   await clear()
   if(engine==='chromium') {
    const cdp=await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]})
    await page.waitForTimeout(700)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach()
    await empty(selector,'browser touch protocol hold 700ms')
   } else {
    await target.dispatchEvent('pointerdown',{pointerId:501,pointerType:'touch',clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true})
    await page.waitForTimeout(700)
    await target.dispatchEvent('pointerup',{pointerId:501,pointerType:'touch',clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true})
    await empty(selector,'synthetic WebKit hold 700ms, not physical long press')
   }
  }
  await page.screenshot({path:`tests/ui/artifacts/no-select/${engine}-${name.replaceAll(' ','-')}.png`})
  console.log(JSON.stringify({engine,name,css,checks,instrumentation:await page.evaluate(()=>selectionEvidence),errors}))
  assert.deepEqual(errors,[]);await context.close()
 }
 }finally{await browser.close()}
}
console.log('NO SELECT PASS')

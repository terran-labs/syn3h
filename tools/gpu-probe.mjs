/** Probe the actual browser adapter, and verify bot ownership/effects through public handles. */
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
const headless = process.argv.includes('--headless')
const browser = await chromium.launch({ channel: 'chrome', headless, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist'] })
try {
  const context = await browser.newContext({viewport:{width:1280,height:720}})
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket=>socket.close())
  const page = await context.newPage(), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:5186/?autoplay=1&vehicle=buggy')
  await page.waitForFunction(()=>window.mira?.game.tick>10,null,{timeout:90000})
  const gpu = await page.evaluate(async()=>{
    const adapter = await navigator.gpu?.requestAdapter(), info=adapter?.info
    return {backend:window.mira.game.backend,adapter:info?{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter}:null,rendererDevice:window.mira.game.renderer.backend.device?.adapterInfo}
  })
  await page.evaluate(()=>{const s=window.mira;s.shell.play();s.bots.remote=false;s.params.set('bots.count',4)})
  await page.waitForTimeout(1500)
  const before=await page.evaluate(()=>{const s=window.mira;return {bots:s.bots.vehicles.map(v=>({id:v.id,name:v.name})),effects:s.game.scene.userData.vehicleEffects?.vehicles}})
  await page.evaluate(()=>window.mira.bots.remote=true)
  await page.waitForTimeout(500)
  const remote=await page.evaluate(()=>({count:window.mira.bots.vehicles.length,effects:window.mira.game.scene.userData.vehicleEffects?.vehicles}))
  await page.evaluate(()=>window.mira.bots.remote=false)
  await page.waitForTimeout(500)
  const takeover=await page.evaluate(()=>window.mira.bots.vehicles.map(v=>({id:v.id,name:v.name})))
  const cdp=await browser.newBrowserCDPSession(), system=await cdp.send('SystemInfo.getInfo')
  const result={headless,load:loadavg(),gpu,devices:system.gpu.devices,featureStatus:system.gpu.featureStatus,before,remote,takeover,errors}
  await writeFile(`/tmp/syn3h-gpu-${headless?'headless':'headed'}.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
  if(remote.count!==0 || before.bots.length!==4 || takeover.some(v=>before.bots.some(b=>b.id===v.id)) || errors.length)process.exitCode=1
} finally { await browser.close() }

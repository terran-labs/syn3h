import { chromium } from 'playwright-core'
import fs from 'node:fs'
const out = '/tmp/syn3h-vehicles2'
fs.mkdirSync(out, {recursive: true})
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try {
 const page = await browser.newPage({viewport:{width:1600,height:1000}})
 const errors=[]
 page.on('pageerror', e=>{errors.push(e.message); console.log('PAGE ERROR',e.message)})
 page.on('console', m=> {if(m.type()==='error'){errors.push(m.text()); console.log('ERROR',m.text())}})
 await page.goto('http://localhost:5185/skins.html')
 await page.waitForFunction(()=>window.skinViewer?.ready, null, {timeout:30000})
 await page.evaluate(()=>window.skinViewer.setOpen(0))
 await page.waitForTimeout(1000)
 await page.screenshot({path:out+'/skins-closed.png'})
 await page.evaluate(()=>window.skinViewer.setOpen(1))
 await page.waitForTimeout(1000)
 await page.screenshot({path:out+'/skins-open.png'})
 await page.evaluate(()=>{window.skinViewer.setOpen(0); window.skinViewer.focus(0)})
 await page.waitForTimeout(300)
 await page.screenshot({path:out+'/classic.png'})
 await page.evaluate(()=>window.skinViewer.focus(1))
 await page.waitForTimeout(300)
 await page.screenshot({path:out+'/mira.png'})
 console.log(JSON.stringify({errors, screenshots:[out+'/skins-closed.png',out+'/skins-open.png'],backend:await page.evaluate(()=>window.skinViewer.renderer.backend.isWebGPUBackend?'WebGPU':'WebGL')}))
 if(errors.length) process.exitCode=1
} finally {await browser.close()}

import {chromium} from 'playwright-core'
import fs from 'node:fs'
const name=process.argv[2]??'jet',out='/tmp/syn3h-vehicles2'
fs.mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
 page.on('pageerror',e=>{errors.push(e.message);console.log(e.message)})
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text())}})
 await page.goto('http://localhost:5185/tests/vehicles2/gallery.html?vehicle='+name)
 await page.waitForFunction(()=>window.vehicleGallery?.ready,null,{timeout:30000})
 await page.waitForTimeout(2000)
 await page.screenshot({path:`${out}/${name}-syn3h-front.png`})
 await page.evaluate(()=>{window.vehicleGallery.flight();window.vehicleGallery.rear()})
 await page.waitForTimeout(2000)
 await page.screenshot({path:`${out}/${name}-syn3h-rear.png`})
 const result=await page.evaluate(()=>({gearVisible:window.vehicleGallery.vehicle.gear?.visible,gearScale:window.vehicleGallery.vehicle.gear?.scale.toArray(),meshes:window.vehicleGallery.vehicle.object.children.length,backend:window.vehicleGallery.renderer.backend.isWebGPUBackend?'WebGPU':'WebGL'}))
 console.log(JSON.stringify({name,errors,...result}))
 if(errors.length)process.exitCode=1
}finally{await browser.close()}

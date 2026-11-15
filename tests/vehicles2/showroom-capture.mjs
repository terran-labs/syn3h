import {chromium} from 'playwright-core'
const out='/tmp/syn3h-vehicles2/showroom',tag=process.argv[2]??'a',tiers=(process.argv[3]??'3').split(',').map(Number)
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
 page.on('pageerror',e=>{errors.push(e.message)});page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text())})
 await page.goto('http://localhost:5185/skins.html')
 await page.waitForFunction(()=>window.skinViewer?.ready,null,{timeout:40000})
 await page.evaluate(()=>window.skinViewer.setOpen(0))
 for(const tier of tiers){
  await page.evaluate(async t=>{const q=await import('/src/core/quality.ts');const {params}=await import('/shared/params.ts');params.set(q.vehicleShading.def.id,t)},tier)
  for(const [i,name] of [[1,'syn3h'],[0,'classic']]){
   await page.evaluate(i=>{const v=window.skinViewer,p=v.skins[i].object.position;v.controls.target.set(p.x,p.y+.2,p.z);v.camera.position.set(p.x+2.3,p.y+1.7,p.z-3.1);v.controls.update()},i)
   await page.waitForTimeout(1200);await page.screenshot({path:`${out}/${tag}-${name}-t${tier}.png`})
   if(tier===tiers[0]){await page.evaluate(i=>{const v=window.skinViewer,p=v.skins[i].object.position;v.controls.target.set(p.x,p.y+.35,p.z-.3);v.camera.position.set(p.x+.9,p.y+1.05,p.z-1.5);v.controls.update()},i)
   await page.waitForTimeout(800);await page.screenshot({path:`${out}/${tag}-${name}-t${tier}-close.png`})}
  }
 }
 console.log(JSON.stringify({errors:[...new Set(errors)].slice(0,12)}))
}finally{await browser.close()}

// Forces the race between a texture's first upload and its image arriving: every vehicle and
// effect image is held back for three seconds while the game renders. Any vehicle that hands the
// renderer a texture marked for upload with no image throws ("reading 'complete'").
//   node tests/vehicles2/texture-race.mjs [kinds] [backends]     PORT=5206 by default
import {chromium} from 'playwright-core'
const kinds=(process.argv[2]??'jet,hovercraft,tank,buggy,buggy-classic').split(','),backends=(process.argv[3]??'webgpu,webgl').split(',')
const port=process.env.PORT??'5206'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=metal','--ignore-gpu-blocklist']})
const results=[]
try{
 for(const backend of backends)for(const kind of kinds){
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.routeWebSocket(/\/ws/,s=>s.close())
  let held=0
  await page.route(/\/models\/(textures|effects)\/.*\.(png|jpg|jpeg|webp)(\?.*)?$/,async route=>{held++;await new Promise(r=>setTimeout(r,3000));await route.continue()})
  await page.goto(`http://localhost:${port}/?autoplay=1&vehicle=${kind}&planet=alpine&seed=1${backend==='webgl'?'&webgl':''}`)
  await page.waitForFunction(()=>window.syn3h?.game.tick>10,null,{timeout:90000})
  // Tier 0 keeps the vehicle's own materials and maps; the showroom tiers replace them.
  for(const tier of [0,3]){await page.evaluate(t=>window.syn3h.params.set('gfx.vehicleShading',t),tier);await page.waitForTimeout(tier===0?4500:2000)}
  const actual=await page.evaluate(()=>window.syn3h.game.renderer.backend.isWebGPUBackend?'webgpu':'webgl')
  results.push({backend:actual,kind,held,errors:[...new Set(errors)].map(e=>e.slice(0,120))});await page.close()
 }
 console.log(JSON.stringify(results,null,1))
 if(results.some(r=>r.errors.length))process.exitCode=1
}finally{await browser.close()}

import {chromium} from 'playwright-core'
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.routeWebSocket(/\/ws(?:\?|$)/,s=>s.close())
 await page.goto('http://localhost:5185/?autoplay=1&vehicle=jet')
 await page.waitForFunction(()=>window.syn3h?.game.tick>100,null,{timeout:90000})
 const first=await page.evaluate(()=>({...window.syn3h.game.scene.userData.skyEnvironment}))
 await page.waitForTimeout(1500)
 const stable=await page.evaluate(()=>({...window.syn3h.game.scene.userData.skyEnvironment}))
 await page.evaluate(()=>window.syn3h.params.set('sun.timeOfDay',18))
 await page.waitForTimeout(1500)
 const changed=await page.evaluate(()=>({...window.syn3h.game.scene.userData.skyEnvironment}))
 console.log(JSON.stringify({first,stable,changed,errors}))
 if(stable.captures!==first.captures||changed.captures!==stable.captures+1||errors.length)throw Error('Reflection refresh check failed')
 await page.screenshot({path:'/tmp/syn3h-vehicles2/jet-sunset.png'})
}finally{await browser.close()}

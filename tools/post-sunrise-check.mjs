// Run only through the reserved heavy slot. Fixed-camera baseline and candidate evidence.
import { chromium } from 'playwright-core'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
const out = process.argv[2] ?? '/tmp/post-sunrise-before'
mkdirSync(out, { recursive: true })
const base = 'http://127.0.0.1:5216'
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5216', '--strictPort'], { stdio: 'ignore', env: { ...process.env, SYN3H_NO_ROOM_SERVER: '1' } })
const azimuth=Number(process.env.SUN_AZ ?? 0)
const report = { source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), azimuth, errors: [], rows: [], load: loadavg() }; let browser
try {
  for (let i=0;i<120;i++) { try { if ((await fetch(base)).ok) break } catch {} await new Promise(r=>setTimeout(r,500)) }
  browser = await chromium.launch({ channel:'chrome', headless:true, args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport:{width:1280,height:720} })
  page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(base+'/?autoplay=1&room=sunrise-diagnostic', {waitUntil:'load'})
  await page.waitForFunction(()=>window.syn3h?.game.tick>60,null,{timeout:180000})
  await page.evaluate(async()=>{
    const s=window.syn3h,g=s.game
    const {applyPlanet}=await import('/src/world/planets.ts'); applyPlanet('volcanic',7)
    for(const [id,value] of Object.entries({'gfx.auto':false,'gfx.quality':3,'bots.count':0,'sun.dayLength':0,'sun.tilt':0,'sun.azimuth':0})) if(s.params.get(id)) s.params.set(id,value)
    g.quality.frame=()=>{}; g.renderer.setPixelRatio(1)
    const {updateCurve}=await import('/src/world/curve.ts')
    const chain=g.postChain, original=chain.render.bind(chain)
    window.sunDiagnostic={phase:'dawn',frames:[]}
    chain.render=(renderer,scene,camera,...args)=>{
      const d=window.sunDiagnostic,top=s.terrain.summit(),dist=450;top.y=s.terrain.heightAt(top.x,top.z)
      // Keep the same terrain silhouette at dawn and dusk by rotating the sun path.
      camera.position.set(top.x-dist,s.terrain.heightAt(top.x-dist,top.z)+12,top.z)
      camera.lookAt(camera.position.x+100,camera.position.y+Math.tan(2*Math.PI/180)*100,top.z);camera.updateMatrixWorld(true);updateCurve(camera.position,s.terrain.wrapSize);s.terrain.afterCamera?.();const sky=scene.children.find(o=>o.sunDirection&&o.betaR);sky?.position.copy(camera.position)
      original(renderer,scene,camera,...args)
      d.frames.push(g.performance.frameMs)
    }
  })
  for(const phase of ['dawn','dusk']) {
    await page.evaluate(({phase,azimuth})=>{const s=window.syn3h;s.params.set('sun.timeOfDay',phase==='dawn'?6+1/3:18-1/3);s.params.set('sun.azimuth',azimuth+(phase==='dawn'?0:180))},{phase,azimuth})
    for(const on of [true,false]) {
      await page.evaluate(on=>window.syn3h.params.set('post.shafts',on?window.syn3h.params.get('post.shafts').def.default:0),on)
      await page.waitForTimeout(4000)
      const state=await page.evaluate(async()=>{
        const s=window.syn3h,g=s.game,c=g.postChain,cam=g.camera
        const stats=async node=>{
          if(!node)return null
          const rt=node.renderTarget,raw=await g.renderer.readRenderTargetPixelsAsync(rt,0,0,rt.width,rt.height)
          const DataUtils={fromHalfFloat: h => {const e=(h>>10)&31,m=h&1023;return (h&32768?-1:1)*(e===0?2**-14*(m/1024):e===31?(m?NaN:Infinity):2**(e-15)*(1+m/1024))}}
          let lit=0,sum=0,max=0,open=0
          for(let i=0;i<raw.length;i+=4){const rgb=[0,1,2].map(k=>raw instanceof Uint16Array?DataUtils.fromHalfFloat(raw[i+k]):raw[i+k]);const v=Math.max(...rgb);if(v>.001)lit++;sum+=v;max=Math.max(max,v);const a=raw instanceof Uint16Array?DataUtils.fromHalfFloat(raw[i+3]):raw[i+3];if(a>.5)open++}
          return {width:rt.width,height:rt.height,lit:lit/(raw.length/4),open:open/(raw.length/4),mean:sum/(raw.length/4),max}
        }
        const frames=window.sunDiagnostic.frames.splice(0).slice(-90).sort((a,b)=>a-b)
        return {backend:g.backend,tier:c.tier,builds:c.builds,key:c.built.key,sun:c.sun.sunDirection.toArray(),sunUV:c.u.sunUv.value.toArray(),sunVis:c.u.sunVis.value,exposure:c.u.exposure.value,shaftStrength:c.u.shafts.value,front:cam.getWorldDirection(cam.position.clone()).dot(c.sun.sunDirection),matrix:cam.matrixWorld.toArray(),mask:await stats(c.built.maskTex),rays:await stats(c.built.raysTex),frameMedian:frames[Math.floor(frames.length/2)]}
      })
      const name=`${phase}-${on?'on':'off'}`
      await page.screenshot({path:`${out}/${name}.png`})
      if(!state.matrix.every(Number.isFinite)||!Number.isFinite(state.sunVis))throw new Error("Invalid camera or sun state");
      report.rows.push({phase,on,...state});console.log(JSON.stringify(report.rows.at(-1)))
    }
  }
} catch(e) { report.failure=String(e.stack||e);process.exitCode=1 } finally { await browser?.close();server.kill('SIGTERM');writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({errors:report.errors,failure:report.failure})) }

import { expect, it } from 'vitest'
import { summarizeFrames } from '../../tools/performance-check.mjs'
const frame=(frameMs,extra={})=>({frameMs,targetBudgetMs:1000/30,hidden:false,...extra})
it('retains stalls over a second in tails and the strict per-frame gate',()=>{
 const s=summarizeFrames([frame(16),frame(16),frame(1400)])
 expect(s.frames).toBe(3);expect(s.max).toBe(1400);expect(s.p99).toBe(1400)
 expect(s.over1000).toBe(1);expect(s.over2x).toBe(1);expect(s.noFrameOver2x).toBe(false)
})
it('tags hidden and invalid data rather than silently filtering acceptance',()=>{
 const s=summarizeFrames([frame(20),frame(1700,{hidden:true}),frame(NaN)])
 expect(s.frames).toBe(3);expect(s.hidden).toBe(1);expect(s.invalid).toBe(1)
 expect(s.max).toBe(1700);expect(s.noFrameOver2x).toBe(false)
})
it('uses each frame actual target budget and fails empty evidence',()=>{
 expect(summarizeFrames([frame(60),frame(34,{targetBudgetMs:1000/60})]).over2x).toBe(1)
 expect(summarizeFrames([frame(2*1000/30)]).noFrameOver2x).toBe(true)
 expect(summarizeFrames([]).noFrameOver2x).toBe(false)
 expect(summarizeFrames([frame(10,{targetBudgetMs:NaN})]).noFrameOver2x).toBe(false)
})

import { installRawCollector } from '../../tools/performance-check.mjs'
import { afterEach, vi } from 'vitest'
afterEach(()=>vi.unstubAllGlobals())
it('captures the first callback and all stalls even when recommendation eligibility rejects them',()=>{
 vi.stubGlobal('window',{});vi.stubGlobal('document',{hidden:true,addEventListener(){}})
 vi.stubGlobal('navigator',{userAgent:'fixture',maxTouchPoints:0})
 vi.stubGlobal('sessionStorage',{getItem:()=>null});vi.stubGlobal('innerWidth',1280);vi.stubGlobal('innerHeight',720);vi.stubGlobal('devicePixelRatio',1)
 installRawCollector()
 const original=vi.fn(),quality={frame:original,governor:{level:0,rung:0,auto:true,levelPinned:false,settings:{pixelRatio:1},targetMs:1000/30},deviceLevel:0,adapterProbe:'fallback'}
 window.syn3h={game:{quality,renderer:{backend:{},render(){}},performance:{firstFrameMs:null},canvas:{width:1280,height:720},camera:{position:{x:0,y:0,z:0}},scene:{},backend:'webgl'},player:{body:{translation:()=>({x:0,y:0,z:0})}},bots:{vehicles:[]},terrain:{}}
 expect(window.performanceMatrix.initial.firstFrameMs).toBeNull()
 expect(window.performanceMatrix.initial.deviceLevel).toBe(0)
 quality.frame({frameMs:1700},false)
 expect(original).toHaveBeenCalledOnce()
 expect(window.performanceMatrix.frames).toHaveLength(1)
 expect(window.performanceMatrix.frames[0]).toMatchObject({frameMs:1700,judge:false,hidden:true,phase:'startup'})
})

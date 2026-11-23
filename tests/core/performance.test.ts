import { describe, expect, it } from 'vitest'
import { PerformanceHistory, PERFORMANCE_POLICY, PipelineCounter } from '../../src/core/performanceHistory'
import { buildLadder, QualityGovernor, type EffectiveQuality } from '../../src/core/quality'
const q = (level: 0|1|2|3|4|5 = 2): EffectiveQuality => ({...buildLadder(level)[0],level,rung:0,rungs:4,auto:false,targetFps:level>=2?60:30})
const metrics = (frameMs: number) => ({frameMs,fps:1000/frameMs,physicsMs:2,drawCalls:100,triangles:1000,firstFrameMs:1})
function feed(h: PerformanceHistory, seconds: number, ms=50, quality=q(), eligible=true) { for(let t=0;t<seconds*1000;t+=ms)h.sample(metrics(ms),eligible,quality) }
describe('eligible performance history',()=>{
 it('bounds history, freezes returned data and reports stalls and frame percentiles',()=>{
  const h=new PerformanceHistory();feed(h,150,100)
  expect(h.history).toHaveLength(PERFORMANCE_POLICY.historyPoints)
  expect(h.history.at(-1)).toMatchObject({frameMs:100,p50Ms:100,p95Ms:100,physicsMs:2,stalls:10,frames:10})
  expect(Object.isFrozen(h.history)).toBe(true);expect(Object.isFrozen(h.history[0])).toBe(true)
 })
 it('requires warmup and sustained slow play; recovered windows clear the offer',()=>{
  const h=new PerformanceHistory();feed(h,9);expect(h.recommendation).toBeNull()
  feed(h,1);expect(h.recommendation).toMatchObject({level:2,targetLevel:1,observedFps:20})
  feed(h,2,16);expect(h.recommendation).toBeNull()
 })
 it('excludes hidden/menu/loading and interrupted samples and breaks consecutive evidence',()=>{
  for(const interrupted of [false,true]){
   const h=new PerformanceHistory();feed(h,9)
   h.sample(metrics(interrupted?1001:50),interrupted,q())
   feed(h,1);expect(h.recommendation).toBeNull();expect(h.history.every(p=>p.p95Ms<1000)).toBe(true)
  }
  const h=new PerformanceHistory();feed(h,100,50,q(),false);expect(h.history).toHaveLength(0)
 })
 it('resets evidence on manual changes and respects minimum level and session Ignore',()=>{
  const h=new PerformanceHistory();feed(h,20);h.ignore();feed(h,60);expect(h.recommendation).toBeNull()
  feed(h,60,50,{...q(),auto:true});expect(h.recommendation).toBeNull()
  const minimum=new PerformanceHistory();feed(minimum,60,100,q(0));expect(minimum.recommendation).toBeNull()
  const changed=new PerformanceHistory();feed(changed,16);feed(changed,1,50,q(1));expect(changed.recommendation).toBeNull()
 })
 it('lets the existing automatic governor shed before recommending a whole tier',()=>{
  const g=new QualityGovernor({level:2,auto:true,devicePixelRatio:2}),h=new PerformanceHistory()
  for(let i=0;i<300;i++){
   const change=g.sample(50)
   if(change)h.resetEvidence()
   h.sample(metrics(50),true,{...g.settings,level:g.level,rung:g.rung,rungs:g.ladder.length,auto:g.auto,targetFps:1000/g.targetMs})
  }
  expect(g.changes).toBeGreaterThan(0);expect(h.recommendation).toBeNull()
 })
})

// Browser-independent controller lifecycle checks use only the DOM surface it owns.
import { afterEach, vi } from 'vitest'
import { QualityController } from '../../src/core/quality'
import { params } from '../../shared/params'
afterEach(()=>{vi.unstubAllGlobals();params.set('gfx.quality',4);params.set('gfx.auto',true)})
it('subscribes once, shares F3 state, lowers via the governor and disposes listeners',()=>{
 const entries=new Map<string,string>(),listeners=new Map<string,Function>()
 const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)}
 const remove=vi.fn(),cancel=vi.fn()
 vi.stubGlobal('window',{sessionStorage:storage,devicePixelRatio:1,addEventListener:(k:string,f:Function)=>listeners.set(k,f),removeEventListener:remove,dispatchEvent:()=>true})
 vi.stubGlobal('document',{hidden:false,addEventListener:()=>{},removeEventListener:remove,createElement:()=>({style:{},hidden:false,remove(){}}),body:{append(){}}})
 vi.stubGlobal('navigator',{userAgent:'Desktop',maxTouchPoints:0})
 vi.stubGlobal('location',{search:''});vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',cancel)
 const c=new QualityController(),seen:boolean[]=[]
 c.setPerformanceEnvironment(()=>({backend:'webgpu',adapter:null,memoryGB:null,maxTextureSize:null,fallbackReason:null,deviceLost:null}))
 const unsub=c.subscribePerformance(s=>seen.push(s.visible))
 listeners.get('keydown')!({code:'F3',repeat:false,preventDefault(){}})
 expect(seen).toEqual([false,true]);expect(Object.isFrozen(c.getPerformanceSnapshot().quality)).toBe(true)
 params.set('gfx.auto',false)
 for(let i=0;i<400;i++)c.frame(metrics(50))
 // A first visit with no adapter information starts at High, so the offer is Medium.
 expect(c.getPerformanceSnapshot().recommendation?.targetLevel).toBe(2)
 expect(c.lowerRecommendedTier()).toBe(true);expect(c.governor.level).toBe(2);expect(c.governor.levelPinned).toBe(true);expect(c.governor.auto).toBe(false)
 expect(c.lowerRecommendedTier()).toBe(false)
 c.ignoreRecommendation();expect(entries.get('mira.performance.ignore')).toBe('1')
 unsub();const n=seen.length;c.toggleDiagnostics();expect(seen).toHaveLength(n)
 c.dispose();expect(remove).toHaveBeenCalled();expect(cancel).toHaveBeenCalledWith(1)
 const restored=new QualityController();expect(restored.governor.levelPinned).toBe(true)
 for(let i=0;i<800;i++)restored.frame(metrics(100))
 expect(restored.getPerformanceSnapshot().recommendation).toBeNull();restored.dispose()
})
it('explicit lower preserves cheaper rungs across level boundaries without enabling auto',()=>{
 const g=new QualityGovernor({level:1,auto:false,devicePixelRatio:2})
 g.rung=g.ladder.length-1
 const before={...g.settings}
 expect(g.lowerManualLevel()?.level).toBe(0)
 expect(g.settings.pixelRatio).toBeLessThanOrEqual(before.pixelRatio)
 expect(g.settings.particles).toBeLessThanOrEqual(before.particles)
 expect(g.levelPinned).toBe(true);expect(g.auto).toBe(false)
 expect(g.lowerManualLevel()).toBeNull()
})
it('Ignore has no cross-tab localStorage fallback',()=>{
 const entries=new Map<string,string>(),storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)}
 vi.stubGlobal('window',{get sessionStorage(){throw Error('blocked')},localStorage:storage,devicePixelRatio:1,addEventListener(){},removeEventListener(){},dispatchEvent(){}})
 vi.stubGlobal('document',{hidden:false,addEventListener(){},removeEventListener(){}})
 vi.stubGlobal('navigator',{userAgent:'Desktop',maxTouchPoints:0});vi.stubGlobal('location',{search:''})
 const c=new QualityController();c.ignoreRecommendation()
 expect(entries.has('mira.performance.ignore')).toBe(false);c.dispose()
})

describe('device readback counters',()=>{
 it('counts pipelines by identity so a same-frame swap is not hidden by a constant size',()=>{
  const c=new PipelineCounter(),cache=new Map<string,object>([['a',{}],['b',{}]])
  expect(c.scan(cache)).toEqual({live:2,fresh:2})
  expect(c.scan(cache)).toEqual({live:2,fresh:0})
  cache.delete('a');cache.set('a',{}) // released and recreated under the same key: size unchanged
  expect(c.scan(cache)).toEqual({live:2,fresh:1});expect(c.created).toBe(3)
  expect(c.scan(undefined)).toBeNull();expect(c.scan(null)).toBeNull()
 })
 it('reports pipelines as unavailable rather than zero when the renderer gives nothing',()=>{
  const h=new PerformanceHistory();feed(h,2)
  expect(h.pipelines).toBeNull();expect(h.history.at(-1)!.pipelinesCreated).toBeNull()
 })
 it('keeps cumulative pipelines and per-window counts across evidence resets',()=>{
  const h=new PerformanceHistory(),m=(fresh:number)=>({...metrics(50),pipelinesLive:10,pipelinesFresh:fresh})
  for(let t=0;t<1000;t+=50){const f=m(t===0?10:t===500?25:0);h.observe(f,true);h.sample(f,true,q())}
  // The first sample opens a new quality key and resets the window; the cumulative count keeps it.
  expect(h.history.at(-1)!.pipelinesCreated).toBe(25);expect(h.pipelines).toEqual({live:10,created:35})
  h.resetEvidence();h.observe(m(3),true)
  expect(h.pipelines).toEqual({live:10,created:38})
  for(let t=0;t<1000;t+=50){const f=m(0);h.observe(f,true);h.sample(f,true,q())}
  expect(h.history.at(-1)!.pipelinesCreated).toBe(3)
 })
 it('counts long frames in menus and over a second, but not while hidden',()=>{
  const h=new PerformanceHistory()
  h.observe(metrics(16),true);h.observe(metrics(80),true);h.observe(metrics(1700),true);h.observe(metrics(900),false);h.observe(metrics(NaN),true)
  h.sample(metrics(1700),false,q());h.resetEvidence();h.ignore()
  expect(h.longFrames).toEqual({over50:2,over1000:1});expect(h.history).toHaveLength(0)
 })
 it('asks for a publish about once a second while counters change, and stays quiet otherwise',()=>{
  const h=new PerformanceHistory();let publishes=0
  for(let i=0;i<100;i++)if(h.observe(metrics(60),true))publishes++
  expect(publishes).toBe(5)
  const quiet=new PerformanceHistory();for(let i=0;i<400;i++)expect(quiet.observe(metrics(16),true)).toBe(false)
 })
})

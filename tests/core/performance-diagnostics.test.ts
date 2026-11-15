import { afterEach, expect, it, vi } from 'vitest'
import { installRenderDiagnostics, readPerformanceEnvironment, startupTiming } from '../../src/core/diagnostics'
import type { Game } from '../../src/core/Game'
afterEach(()=>{vi.unstubAllGlobals();delete startupTiming.backend;delete startupTiming.deviceLost;delete startupTiming.fallbackReason})
it('uses only the selected device and labels undisclosed hardware',()=>{
 const requestAdapter=vi.fn();vi.stubGlobal('navigator',{gpu:{requestAdapter},deviceMemory:8})
 const game={backend:'webgpu',renderer:{backend:{device:{adapterInfo:{vendor:'vendor',architecture:'arch',device:'',description:''},limits:{maxTextureDimension2D:8192}}}}} as unknown as Game
 expect(readPerformanceEnvironment(game)).toMatchObject({backend:'webgpu',adapter:'vendor arch',memoryGB:8,maxTextureSize:8192})
 expect(requestAdapter).not.toHaveBeenCalled()
 expect(readPerformanceEnvironment({backend:'webgl',renderer:{backend:{}}} as unknown as Game)).toMatchObject({adapter:null,maxTextureSize:null})
})
it('publishes the final outer loss detail without another frame or timer',async()=>{
 vi.stubGlobal('window',{});vi.stubGlobal('location',{search:''})
 let read:()=>unknown=()=>null;const snapshots:unknown[]=[]
 const quality={setPerformanceEnvironment(f:()=>unknown){read=f;snapshots.push(read())},setDiagnosticsVisible(){}}
 const renderer={backend:{},onDeviceLost:vi.fn(),onError:vi.fn(),getPixelRatio:()=>1}
 const game={quality,renderer,backend:'webgl',canvas:{width:1,height:1},performance:{},tick:0,fps:0} as unknown as Game
 const attach=installRenderDiagnostics(game);attach();attach()
 const inner=renderer.onDeviceLost
 renderer.onDeviceLost=vi.fn(info=>{inner(info);startupTiming.deviceLost='WebGL: final outer detail'})
 renderer.onDeviceLost({api:'WebGL',message:'inner message'})
 await Promise.resolve()
 expect(snapshots.at(-1)).toMatchObject({deviceLost:'WebGL: final outer detail'})
 expect((window as unknown as {syn3hDiagnostics:{deviceLost:string}}).syn3hDiagnostics.deviceLost).toBe('WebGL: final outer detail')
})

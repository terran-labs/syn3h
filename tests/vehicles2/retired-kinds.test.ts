/**
 * The Mars Explorer buggy ('buggy-classic') was retired on 15 November 2026. Its name is still
 * in saved lobby choices, shared links, resume snapshots and the hello of older clients, and
 * every one of those must come up as the Syn3h buggy: no crash, no blank vehicle.
 */
import {existsSync,readFileSync,readdirSync} from 'node:fs'
import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {TANK_AVAILABLE,VEHICLE_KINDS,canonicalVehicleKind,createVehicle,type VehicleKind} from '../../src/vehicles'
import {Syn3hBuggy} from '../../src/vehicles/Syn3hBuggy'
import {sanitizeVehicleChoice} from '../../src/ui/VehicleChoice'
import {parseResume,prepareResume,type ResumeSnapshot} from '../../src/core/resume'
import {VEHICLE_KINDS as WIRE_KINDS} from '../../shared/protocol'
import {harness} from './harness'
beforeAll(initPhysics)
const root=new URL('../../',import.meta.url)

describe('the retired classic buggy',()=>{
 it('is not offered: not in the registry, not in the lobby, not in the bots pool',()=>{
  expect(VEHICLE_KINDS.map(v=>v.kind)).toEqual(['buggy','jet','hovercraft',...(TANK_AVAILABLE?['tank']:[])])
  expect(readFileSync(new URL('src/ui/Shell.ts',root),'utf8')).not.toContain('value="buggy-classic"')
  // Bots are built by createVehicle, which cannot build one (next test); the pool does not name it either.
  expect(readFileSync(new URL('src/bots/BotManager.ts',root),'utf8')).not.toContain('classic')
 })
 it('builds the Syn3h buggy for an old link, an old client and an unknown kind',()=>{
  const h=harness()
  for(const kind of ['buggy-classic','some-future-kind',''] as unknown as VehicleKind[]){
   const v=createVehicle(h.game,h.terrain,kind,new T.Vector3(0,2,0),0)
   expect(v,String(kind)).toBeInstanceOf(Syn3hBuggy);expect(v.kind).toBe('buggy')
   // It drives: nothing about the retired name leaves it inert.
   v.isLocal=false;v.input.y=1;h.step(v,240)
   expect(Math.hypot(v.body.linvel().x,v.body.linvel().z),String(kind)).toBeGreaterThan(3)
   v.dispose()
  }
  h.world.free()
 })
 it('names the kind that will really be built',()=>{
  expect(canonicalVehicleKind('buggy-classic')).toBe('buggy');expect(canonicalVehicleKind('buggy-syn3h')).toBe('buggy')
  expect(canonicalVehicleKind(null)).toBe('buggy');expect(canonicalVehicleKind('nonsense')).toBe('buggy')
  for(const kind of VEHICLE_KINDS.map(v=>v.kind))expect(canonicalVehicleKind(kind)).toBe(kind)
 })
 it('is still a legal kind on the wire, so a release 5 client in the room is not rejected',()=>{
  expect(WIRE_KINDS).toContain('buggy-classic')
 })
 it('turns a saved lobby choice into the Syn3h buggy and keeps the colours',()=>{
  expect(sanitizeVehicleChoice({vehicleKind:'buggy-classic' as never,bodyColor:'#123456',accentColor:'#abcdef'})).toEqual({vehicleKind:'buggy-syn3h',bodyColor:'#123456',accentColor:'#abcdef'})
 })
 it('resumes a snapshot that names it, with or without the old vehicle in the link',()=>{
  const snapshot:ResumeSnapshot={version:1,savedAt:Date.now(),room:'lobby',seed:1,wasHost:false,world:{},kind:'buggy-classic' as never,colors:{body:'#123456',accent:'#abcdef'},p:[10,12,20],q:[0,0,0,1],v:[1,2,3],w:[0,0,0],wingsOpen:false,special:false,cameraMode:2,timeOfDay:10}
  const raw=JSON.stringify(snapshot),storage={getItem:()=>raw}
  expect(parseResume(raw,'lobby',1)?.p).toEqual([10,12,20])
  for(const query of ['','vehicle=buggy-classic','vehicle=buggy','vehicle=buggy-syn3h'])expect(prepareResume(new URLSearchParams(query),storage)?.p,query).toEqual([10,12,20])
  expect(prepareResume(new URLSearchParams('vehicle=jet'),storage)).toBeNull()
 })
 it('ships no classic model, and nothing but models in the models folder',()=>{
  expect(existsSync(new URL('public/models/buggy-classic.glb',root))).toBe(false)
  expect(existsSync(new URL('public/models/buggy-classic-wheel.glb',root))).toBe(false)
  // Everything under public/ is copied into the build as is: converters and notes live in tools/models.
  expect(readdirSync(new URL('public/models',root)).sort()).toEqual(['buggy-boxarm.glb','buggy.glb','tank.glb','tanktread.glb'])
 })
})

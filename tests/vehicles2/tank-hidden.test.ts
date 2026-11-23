/**
 * The owner hid the tank on 16 November 2026 (src/vehicles/available.ts). While it is hidden
 * no picker or bot offers it, and every saved or remote tank comes up as a working buggy.
 */
import {readFileSync} from 'node:fs'
import {beforeAll,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {initPhysics} from '../../src/core/physics'
import {TANK_AVAILABLE,VEHICLE_KINDS,canonicalVehicleKind,createVehicle} from '../../src/vehicles'
import {MiraBuggy} from '../../src/vehicles/MiraBuggy'
import {PLAY_VEHICLES,sanitizeVehicleChoice} from '../../src/ui/VehicleChoice'
import {buildTree,type PropertyDef} from '../../src/ui/inspector/model'
import {needsRebuild} from '../../src/net/kinds'
import {params} from '../../shared/params'
import '../../src/vehicles/Tank'
import {harness} from './harness'
beforeAll(initPhysics)

describe.skipIf(TANK_AVAILABLE)('the hidden tank',()=>{
 it('is not offered by the picker, the registry, the bots or the Vehicles card',()=>{
  expect(PLAY_VEHICLES.map(v=>v.id)).not.toContain('tank')
  expect(VEHICLE_KINDS.map(v=>v.kind)).not.toContain('tank')
  expect(readFileSync(new URL('../../src/bots/BotManager.ts',import.meta.url),'utf8')).not.toMatch(/['"]tank['"]/)
  const groups=buildTree(params.all().map(p=>p.def as PropertyDef)).flatMap(s=>s.tree.map(g=>g.name))
  expect(groups).not.toContain('Tank')
 })
 it('a saved tank choice falls back to the buggy',()=>{
  expect(sanitizeVehicleChoice({vehicleKind:'tank'}).vehicleKind).toBe('buggy-syn3h')
 })
 it('a tank from a link, a rejoin or an older client is built as a buggy that drives',()=>{
  expect(canonicalVehicleKind('tank')).toBe('buggy')
  // A remote tank and the buggy drawn for it are the same thing: no rebuild loop.
  expect(needsRebuild('buggy','tank')).toBe(false)
  const h=harness(),v=createVehicle(h.game,h.terrain,'tank',new T.Vector3(0,2,0),0)
  expect(v).toBeInstanceOf(MiraBuggy)
  v.isLocal=false;v.input.y=1;h.step(v,240)
  expect(Math.hypot(v.body.linvel().x,v.body.linvel().z)).toBeGreaterThan(3)
  v.dispose();h.world.free()
 })
})

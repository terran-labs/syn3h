/** Source-only diagnostic. Not a replacement for zorb.test.ts or an acceptance gate. */
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, FIXED_DT } from '../../src/core/physics'
import { createVehicle, type VehicleKind } from '../../src/vehicles'
import { params } from '../../shared/params'
import { harness } from './harness'

beforeAll(initPhysics)
const MAX_STEPS = 250
const vector = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z })
const message = (e: unknown) => e instanceof Error ? e.stack ?? e.message : String(e)

function fixture(liquid: 'water' | 'lava', kind: VehicleKind, full: boolean) {
  const h = harness(9.81, false)
  h.terrain.liquidHeightAt = () => 10
  h.terrain.liquidKindAt = () => liquid
  h.terrain.liquidVerticalSpeedAt = () => 0
  const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, 20, 0))
  v.isLocal = false
  v.zorb.sync(true, 1)
  v.body.recomputeMassPropertiesFromColliders()
  v.body.setLinearDamping(0); v.body.setAngularDamping(0)
  const c = v.zorb.centre(new THREE.Vector3()), p = v.body.translation()
  v.body.setTranslation({ x: p.x - c.x, y: p.y + 10 + v.zorb.radius + .2 - c.y, z: p.z }, true)
  v.body.setLinvel({ x: 30, y: full ? -8 : -4, z: 0 }, true)
  v.body.setAngvel({ x: 0, y: 2, z: 0 }, true)
  if (full) v.input.zorb = true
  return { h, v }
}

type Fixture = ReturnType<typeof fixture>
function snapshot(f: Fixture) {
  const b = f.v.body
  const w = vector(b.angvel())
  const velocity = vector(b.linvel())
  // Rapier 0.21 declares this tensor world-space and exposes named matrix entries.
  // Store the raw tensor too. I*w is diagnostic effective momentum, not a claim
  // that world-Y angular velocity or even |omega| must be conserved.
  const I = b.effectiveAngularInertia()
  // Copy before any other Rapier getter can reuse the tensor's backing storage.
  const tensor = [I.m11,I.m12,I.m13,I.m21,I.m22,I.m23,I.m31,I.m32,I.m33]
  const L = { x: tensor[0]*w.x + tensor[1]*w.y + tensor[2]*w.z,
    y: tensor[3]*w.x + tensor[4]*w.y + tensor[5]*w.z,
    z: tensor[6]*w.x + tensor[7]*w.y + tensor[8]*w.z }
  const pairs = new Set<string>()
  for (let i = 0; i < b.numColliders(); i++) {
    const a = b.collider(i)
    f.h.world.contactPairsWith(a, other => pairs.add([a.handle, other.handle].sort((x,y) => x-y).join(':')))
  }
  const centre = f.v.zorb.centre(new THREE.Vector3())
  return { position: vector(b.translation()), rotation: { ...b.rotation() }, velocity: vector(velocity),
    omega: vector(w), omegaMagnitude: Math.hypot(w.x,w.y,w.z), effectiveMomentum: L,
    effectiveMomentumMagnitude: Math.hypot(L.x,L.y,L.z), rotationalEnergy: .5*(w.x*L.x+w.y*L.y+w.z*L.z),
    inertiaWorld: tensor,
    principalInertia: vector(b.principalInertia()), principalFrame: { ...b.principalInertiaLocalFrame() },
    localCom: vector(b.localCom()), worldCom: vector(b.worldCom()), mass: b.mass(),
    force: vector(b.userForce()), torque: vector(b.userTorque()),
    linearDamping: b.linearDamping(), angularDamping: b.angularDamping(), bodyType: b.bodyType(), enabled: b.isEnabled(),
    centre: vector(centre), radius: f.v.zorb.radius, gap: centre.y - 10 - f.v.zorb.radius,
    surface: { kind: f.h.terrain.liquidKindAt!(centre.x, centre.z), height: 10, normal: {x:0,y:1,z:0}, verticalSpeed: 0 },
    normalSpeed: velocity.y, tangentSpeed: Math.hypot(velocity.x, velocity.z),
    contactPairs: [...pairs], skips: f.v.zorb.skips, hops: f.v.zorb.hops,
    pulse: f.v.zorb.pulse, heat: f.v.liquidState.heat, stuck: f.v.liquidState.stuck }
}
type Sample = ReturnType<typeof snapshot>
type Phase = { step: number; phase: string; state: Sample; delta: null | {
  omega: {x:number;y:number;z:number}; effectiveMomentum: {x:number;y:number;z:number}; tangentSpeed:number; skips:number
} }
type Failure = { step: number; phase: string; assertion: string }
type RecordCase = { name: string; status: string; phases: Phase[]; firstFailure: Failure | null;
  observationErrors: string[]; error: string | null; firstSkip: {step:number;phase:string} | null;
  contacts: {step:number;speed:number;spin:number}[]; steps: number; floatCalls: number }

it('records bounded paired spin and default full-update evidence without excusing failed assertions', () => {
  const out = process.env.SYN3H_ZORB_DIAGNOSTIC_OUT
  if (!out) throw new Error('Explicit fresh diagnostic output directory required')
  if (existsSync(join(out, 'observations.json'))) throw new Error('Refusing to overwrite diagnostic evidence')
  mkdirSync(out, { recursive: true })
  const cases: RecordCase[] = []
  const ids = ['water.sinking','zorb.bounce','zorb.skipSpeed','zorb.skipAngle']
  const prior = ids.map(id => [id, params.get(id)!.value] as const)
  const persist = () => {
    const path = join(out, 'observations.json')
    writeFileSync(path + '.tmp', JSON.stringify({ base: 'fc70f28a5688c617a46db98ac23746e925bef400',
      diagnosticOnly: true, accepted: false, dt: FIXED_DT, maxSteps: MAX_STEPS, cases }, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? { nonfinite: String(value) } : value, 2))
    renameSync(path + '.tmp', path)
  }
  // Separate worlds use identical initial setup. The free control omits float only;
  // its later vertical trajectory differs and it is not a legacy gameplay baseline.
  const configs = [
    {name:'free-control',full:false,float:false,liquid:'water' as const},
    {name:'float-candidate',full:false,float:true,liquid:'water' as const},
    {name:'full-water-default',full:true,float:true,liquid:'water' as const},
    {name:'full-lava-default',full:true,float:true,liquid:'lava' as const},
  ]
  try {
    persist()
    for (const config of configs) {
      const r: RecordCase = {name:config.name,status:'incomplete',phases:[],firstFailure:null,
        observationErrors:[],error:null,firstSkip:null,contacts:[],steps:0,floatCalls:0}
      cases.push(r); persist()
      let f: Fixture | undefined
      let restore: (() => void) | undefined
      let step = -1
      const check = (phase: string, assertion: () => void) => {
        try { assertion() } catch (e) { r.firstFailure ??= {step,phase,assertion:message(e)} }
      }
      try {
        for (const id of ids) params.set(id, params.get(id)!.def.default)
        if (!config.full) { params.set('water.sinking',false); params.set('zorb.bounce',.8) }
        f = fixture(config.liquid, config.full ? 'hovercraft' : 'buggy', config.full)
        const active = f
        const capture = (phase: string) => {
          // Observation failures cannot replace a float return or thrown exception.
          try {
            const state = snapshot(active), previous = r.phases.at(-1)?.state
            const subtract = (a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z})
            r.phases.push({step,phase,state,delta: previous ? {
              omega:subtract(state.omega,previous.omega),effectiveMomentum:subtract(state.effectiveMomentum,previous.effectiveMomentum),
              tangentSpeed:state.tangentSpeed-previous.tangentSpeed,skips:state.skips-previous.skips } : null})
            if (state.skips > 0) r.firstSkip ??= {step,phase}
            // Assert the actual persisted fields agree, after all snapshot getters.
            const t = state.inertiaWorld, o = state.omega
            expect(state.effectiveMomentum).toEqual({
              x:t[0]*o.x+t[1]*o.y+t[2]*o.z,
              y:t[3]*o.x+t[4]*o.y+t[5]*o.z,
              z:t[6]*o.x+t[7]*o.y+t[8]*o.z,
            })
            expect(state.rotationalEnergy).toBe(.5*(o.x*state.effectiveMomentum.x+o.y*state.effectiveMomentum.y+o.z*state.effectiveMomentum.z))
          } catch(e) { r.observationErrors.push(message(e)) }
        }
        const original = f.v.zorb.float
        f.v.zorb.float = function (...args: Parameters<typeof original>): ReturnType<typeof original> {
          r.floatCalls++; capture('preFloat')
          try { return Reflect.apply(original, this, args) }
          finally { capture('postFloat') }
        }
        restore = () => { active.v.zorb.float = original }
        capture('initial')
        if (config.full) check('defaults', () => {
          expect(params.get('zorb.bounce')!.value).toBe(.5)
          expect(params.get('zorb.skipSpeed')!.value).toBe(10)
          expect(params.get('zorb.skipAngle')!.value).toBe(20)
        })
        let count = 0, followup = false
        for (step = 0; step < MAX_STEPS; step++) {
          if (config.full) { capture('preFixed'); f.v.fixedUpdate(FIXED_DT); capture('postFixed') }
          else {
            f.v.body.resetForces(true); f.v.body.resetTorques(true); capture('preForce')
            if (config.float) f.v.zorb.float(f.h.terrain,f.v.liquidState,FIXED_DT)
            capture('postForce')
          }
          f.h.world.step(); capture('postWorld')
          if (config.full) { f.v.postPhysics(FIXED_DT); capture('postPhysics') }
          r.steps = step + 1
          const v = f.v.body.linvel(), w = f.v.body.angvel(), speed = Math.hypot(v.x,v.z)
          if (f.v.zorb.skips > count) {
            count = f.v.zorb.skips; r.contacts.push({step,speed,spin:w.y})
            if (config.full) check('contact', () => { expect(speed).toBeCloseTo(30,3); expect(w.y).toBeCloseTo(2,3) })
          }
          if (!config.full) check('postWorld', () => { expect(speed).toBeCloseTo(30,3); expect(w.y).toBeCloseTo(2,4) })
          if (followup) check('outwardFollowup', () => expect(v.x).toBeCloseTo(30,3))
          persist() // One completed step survives a later throw or outer deadline.
          if (config.full && followup) break
          if (config.full && r.contacts.length >= 3) followup = true
          if (!config.full && config.float && r.contacts.length >= 4) break
        }
        check('terminal', () => {
          if (config.float) expect(r.contacts.length).toBe(config.full ? 3 : 4)
          expect(f!.v.zorb.hops).toBe(0)
          if (!config.full && config.float) {
            expect(f!.v.zorb.pulse).toBe(0); expect(f!.v.liquidState.heat).toBe(0); expect(f!.v.liquidState.stuck).toBe(false)
          }
          if (config.full) expect(followup && r.steps > r.contacts[2].step + 1).toBe(true)
        })
        r.status = r.firstFailure ? 'assertion-failed' : 'observed-no-assertion-failure'
      } catch(e) { r.error = message(e); r.status = 'error' }
      finally {
        restore?.()
        try { f?.v.dispose() } catch(e) { r.observationErrors.push(message(e)) }
        try { f?.h.world.free() } catch(e) { r.observationErrors.push(message(e)) }
        if (r.observationErrors.length) r.status = 'observation-incomplete'
        persist()
      }
    }
  } finally { for (const [id,value] of prior) params.set(id,value); persist() }
  // Observational continuation does not convert the original failed invariant to a pass.
  const failures = cases.filter(r => r.firstFailure || r.error || r.observationErrors.length)
  if (failures.length) throw new Error(JSON.stringify(failures.map(r => ({name:r.name,firstFailure:r.firstFailure,error:r.error,observationErrors:r.observationErrors}))))
})

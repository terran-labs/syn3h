import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { Tank } from '../../src/vehicles/Tank'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { Jet } from '../../src/vehicles/Jet'
import { harness } from '../vehicles2/harness'
import { ZORB_FLOAT_DEPTH } from '../../src/vehicles/zorb'
import { waterSinking, applyWaterForces } from '../../src/vehicles/buoyancy'
beforeAll(initPhysics)
afterEach(()=>{waterSinking.value=waterSinking.def.default})
function setup(){
 waterSinking.value=true
 const h=harness();h.terrain.liquidHeightAt=()=>10;h.terrain.liquidKindAt=()=> 'water'
 return h
}
it.each([['syn3h',Syn3hBuggy]] as const)('%s sinks upright to the bed and drives on contacts',(_name,Kind)=>{
 const h=setup(),v=new Kind(h.game,h.terrain,new THREE.Vector3(0,9,0));v.isLocal=false
 try{
  h.step(v,1800)
  expect(v.body.translation().y).toBeLessThan(2)
  expect(new THREE.Vector3(0,1,0).applyQuaternion(v.object.quaternion).y).toBeGreaterThan(.9)
  const z=v.body.translation().z;v.input.y=1
  let contacts=0;for(let i=0;i<300;i++){h.step(v);contacts=Math.max(contacts,v.wheelsGrounded)}
  expect(contacts).toBeGreaterThanOrEqual(2)
  expect(v.body.translation().z).toBeLessThan(z-2)
 }finally{v.dispose();h.world.free()}
})
it('open wings lift a buggy from the seabed',()=>{
 const h=setup(),v=new Syn3hBuggy(h.game,h.terrain,new THREE.Vector3(0,1,0));v.isLocal=false
 try{h.step(v,60);v.input.special=true;h.step(v,300);expect(v.body.translation().y).toBeGreaterThan(10)}finally{v.dispose();h.world.free()}
})
it('switch off retains the legacy float',()=>{
 const h=setup();waterSinking.value=false
 const v=new Syn3hBuggy(h.game,h.terrain,new THREE.Vector3(0,9,0));v.isLocal=false
 try{h.step(v,900);expect(v.body.translation().y).toBeGreaterThan(9)}finally{v.dispose();h.world.free()}
})
// Isolated rigid bodies distinguish hydrodynamic forces from each vehicle controller.
function bodyTrial(kind:string,y:number,seconds:number,speed=0,flow=0,radius=0){
 const h=setup();h.terrain.liquidFlowAt=(_x,_z,out)=>{out.x=flow;out.z=0;return out}
 const b=h.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,y,0))
 h.world.createCollider(RAPIER.ColliderDesc.cuboid(.8,.5,1.2),b)
 b.setLinvel({x:0,y:0,z:speed},true)
 for(let i=0;i<seconds*60;i++){
  b.resetForces(true);b.resetTorques(true)
  // Maintain forward speed as a driven hull would, to measure steady planing support.
  if(speed)b.addForce({x:0,y:0,z:(speed-b.linvel().z)*b.mass()*10},true)
  applyWaterForces(b,h.world,h.terrain,kind,1/60,radius)
  h.world.step()
 }
 const result={p:b.translation(),v:b.linvel()};h.world.free();return result
}
it('buggy at 12 m/s planes near the surface',()=>{expect(bodyTrial('buggy',10,15,12).p.y).toBeGreaterThan(9.3)})
it('tank plunges to the bed',()=>{expect(bodyTrial('tank',10,15).p.y).toBeLessThan(1)})
it('sealed field floats on its base',()=>{expect(bodyTrial('zorb',5,20,0,0,2).p.y).toBeCloseTo(10+2-ZORB_FLOAT_DEPTH,0)})
it('river current carries a submerged hull downstream',()=>{
 const result=bodyTrial('buggy',5,6,0,3)
 expect(result.p.x).toBeGreaterThan(5);expect(result.v.x).toBeGreaterThan(1)
})

it.each([['tank',Tank],['hovercraft',Hovercraft],['jet',Jet]] as const)('%s controller stays finite in deep water',(kind,Kind)=>{
 const h=setup(),v=new Kind(h.game,h.terrain,new THREE.Vector3(0,9,0));v.isLocal=false
 try{
  h.step(v,900)
  const p=v.body.translation(),speed=v.body.linvel()
  expect([p.x,p.y,p.z,speed.x,speed.y,speed.z].every(Number.isFinite)).toBe(true)
  if(kind==='tank')expect(p.y).toBeLessThan(3)
  if(kind==='hovercraft')expect(p.y).toBeGreaterThan(8)
 }finally{v.dispose();h.world.free()}
})

it('actual zorbed buggy floats in the shared model and follows current',()=>{
 const h=setup();h.terrain.liquidFlowAt=(_x,_z,out)=>{out.x=3;out.z=0;return out}
 const v=new Syn3hBuggy(h.game,h.terrain,new THREE.Vector3(0,6,0));v.isLocal=false;v.input.zorb=true
 try{
  h.step(v,1800)
  expect(v.zorb.active).toBe(true)
  expect(v.zorb.centre(new THREE.Vector3()).y).toBeCloseTo(10+v.zorb.radius-ZORB_FLOAT_DEPTH,0)
  expect(v.body.translation().x).toBeGreaterThan(10)
 }finally{v.dispose();h.world.free()}
})


// One column in radius mode, not the four-column hull or a solver-energy test.
describe('real sea heave in the shared force pass', { concurrent: false }, () => {
  it('matches hydrostatic force at surface velocity and opposes signed offsets', async () => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['performance'] })
    let restore = () => {}
    let world: import('../../src/core/physics').RAPIER.World | undefined
    try {
      let wallMs = 0, delta = 0
      const spy = vi.spyOn(performance, 'now').mockImplementation(() => wallMs)
      restore = () => spy.mockRestore()
      const { params: registry } = await import('../../shared/params')
      const water = await import('../../src/world/water/seaWaves')
      const weather = await import('../../src/world/weather')
      const forces = await import('../../src/vehicles/buoyancy')
      const physics = await import('../../src/core/physics')
      await physics.initPhysics()
      for (const [id, value] of Object.entries({
        'world.gravity': 9.81, 'world.seed': 11, 'world.lavaAltitude': 0,
        'water.waves': true, 'water.waveHeight': 1.4, 'water.waveLength': 60,
        'water.waveTurn': 0, 'weather.storminess': .5, 'weather.windSpeed': 16,
        'weather.gustiness': .5, 'weather.windDirection': 0,
        'water.linearDrag': .35, 'water.quadraticDrag': .06, 'water.zorb.buoyancy': 2,
      })) {
        expect(registry.get(id), id).toBeDefined()
        registry.set(id, value, 'local')
        expect(registry.get(id)?.value).toBe(value)
      }
      if (registry.get('world.atmosphere')) registry.set('world.atmosphere', 1)
      expect(weather.atmosphereValue()).toBe(1)
      water.seaWaves.configure(2048, 11)
      const phase = () => 143 + delta
      water.setWaterClock(phase, () => 1)
      weather.setWeatherClock(() => water.FAN_SECONDS * 7.5, () => 0)
      wallMs = 5000; water.setWaterClock(phase, () => 1)
      const centreMs = 5000 + water.CLOCK_SWITCH_SECONDS * 1000 / 4
      const at = (dt: number) => { delta = dt; wallMs = centreMs + dt * 1000 }
      const seaHeight = (x: number, z: number) => water.seaWaves.offsetAt(x, z, -50, 0)
      const height = (dt: number) => { at(dt); return seaHeight(123, -456) }
      const h = 1e-4, half = h / 2
      const heights = [height(-h), height(h), height(-half), height(half)]
      const coarse = (heights[1] - heights[0]) / (2 * h), D = (heights[3] - heights[2]) / (2 * half)
      const convergence = Math.abs(D - coarse)
      for (const value of [...heights, coarse, D]) expect(Number.isFinite(value)).toBe(true)
      expect(convergence).toBeLessThanOrEqual(1e-6)
      const derivativeError = 4 * convergence / 3 + 128 * Number.EPSILON * Math.max(1, ...heights.map(Math.abs)) / half
      expect(Math.abs(D)).toBeGreaterThan(1e-3) // Zero heave cannot make this test vacuous.
      at(0)
      world = physics.createWorld(9.81)
      const radius = 2, surface = seaHeight(123, -456)
      const body = world.createRigidBody(physics.RAPIER.RigidBodyDesc.dynamic().setTranslation(123, surface + radius - .4, -456))
      world.createCollider(physics.RAPIER.ColliderDesc.ball(.5), body)
      body.recomputeMassPropertiesFromColliders()
      const point = body.translation(), mass = body.mass()
      expect(mass).toBeGreaterThan(0)
      // Derive immersion from the actual Float32 pose, not the requested translation.
      const fraction = (seaHeight(point.x, point.z) - point.y + radius) / .8
      expect(fraction).toBeGreaterThan(.25); expect(fraction).toBeLessThan(.75)
      const terrain = { heightAt: () => -50, liquidHeightAt: seaHeight, liquidKindAt: () => 'water',
        liquidFlowAt: (_x: number, _z: number, out: { x: number; z: number }) => { out.x = 0; out.z = 0; return out } } as unknown as import('../../src/world/Terrain').Terrain
      const dt = .02, hydrostatic = 2 * mass * (-world.gravity.y) * fraction
      const heave = 24 * fraction * (1 - fraction) * mass
      const cap = .8 / Math.max(dt, .001)
      // Test unclamped quadratic drag and both signs beyond the clamp, without stepping.
      for (const offset of [0, 2, -2, 800, -800]) {
        body.resetForces(true); body.resetTorques(true)
        body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        body.setLinvel({ x: 0, y: D + offset, z: 0 }, true)
        const v = body.velocityAtPoint(point), relative = v.y - D
        expect(v.x).toBe(0); expect(v.z).toBe(0)
        const rawDrag = .35 + .06 * Math.abs(relative)
        if (Math.abs(offset) === 800) expect(rawDrag).toBeGreaterThan(cap)
        else expect(rawDrag).toBeLessThan(cap)
        const drag = Math.min(cap, rawDrag) * fraction * mass
        const expected = hydrostatic - relative * (drag + heave)
        // Lipschitz bound for drag+heave with respect to derivative uncertainty.
        const sensitivity = heave + fraction * mass * (cap + .06 * (Math.abs(relative) + derivativeError))
        // Rapier accumulates Float32 force. 64 ulps covers conversion and the short
        // arithmetic chain at this fixed geometry; it is not a solver tolerance.
        const floatError = 64 * 2 ** -23 * Math.max(1, Math.abs(hydrostatic), Math.abs(expected))
        const bound = derivativeError * sensitivity + floatError
        forces.applyWaterForces(body, world, terrain, 'zorb', dt, radius)
        const actual = body.userForce().y
        expect(Number.isFinite(actual)).toBe(true)
        if (offset === 0) {
          // Absolute oracle first: ignoring heave must not pass by force subtraction.
          expect(Math.abs(actual - hydrostatic)).toBeLessThanOrEqual(bound + Math.abs(v.y - D) * sensitivity)
        }
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound)
        if (offset > 0) expect(actual).toBeLessThan(hydrostatic)
        if (offset < 0) expect(actual).toBeGreaterThan(hydrostatic)
        expect(body.translation()).toEqual(point)
        expect(body.angvel()).toEqual({ x: 0, y: 0, z: 0 })
      }
    } finally {
      try { world?.free() } finally {
        try { restore() } finally { vi.useRealTimers(); vi.resetModules() }
      }
    }
  })
})

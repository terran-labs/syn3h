import * as THREE from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { emptyInput } from '../../src/core/Input'
import { createWorld, FIXED_DT, GROUP_ALL, GROUP_TERRAIN, groups, RAPIER } from '../../src/core/physics'

export function harness(gravity = 9.81, floor = true) {
 const world = createWorld(gravity)
 if(floor) world.createCollider(RAPIER.ColliderDesc.cuboid(500,.5,500).setTranslation(0,-.5,0).setCollisionGroups(groups(GROUP_TERRAIN,GROUP_ALL)))
 const game = {world,scene:new THREE.Scene(),input:{state:emptyInput()}} as unknown as Game
 const terrain = {size:1000,heightAt:()=>0,normalAt:(_x:number,_z:number,out:THREE.Vector3)=>out.set(0,1,0),spawnPoint:()=>({position:new THREE.Vector3(0,2,0),heading:0}),dispose(){}} as Terrain
 // Rapier's broad phase incorporates newly created fixed colliders on the first step.
 world.step()
 return {world,game,terrain,step(vehicle:Vehicle,n=1){for(let i=0;i<n;i++){vehicle.fixedUpdate(FIXED_DT);world.step();vehicle.postPhysics(FIXED_DT)}}}
}

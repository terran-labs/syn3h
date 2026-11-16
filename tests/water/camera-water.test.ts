import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene } from 'three/webgpu'
import { CameraWater, wetTriangle } from '../../src/world/water/cameraWater'
import { Underwater, cameraWaterCoverage, waterUnderwater } from '../../src/world/water/underwater'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
const terrain={liquidKindAt:()=> 'water',liquidHeightAt:()=>0} as unknown as Terrain
const previous=waterUnderwater.value
afterEach(()=>{waterUnderwater.value=previous})
describe('camera water coverage',()=>{
 it('clips dry, partial and fully wet near planes',()=>{
  expect(wetTriangle(-1,-1,-1)).toBe(0)
  expect(wetTriangle(1,-1,-1)).toBe(.25)
  expect(wetTriangle(-1,1,1)).toBe(.75)
  const camera=new PerspectiveCamera(90,1,.1,100),water=new CameraWater()
  camera.position.y=1;water.update(camera,terrain);expect(water.coverage).toBe(0)
  camera.position.y=0;water.update(camera,terrain);expect(water.coverage).toBeCloseTo(.5)
  camera.position.y=-1;water.update(camera,terrain);expect(water.coverage).toBe(1)
 })
 it('samples local wave height and camera orientation, not a mean surface',()=>{
  const camera=new PerspectiveCamera(90,1,.1,100),water=new CameraWater()
  camera.position.y=.05;water.update(camera,terrain);expect(water.coverage).toBeCloseTo(.25)
  water.update(camera,{...terrain,liquidHeightAt:()=>.2} as Terrain);expect(water.coverage).toBe(1)
  camera.rotation.z=Math.PI;water.update(camera,terrain);expect(water.coverage).toBeCloseTo(.25)
 })
 it('ignores submerged local/remote vehicles and covers a wet camera with the vehicle dry',()=>{
  const camera=new PerspectiveCamera(),scene=new Scene()
  const vehicle={liquidState:{wasImmersed:true},position:{y:-4}}
  const game={scene,camera,player:vehicle,vehicles:[vehicle,{liquidState:{wasImmersed:true}}]} as unknown as Game
  const effect=new Underwater(game,terrain)
  try{
   camera.position.y=2;effect.update(.25);expect(cameraWaterCoverage(camera)).toBe(0)
   vehicle.liquidState.wasImmersed=false;vehicle.position.y=5
   camera.position.y=-2;effect.update(.25);expect(cameraWaterCoverage(camera)).toBe(1)
   waterUnderwater.value=false;effect.update(.25);expect(cameraWaterCoverage(camera)).toBe(1)
   expect(cameraWaterCoverage(new PerspectiveCamera())).toBe(0)
   camera.position.y=2;effect.update(0);expect(cameraWaterCoverage(camera)).toBe(0)
  }finally{effect.dispose()}
  expect(cameraWaterCoverage(camera)).toBe(0)
 })
 it.each([[-2,2],[2,-2]])('invalidates replaced cameras from height %i to %i',(aY,bY)=>{
  const a=new PerspectiveCamera(),b=new PerspectiveCamera();a.position.y=aY;b.position.y=bY
  const game={scene:new Scene(),camera:a} as Game
  const effect=new Underwater(game,terrain)
  try{
   effect.update(.25);expect(cameraWaterCoverage(a)).toBe(aY<0?1:0)
   game.camera=b;effect.update(.25)
   expect(cameraWaterCoverage(a)).toBe(0);expect(cameraWaterCoverage(b)).toBe(bY<0?1:0)
  }finally{effect.dispose()}
  expect(cameraWaterCoverage(a)).toBe(0);expect(cameraWaterCoverage(b)).toBe(0)
 })
 it('treats absent water and lava as dry',()=>{
  const camera=new PerspectiveCamera(),water=new CameraWater();camera.position.y=-2
  water.update(camera,{...terrain,liquidKindAt:()=> 'lava'} as Terrain);expect(water.coverage).toBe(0)
  water.update(camera,{...terrain,liquidHeightAt:()=>-Infinity} as Terrain);expect(water.coverage).toBe(0)
 })
})

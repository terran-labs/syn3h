import {expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {addNightReadability,vehicleNightAmount} from '../../src/vehicles/skins/nightReadability'
it('fades the readability aid out during daylight and leaves viewers unchanged',()=>{
 const scene=new T.Scene();expect(vehicleNightAmount(scene)).toBe(0)
 const sky=new T.Object3D() as T.Object3D&{sunDirection:{value:T.Vector3}}
 sky.sunDirection={value:new T.Vector3(0,1,0)};scene.add(sky)
 expect(vehicleNightAmount(scene)).toBe(0)
 sky.sunDirection.value.y=-.2;expect(vehicleNightAmount(scene)).toBe(1)
})
it('retains source emission and does not modify transparent cockpit materials',()=>{
 const root=new T.Group(),paint=new T.MeshStandardNodeMaterial(),glass=new T.MeshPhysicalMaterial({transparent:true})
 const source=paint.emissive;source.setRGB(.1,.2,.3)
 root.add(new T.Mesh(new T.BoxGeometry(),paint),new T.Mesh(new T.BoxGeometry(),glass))
 const originalGlass=glass.onBeforeRender
 addNightReadability(root)
 expect(paint.emissive).toBe(source);expect(paint.emissive.toArray()).toEqual([.1,.2,.3])
 expect(paint.emissiveNode).toBeTruthy();expect(glass.onBeforeRender).toBe(originalGlass)
})

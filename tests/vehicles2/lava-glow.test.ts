import {expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {addLavaGlow} from '../../src/vehicles/skins/lavaGlow'
import {createLiquidState} from '../../src/vehicles/lava'
it('adds heat to existing surfaces without adding meshes and preserves live paint references',()=>{
 const vehicle=new T.Group(),root=new T.Group();vehicle.add(root);vehicle.userData.vehicleHeat=createLiquidState()
 const paint=new T.MeshStandardMaterial({color:'blue'}),chrome=new T.MeshPhysicalMaterial({metalness:1})
 const a=new T.Mesh(new T.BoxGeometry(),paint),b=new T.Mesh(new T.BoxGeometry(),chrome);root.add(a,b)
 addLavaGlow(root)
 expect(root.children).toHaveLength(2)
 expect(a.material).toBeInstanceOf(T.MeshStandardNodeMaterial)
 expect(b.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
 expect(a.material.color).toBe(paint.color);expect(b.material.color).toBe(chrome.color)
 expect((a.material as unknown as T.MeshStandardNodeMaterial).emissiveNode).toBeTruthy()
})

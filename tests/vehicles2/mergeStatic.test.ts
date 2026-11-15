import {describe,it,expect} from 'vitest'
import * as T from 'three/webgpu'
import {mergeStatic,reducedGeometry,staticLods,registerVehicleDetail} from '../../src/vehicles/skins/mergeStatic'
describe('shared vehicle batching',()=>{
 it('merges opaque PBR surfaces while preserving bounds and colour references',()=>{
  const root=new T.Group(),a=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({color:'red',roughness:.2})),b=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({color:'blue',roughness:.8}))
  a.position.x=-2;b.position.x=2;b.scale.x=-1;root.add(a,b)
  const before=new T.Box3().setFromObject(root);mergeStatic(root,true)
  expect(root.children.length).toBe(1)
  expect(new T.Box3().setFromObject(root).equals(before)).toBe(true)
  const mesh=root.children[0] as T.Mesh
  expect(mesh.geometry.getAttribute('surfaceId').count).toBe(72)
  expect(mesh.geometry.getAttribute('position').count).toBe(72)
  expect((mesh.material as T.MeshStandardNodeMaterial).colorNode).toBeTruthy()
  const colors:unknown[]=[];(mesh.material as T.MeshStandardNodeMaterial).colorNode!.traverse(node=>{if('value' in node)colors.push(node.value)})
  expect(colors).toContain(a.material.color);a.material.color.setRGB(0,1,0);expect(a.material.color.g).toBe(1)
 })
 it('preserves an independently animated parent and transparent layers',()=>{
  const root=new T.Group(),gear=new T.Group();gear.name='Landing_Gear';root.add(gear)
  const material=new T.MeshStandardMaterial(),glass=new T.MeshBasicMaterial({transparent:true,opacity:.4})
  gear.add(new T.Mesh(new T.BoxGeometry(),material),new T.Mesh(new T.BoxGeometry(),material))
  const pane=new T.Mesh(new T.PlaneGeometry(),glass);root.add(pane)
  mergeStatic(root);expect(gear.parent).toBe(root);expect(pane.parent).toBe(root)
  gear.scale.y=.2;expect(gear.scale.y).toBe(.2)
 })
 it('reduces tiny triangles and preserves attributes needed by the material',()=>{
  const g=new T.PlaneGeometry(1,1,30,30),low=reducedGeometry(g,.1)
  expect(low.attributes.position.count).toBeLessThan(g.index!.count)
  expect(low.attributes.uv.count).toBe(low.attributes.position.count)
  expect(low.attributes.normal.count).toBe(low.attributes.position.count)
 })
 it('leaves the named gear alone and registers detail callbacks with cleanup',()=>{
  const root=new T.Group(),gear=new T.Mesh(new T.SphereGeometry(),new T.MeshStandardMaterial());gear.name='Landing_Gear';root.add(gear)
  expect(staticLods(root)).toHaveLength(0)
  const callbacks=new Set();root.userData.registerVehicleDetail=(fn:unknown)=>{callbacks.add(fn);return()=>callbacks.delete(fn)}
  const child=new T.Group();root.add(child);const dispose=registerVehicleDetail(child,()=>{})
  expect(callbacks.size).toBe(1);dispose();expect(callbacks.size).toBe(0)
 })
})

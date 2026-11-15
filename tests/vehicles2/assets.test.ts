import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

async function load(name:string){
 const bytes=readFileSync(new URL(`../../public/models/${name}.glb`,import.meta.url))
 return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene
}
describe('recovered Syn3h assets',()=>{
 it('recovers the five hovercraft surfaces with outward hull winding',async()=>{
  const scene=await load('hovercraft')
  for(const name of ['Main','Cockpit','Chrome','Accent','Spoilers'])expect(scene.getObjectByName(name)).toBeDefined()
  const main=scene.getObjectByName('Main') as THREE.Mesh,p=main.geometry.attributes.position,index=main.geometry.index!
  let volume=0
  for(let i=0;i<index.count;i+=3){
   const a=new THREE.Vector3().fromBufferAttribute(p,index.getX(i)),b=new THREE.Vector3().fromBufferAttribute(p,index.getX(i+1)),c=new THREE.Vector3().fromBufferAttribute(p,index.getX(i+2))
   volume+=a.dot(b.cross(c))/6
  }
  expect(volume).toBeGreaterThan(1)
  expect(new THREE.Box3().setFromObject(main).getSize(new THREE.Vector3()).z).toBeCloseTo(3.1454,3)
 })
})

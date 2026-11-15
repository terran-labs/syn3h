import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

async function load(name:string){
 const bytes=readFileSync(new URL(`../../public/models/${name}.glb`,import.meta.url))
 return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene
}
describe('recovered Syn3h assets',()=>{
 it('keeps the jet at original scale with nose and cockpit toward -Z',async()=>{
  const scene=await load('jet'),body=scene.getObjectByName('Body_Main')!,cockpit=scene.getObjectByName('Body_Cockpit')!
  const box=new THREE.Box3().setFromObject(body),size=box.getSize(new THREE.Vector3())
  expect(size.x).toBeCloseTo(7.6943,3);expect(size.z).toBeCloseTo(6.936,3)
  expect(new THREE.Box3().setFromObject(cockpit).max.z).toBeLessThan(0)
  expect(scene.getObjectByName('Landing_Gear')).toBeDefined()
 })
})

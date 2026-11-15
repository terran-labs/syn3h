// Run with node from the worktree root. Reads the owner's original asset as data only.
import fs from 'node:fs'
import * as THREE from 'three'
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
globalThis.FileReader = class {
 readAsArrayBuffer(blob) { blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()}) }
}
const source = process.argv[2] ?? '/tmp/syn3h-research/legacy/upstream/unity/Assets/Martian Assets/Vehicles/Hovercraft/Components/Model/Hovercraft.3ds'
const bytes=fs.readFileSync(source)
const original=new TDSLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
original.updateMatrixWorld(true)
const result=new THREE.Group()
// The 3DS stores Z up and its nose along -Y. Convert into Y up, -Z forward.
const transform=new THREE.Matrix4().makeRotationX(-Math.PI/2)
transform.premultiply(new THREE.Matrix4().makeRotationY(Math.PI))
transform.premultiply(new THREE.Matrix4().makeScale(.05,.05,.05))
original.traverse(o=>{if(o.isMesh&&o.geometry.attributes.position?.count){
 const geometry=o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform,o.matrixWorld))
 geometry.computeVertexNormals()
 const material=new THREE.MeshStandardMaterial({color:o.name==='Cockpit'?0x354659:0xb49a46,roughness:.45,metalness:.35})
 const mesh=new THREE.Mesh(geometry,material);mesh.name=o.name;result.add(mesh)
}})
const glb=await new GLTFExporter().parseAsync(result,{binary:true})
fs.writeFileSync('public/models/hovercraft.glb',Buffer.from(glb))

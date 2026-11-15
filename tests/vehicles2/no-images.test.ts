// Vehicles and their effects load no image file (AGENTS.md: generate it, do not ship it). This
// fails if vehicle or effect code names an image file or uses an image loader again, if an image
// returns to the vehicle model folders, or if a generated map stops matching what its material
// expects.
//
// One allowance, by name: the jet and hovercraft paint still use armor-scales.jpg and
// thruster-glow.png (Jet.ts, Hovercraft.ts, and skins/textureViews.ts, which loads for Jet.ts).
// The owner set those aside on 14 November 2026; they go when those vehicles move to the shared
// vehicle materials system. Remove the allowance then. Anything else fails. The browser half of the check, that no request for /models/textures/ or
// /models/effects/ is made while each vehicle kind drives, is tests/vehicles2/nobitmaps-capture.mjs.
import {readdirSync,readFileSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {createTreadMap} from '../../src/vehicles/effects/maps'
import {dustSprite,glowSprite,plasmaSprite,tyreMarkAlpha} from '../../src/vehicles/effects/sprites'
import {ParticleBatch} from '../../src/vehicles/effects/ParticleBatch'
import {RibbonBatch} from '../../src/vehicles/effects/RibbonBatch'

const root=new URL('../../',import.meta.url).pathname
const files=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?files(p):[p]})
const IMAGE=/\.(png|jpe?g|webp|gif|bmp|avif|ktx2?|basis|dds|tga|exr|hdr)\b/i
const ALLOWED_FILES=new Set(['src/vehicles/Jet.ts','src/vehicles/Hovercraft.ts','src/vehicles/skins/textureViews.ts'])
const ALLOWED_IMAGES=['textures/armor-scales.jpg','textures/thruster-glow.png']
const LOADER=/\b(TextureLoader|ImageLoader|ImageBitmapLoader|CubeTextureLoader|KTX2Loader|RGBELoader|EXRLoader|createImageBitmap)\b|new\s+Image\s*\(/

describe('vehicles load no images',()=>{
 it('names no image file and uses no image loader in vehicle or effect code',()=>{
  const offenders=files(join(root,'src/vehicles')).filter(f=>/\.(ts|tsx|js|mjs)$/.test(f)).flatMap(f=>{
   const rel=f.slice(root.length)
   return readFileSync(f,'utf8').split('\n').map((line,i)=>({i,line})).filter(({line})=>{
    // Comments may mention the images that were replaced; code may not.
    let code=line.replace(/\/\/.*$/,'').replace(/^\s*\*.*$/,'').replace(/\/\*.*?\*\//g,'')
    if(ALLOWED_FILES.has(rel)){
     // Only the two allowed images, and only a loader that loads one of them (or textureViews).
     for(const name of ALLOWED_IMAGES)code=code.split(`'/models/${name}'`).join("''")
     if(rel==='src/vehicles/skins/textureViews.ts'||/''/.test(code))code=code.replace(new RegExp(LOADER.source,'g'),'')
    }
    return LOADER.test(code)||(IMAGE.test(code)&&/['"`]/.test(code))
   }).map(({i,line})=>`${rel}:${i+1}: ${line.trim().slice(0,120)}`)})
  expect(offenders).toEqual([])
 })
 it('ships no image under the vehicle model folders',()=>{
  const images=files(join(root,'public/models')).filter(f=>IMAGE.test(f)).map(f=>f.slice(root.length))
  expect(images.sort()).toEqual(ALLOWED_IMAGES.map(n=>'public/models/'+n).sort())
 })
})

describe('generated vehicle maps',()=>{
 const pixels=(t:T.DataTexture)=>t.image.data as Uint8Array
 it('builds the tread map with its pixels present, mipmapped, repeating and sRGB',()=>{
  const t=createTreadMap()
  expect(t.image.width*t.image.height*4).toBe((t.image.data as Uint8Array).length)
  expect(t.generateMipmaps).toBe(true);expect(t.minFilter).toBe(T.LinearMipmapLinearFilter)
  expect(t.colorSpace).toBe(T.SRGBColorSpace);expect(t.wrapS).toBe(T.RepeatWrapping);expect(t.wrapT).toBe(T.RepeatWrapping)
  t.dispose()
 })
 it('shares pixel data across calls but gives each caller its own texture to dispose',()=>{
  const a=createTreadMap(),b=createTreadMap()
  expect(a).not.toBe(b);expect(pixels(a)).toBe(pixels(b))
 })
 it('draws one light tread plate per tile across the seam and dark between',()=>{
  const t=createTreadMap(),d=pixels(t),h=t.image.height,w=t.image.width,row=(j:number)=>d[j*w*4]
  expect(row(0)).toBeGreaterThan(90);expect(row(h-1)).toBeGreaterThan(90);expect(row(h/2)).toBeLessThan(30)
 })
})

describe('shader sprites',()=>{
 it('build node graphs for every particle look and the tyre mark',()=>{
  for(const sprite of [dustSprite,glowSprite,plasmaSprite(false),plasmaSprite(true)]){
   const p=new ParticleBatch(4,sprite,true,1);expect(p.mesh.material.colorNode).toBeTruthy();expect(p.mesh.material.opacityNode).toBeTruthy();p.dispose()
  }
  const r=new RibbonBatch(4,tyreMarkAlpha);expect(r.mesh.material.opacityNode).toBeTruthy();r.dispose()
 })
})

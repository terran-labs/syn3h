import {describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {loadTextureViews,type ImageTextureLoader} from '../../src/vehicles/skins/textureViews'

/** What the renderer checks before an upload (three Textures.js): marked, yet nothing to upload. */
const wouldThrow=(t:T.Texture)=>t.version>0&&t.image===null
function fakeLoader(){
 let finish=()=>{}
 const loader:ImageTextureLoader={load(_url,onLoad){const texture=new T.Texture();finish=()=>{texture.image={width:4,height:4} as unknown as HTMLImageElement;texture.needsUpdate=true;onLoad?.(texture)};return texture}}
 return {loader,finish:()=>finish()}
}
describe('texture views of one loading image',()=>{
 it('shows why a clone of a loading texture is unsafe',()=>{
  // The hazard this helper exists for: Texture.copy marks the clone for upload immediately.
  const loading=new T.Texture(),clone=loading.clone()
  expect(wouldThrow(loading)).toBe(false);expect(wouldThrow(clone)).toBe(true)
 })
 it('never marks a view for upload before the image arrives, then shares one source',()=>{
  const {loader,finish}=fakeLoader(),[base,fine,third]=loadTextureViews('scales.jpg',3,loader)
  fine.repeat.set(40,40);fine.wrapS=fine.wrapT=T.RepeatWrapping
  for(const t of [base,fine,third])expect(wouldThrow(t)).toBe(false)
  expect(fine.version).toBe(0)
  finish()
  for(const t of [base,fine,third]){expect(t.version).toBeGreaterThan(0);expect(t.image).not.toBeNull();expect(wouldThrow(t)).toBe(false)}
  // One image, one upload: the views share the loaded source and keep their own settings.
  expect(fine.source).toBe(base.source);expect(third.source).toBe(base.source)
  expect(fine.repeat.x).toBe(40);expect(base.repeat.x).toBe(1)
 })
 it('returns just the loaded texture when one view is asked for',()=>{
  const {loader}=fakeLoader();expect(loadTextureViews('a.png',1,loader).length).toBe(1)
 })
})

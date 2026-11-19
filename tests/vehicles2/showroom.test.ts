import {afterEach,describe,expect,it} from 'vitest'
import * as T from 'three/webgpu'
import {uniform} from 'three/tsl'
import {params} from '../../shared/params'
import {addLavaGlow} from '../../src/vehicles/skins/lavaGlow'
import {createLiquidState} from '../../src/vehicles/lava'
import {vehicleShading} from '../../src/core/quality'
import {LOD_FAR,LOD_NEAR,detailLevel,mergeStatic,mergedSurfaces} from '../../src/vehicles/skins/mergeStatic'
import {TRACK_LUGS,showroomShare,showroomWarm,applyShowroom,paintCanopy,paintFlakes,paintScaleDepth,paintScaleSize,paintSeams,roleOf,setRole,wrapTrackScroll} from '../../src/vehicles/skins/showroom'

const box=()=>new T.BoxGeometry(1,1,1)
const std=(name:string,color=0x336699)=>{const m=new T.MeshStandardMaterial({color});m.name=name;return m}
/**
 * The values a node graph holds as `object` draws: per-object uniforms (shared materials read
 * colours and heat from the mesh being drawn) are updated for it first.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const drawnFor=(node:any,object:T.Object3D):unknown[]=>{const out:unknown[]=[];node?.traverse((n:any)=>{if(n.updateType==='object'&&typeof n.update==='function')n.update({object});if('value' in n)out.push(n.value)});return out}
afterEach(()=>{params.set(vehicleShading.def.id,3);params.set(paintCanopy.def.id,paintCanopy.def.default)})

describe('showroom vehicle shading',()=>{
 it('reads a tag first, then names, then an authored clear coat',()=>{
  expect(roleOf(setRole(std('Whatever'),'tyre'))).toBe('tyre')
  expect(roleOf(std('Cockpit'))).toBe('glass')
  expect(roleOf(std(''),'Body_Chrome')).toBe('chrome')
  expect(roleOf(std('Tail Lights'))).toBe('lamp')
  expect(roleOf(new T.MeshPhysicalMaterial({clearcoat:1}))).toBe('paint')
  expect(roleOf(std('Accent'))).toBe('trim')
  expect(roleOf(std('Mystery'))).toBe('trim')
 })
 it('keeps canopy glass out of the merged body draw and records what was merged',()=>{
  const root=new T.Group(),paint=setRole(std('Body'),'paint'),accent=setRole(std('Accent'),'accent'),glass=setRole(std('Cockpit'),'glass');glass.userData.separate=true
  root.add(new T.Mesh(box(),paint),new T.Mesh(box(),accent),new T.Mesh(box(),glass))
  mergeStatic(root,true)
  const meshes=root.children as T.Mesh[]
  expect(meshes.length).toBe(2)
  const merged=meshes.find(m=>m.name==='Merged static surfaces')!
  expect(mergedSurfaces.get(merged.material as T.Material)).toEqual([paint,accent])
  expect(meshes.find(m=>m!==merged)!.material).toBe(glass)
 })
 it('swaps materials by tier, builds each tier once and decorates each tier once',()=>{
  params.set(paintCanopy.def.id,false)
  params.set(vehicleShading.def.id,0)
  const root=new T.Group(),paint=setRole(std('Body'),'paint'),glass=setRole(std('Cockpit'),'glass')
  const body=new T.Mesh(box(),paint),canopy=new T.Mesh(box(),glass),wing=new T.Mesh(box(),new T.MeshBasicMaterial());root.add(body,canopy,wing)
  const decorated:T.Material[][]=[]
  const dispose=applyShowroom(root,r=>{const seen:T.Material[]=[];r.traverse(o=>{if(o instanceof T.Mesh)seen.push(o.material as T.Material)});decorated.push(seen)})
  // Tier 0 is the vehicle exactly as it was built.
  expect(body.material).toBe(paint);expect(canopy.material).toBe(glass);expect(decorated.length).toBe(1)
  params.set(vehicleShading.def.id,1)
  const lit=body.material as T.Material
  expect(lit).toBeInstanceOf(T.MeshStandardNodeMaterial);expect(lit).not.toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  expect((lit as T.MeshStandardNodeMaterial).normalNode).not.toBeNull()
  // A canopy still tagged `glass` stays opaque until the clear coat tier, as before.
  expect((canopy.material as T.Material).transparent).toBe(false)
  params.set(vehicleShading.def.id,2)
  expect(body.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial);expect((canopy.material as T.Material).transparent).toBe(true)
  params.set(vehicleShading.def.id,3)
  const full=body.material
  expect(full).not.toBe(lit);expect(wing.material).toBeInstanceOf(T.MeshBasicMaterial)
  expect(decorated.length).toBe(4)
  // Returning to a tier reuses what was built and does not decorate it again.
  params.set(vehicleShading.def.id,1);expect(body.material).toBe(lit)
  params.set(vehicleShading.def.id,3);expect(body.material).toBe(full)
  params.set(vehicleShading.def.id,0);expect(body.material).toBe(paint)
  expect(decorated.length).toBe(4)
  dispose()
  // After disposal the parameter no longer drives this vehicle.
  params.set(vehicleShading.def.id,2);expect(body.material).toBe(paint)
 })
 it('keeps paint colour live across tiers through the source colour object',()=>{
  params.set(vehicleShading.def.id,3)
  const root=new T.Group(),paint=setRole(std('Body',0xff0000),'paint'),body=new T.Mesh(box(),paint);root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const built=body.material as unknown as T.MeshPhysicalNodeMaterial
  expect(built).not.toBe(paint)
  // The shader reads the source's Color object as the mesh draws, so setColors on the source repaints every tier.
  expect(drawnFor(built.colorNode,body)).toContain(paint.color)
  dispose()
 })
 it('drops remote vehicles to plain materials at distance, with hysteresis, and never gives them flakes',()=>{
  params.set(vehicleShading.def.id,3)
  const owner=new T.Group(),root=new T.Group();owner.add(root)
  let detail:(distance:number,remote:boolean,level:number)=>void=()=>{}
  owner.userData.registerVehicleDetail=(fn:typeof detail)=>{detail=fn;return()=>{}}
  const paint=setRole(std('Body'),'paint'),body=new T.Mesh(box(),paint);root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const local=body.material
  detail(10,true,2);const near=body.material
  expect(near).not.toBe(local);expect(near).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  detail(31,true,2);expect(body.material).toBe(paint)
  detail(27,true,2);expect(body.material).toBe(paint)
  detail(24,true,2);expect(body.material).toBe(near)
  detail(200,false,2);expect(body.material).toBe(local)
  dispose()
 })
 it('warms a far vehicle\'s close-up materials on proxies, in turn, so arriving only swaps references',()=>{
  params.set(vehicleShading.def.id,3)
  const make=()=>{
   const owner=new T.Group(),root=new T.Group();owner.add(root);scene.add(owner);owner.position.set(40*++made,3,-7)
   // A far vehicle hides its close-up model and shows a distance model: proxies must not hang from it.
   root.visible=false
   let detail:(distance:number,remote:boolean,level:number)=>void=()=>{}
   owner.userData.registerVehicleDetail=(fn:typeof detail)=>{detail=fn;return()=>{}}
   const paint=setRole(std('Body'),'paint'),body=new T.Mesh(box(),paint);root.add(body)
   const wheels=new T.InstancedMesh(box(),setRole(std('Tyres'),'tyre'),4);root.add(wheels)
   let decorated=0
   const dispose=applyShowroom(root,()=>{decorated++})
   const group=()=>scene.children.find(o=>o.name==='Showroom warm'&&o.position.x===owner.position.x)
   const proxies=()=>group()?.children as T.Mesh[]|undefined
   const draw=()=>proxies()?.forEach(p=>(p.onBeforeRender as unknown as ()=>void)())
   return {root,body,wheels,paint,dispose,proxies,group,draw,tick:(d:number,level=2)=>detail(d,true,level),decorations:()=>decorated}
  }
  const scene=new T.Scene();let made=0
  const before={...showroomWarm},a=make(),b=make()
  // Both far. The first to ask takes the turn; the other waits and builds nothing.
  a.tick(80);b.tick(80)
  expect(a.body.material,'still plain while far').toBe(a.paint)
  expect(a.proxies()?.length).toBe(2);expect(b.proxies()).toBeUndefined()
  const [bodyProxy,wheelProxy]=a.proxies()!,near=bodyProxy.material
  expect(near).toBeInstanceOf(T.MeshPhysicalNodeMaterial);expect(bodyProxy.geometry).toBe(a.body.geometry)
  expect(wheelProxy).toBeInstanceOf(T.InstancedMesh);expect(bodyProxy.castShadow).toBe(true);expect(bodyProxy.frustumCulled).toBe(false)
  // In the scene at the vehicle's position, not under the hidden model, and far too small to see.
  expect(a.group()!.parent).toBe(scene);expect(a.group()!.position.toArray()).toEqual([40,3,-7]);expect(a.group()!.scale.x).toBeLessThan(.01)
  expect(a.root.children).toHaveLength(2)
  // Updates without a draw (the world behind the lobby) do not count.
  a.tick(80);a.tick(80);expect(a.proxies()?.length).toBe(2)
  for(let i=0;i<3;i++){a.draw();a.tick(80);b.tick(80)}
  expect(a.proxies(),'proxies gone after three drawn frames').toBeUndefined()
  expect(showroomWarm.warmed-before.warmed).toBe(1)
  // Now the second vehicle has the turn.
  b.tick(80);expect(b.proxies()?.length).toBe(2)
  // Arriving: the mesh takes the very material that was warmed, and nothing new is built or decorated.
  const decorations=a.decorations()
  a.tick(20);expect(a.body.material).toBe(near);expect(a.wheels.material).toBe(wheelProxy.material);expect(a.decorations()).toBe(decorations)
  a.tick(80);a.tick(80);expect(a.proxies(),'no second warm at the same tier and level').toBeUndefined()
  // A graphics level change replaces every pipeline: warm again, reusing the same materials.
  for(let i=0;i<3;i++){b.draw();b.tick(80)}
  a.tick(80,1);expect(a.proxies()?.[0].material).toBe(near)
  // Coming close mid-warm cancels it; a vehicle that is never drawn gives up its turn.
  const cancelledBeforeArrival=showroomWarm.cancelled
  a.tick(10,1);expect(a.proxies()).toBeUndefined();expect(showroomWarm.cancelled-cancelledBeforeArrival).toBe(1)
  b.tick(80,1);for(let i=0;i<200;i++)b.tick(80,1)
  expect(b.proxies()).toBeUndefined();expect(showroomWarm.abandoned-before.abandoned).toBe(1)
  a.dispose();b.dispose()
  expect(showroomWarm.proxies-before.proxies,'no proxy left in a scene').toBe(0)
  expect(scene.children.filter(o=>o.name==='Showroom warm')).toHaveLength(0)
  // A model that is in no scene cannot be drawn, so it does not hold the turn.
  const loose=new T.Group(),lone=new T.Group();loose.add(lone);lone.add(new T.Mesh(box(),setRole(std('Body'),'paint')))
  let tick:(distance:number,remote:boolean,level:number)=>void=()=>{}
  loose.userData.registerVehicleDetail=(fn:typeof tick)=>{tick=fn;return()=>{}}
  const drop=applyShowroom(lone,()=>{});tick(80,true,2);tick(80,true,2)
  expect(showroomWarm.proxies-before.proxies).toBe(0);drop()
 })
 it('gives a new set the sky map as it is built, so first use does not ask for a recompile',()=>{
  params.set(vehicleShading.def.id,2)
  const scene=new T.Scene(),sky=new T.Texture();scene.environment=sky
  const root=new T.Group();scene.add(root)
  const body=new T.Mesh(box(),setRole(std('Body'),'paint'));root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const material=body.material as T.MeshStandardMaterial
  expect(material.envMap).toBe(sky);expect(material.version).toBe(0)
  dispose()
 })
 it('keeps emission a skin added to a merged material, at every tier',()=>{
  params.set(vehicleShading.def.id,0)
  const root=new T.Group();root.add(new T.Mesh(box(),std('Body')),new T.Mesh(box(),std('Chrome')))
  mergeStatic(root,true)
  const mesh=root.children[0] as T.Mesh,merged=mesh.material as T.MeshStandardNodeMaterial
  // As the Syn3h stators do: add a glow to the merged material after merging.
  const glow=uniform(new T.Color(1,0,0)),base=merged.emissiveNode!
  merged.emissiveNode=(base as unknown as {add(n:unknown):typeof base}).add(glow)
  // A decorator that wraps emission in place, as the night and lava passes do.
  const dispose=applyShowroom(root,r=>r.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshStandardNodeMaterial;m.emissiveNode=(m.emissiveNode as unknown as {mul(n:number):typeof base}).mul(1)}}))
  const has=(m:T.MeshStandardNodeMaterial)=>{let found=false;m.emissiveNode!.traverse(n=>{if(n===glow)found=true});return found}
  for(const tier of [1,2,3]){params.set(vehicleShading.def.id,tier);expect(mesh.material).not.toBe(merged);expect(has(mesh.material as T.MeshStandardNodeMaterial)).toBe(true)}
  dispose()
 })
 it('drives scale depth, seams, size and flakes from live sliders without rebuilding materials',()=>{
  params.set(vehicleShading.def.id,3)
  const root=new T.Group(),body=new T.Mesh(box(),setRole(std('Body'),'paint'));root.add(body)
  const dispose=applyShowroom(root,()=>{})
  const built=body.material as unknown as T.MeshPhysicalNodeMaterial
  const values=()=>{const seen=new Set<number>();for(const node of [built.normalNode!,built.colorNode!,built.aoNode!])node.traverse(n=>{const v=(n as unknown as {value?:unknown}).value;if(typeof v==='number')seen.add(v)});return seen}
  for(const [param,value] of [[paintScaleDepth,1.37],[paintSeams,.93],[paintScaleSize,2.61],[paintFlakes,1.83]] as const){
   expect(values().has(value)).toBe(false)
   params.set(param.def.id,value)
   expect(values().has(value)).toBe(true)
   params.set(param.def.id,param.def.default)
  }
  expect(body.material).toBe(built)
  dispose()
 })
 it('gives every vehicle the same canopy, glow and frame from a role tag alone',()=>{
  params.set(vehicleShading.def.id,3)
  const owner=new T.Group(),root=new T.Group();owner.add(root)
  const accent=new T.Color(0x000040);owner.userData.vehicleColors={accent}
  const canopy=new T.Mesh(box(),setRole(std('Whatever'),'canopy')),nozzle=new T.Mesh(box(),setRole(std('Nozzle'),'glow')),arm=new T.Mesh(box(),setRole(std('Arm',0x222222),'frame')),fin=new T.Mesh(box(),setRole(std('Fin'),'paint'))
  ;(fin.material as T.MeshStandardMaterial).flatShading=true
  root.add(canopy,nozzle,arm,fin)
  const dispose=applyShowroom(root,()=>{})
  // Canopy and glow take the owner vehicle's live accent colour, not a colour the vehicle authored.
  const uses=(mesh:T.Mesh,value:unknown)=>drawnFor((mesh.material as T.MeshBasicNodeMaterial).colorNode,mesh).includes(value)
  expect(uses(canopy,accent)).toBe(true);expect(uses(nozzle,accent)).toBe(true)
  expect((nozzle.material as T.Material).blending).toBe(T.AdditiveBlending);expect((nozzle.material as T.Material).depthWrite).toBe(false)
  expect(arm.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  expect((fin.material as T.Material as T.MeshStandardMaterial).flatShading).toBe(true)
  dispose()
 })
 it('picks detail levels at the shared distances, with slack on the way back in',()=>{
  expect(detailLevel(500,false)).toBe(0)
  expect([detailLevel(29,true),detailLevel(31,true),detailLevel(119,true),detailLevel(121,true)]).toEqual([0,1,1,2])
  expect(detailLevel(27,true,1)).toBe(1);expect(detailLevel(24,true,1)).toBe(0)
  expect(detailLevel(117,true,2)).toBe(2);expect(detailLevel(114,true,2)).toBe(1)
  expect([LOD_NEAR,LOD_FAR]).toEqual([30,120])
 })
 it('uses the force field by default, retains the glass toggle and respects the plain tier',()=>{
  params.set(vehicleShading.def.id,2)
  const root=new T.Group(),canopy=new T.Mesh(box(),setRole(std('Cockpit'),'glass'));root.add(canopy)
  const dispose=applyShowroom(root,()=>{})
  const field=canopy.material as T.Material
  expect(field).toBeInstanceOf(T.MeshBasicNodeMaterial);expect(field.side).toBe(T.DoubleSide);expect(field.depthWrite).toBe(false)
  params.set(paintCanopy.def.id,false)
  expect(canopy.material).toBeInstanceOf(T.MeshPhysicalNodeMaterial)
  params.set(paintCanopy.def.id,true)
  expect(canopy.material).toBeInstanceOf(T.MeshBasicNodeMaterial)
  params.set(vehicleShading.def.id,0)
  const plain=canopy.material as unknown as T.MeshBasicMaterial
  expect(plain).toBeInstanceOf(T.MeshBasicMaterial)
  expect(plain.transparent).toBe(true);expect(plain.opacity).toBeLessThan(.1);expect(plain.depthWrite).toBe(false)
  params.set(paintCanopy.def.id,false)
  expect(canopy.material).toBeInstanceOf(T.MeshStandardMaterial)
  params.set(paintCanopy.def.id,true)
  expect(canopy.material).toBe(plain)
  dispose()
 })

 it('guesses tracks from names, ahead of tyres',()=>{
  expect(roleOf(std('Tread'))).toBe('track')
  expect(roleOf(std(''),'Left track')).toBe('track')
  expect(roleOf(std('Rubber belt'))).toBe('track')
  expect(roleOf(std('Rubber'))).toBe('tyre')
  expect(roleOf(setRole(std('Whatever'),'track'))).toBe('track')
 })
 it('shades track lugs from tier 1 up and leaves tier 0 alone',()=>{
  params.set(vehicleShading.def.id,0)
  const root=new T.Group(),rubber=setRole(std('Belt',0x161616),'track'),mesh=new T.Mesh(new T.PlaneGeometry(.6,4),rubber);root.add(mesh)
  const dispose=applyShowroom(root,()=>{})
  expect(mesh.material).toBe(rubber)
  for(const tier of [1,2,3]){
   params.set(vehicleShading.def.id,tier)
   const m=mesh.material as unknown as T.MeshStandardNodeMaterial
   expect(m).not.toBe(rubber);expect(m.normalNode).not.toBeNull()
   expect(m.userData.instancedScroll).toBe(false)
  }
  dispose()
 })
 it('reads the scroll per object, so treads at different speeds share one material',()=>{
  params.set(vehicleShading.def.id,1)
  const root=new T.Group(),rubber=setRole(std('Belt'),'track'),geometry=new T.PlaneGeometry(.6,4)
  const left=new T.Mesh(geometry,rubber),right=new T.Mesh(geometry,rubber);root.add(left,right)
  const dispose=applyShowroom(root,()=>{})
  expect(left.material).toBe(right.material)
  const node=(left.material as T.Material).userData.trackScrollNode as {value:number,update(frame:unknown):void}
  left.userData.trackScroll=1.25;right.userData.trackScroll=-7.3
  node.update({object:left});expect(node.value).toBeCloseTo(wrapTrackScroll(1.25),6)
  node.update({object:right});expect(node.value).toBeCloseTo(wrapTrackScroll(-7.3),6)
  // Wrapped to one lug pitch, which leaves the pattern exactly where it was.
  expect(node.value).toBeGreaterThanOrEqual(0);expect(node.value).toBeLessThan(TRACK_LUGS.pitch)
  expect(wrapTrackScroll(1e6+.05)).toBeCloseTo((1e6+.05)%TRACK_LUGS.pitch,6)
  delete right.userData.trackScroll;node.update({object:right});expect(node.value).toBe(0)
  dispose()
 })
 it('reads the scroll per instance when the geometry carries it or the material asks',()=>{
  params.set(vehicleShading.def.id,1)
  const root=new T.Group(),rubber=setRole(std('Belt'),'track')
  const geometry=new T.PlaneGeometry(.6,4);geometry.setAttribute('trackScroll',new T.InstancedBufferAttribute(new Float32Array(6),1))
  const six=new T.InstancedMesh(geometry,rubber,6),one=new T.Mesh(new T.PlaneGeometry(.6,4),rubber);root.add(six,one)
  const asked=setRole(std('Belt'),'track');asked.userData.instancedScroll=true
  const flagged=new T.InstancedMesh(new T.PlaneGeometry(.6,4),asked,6);root.add(flagged)
  const dispose=applyShowroom(root,()=>{})
  const a=six.material as T.Material,b=one.material as T.Material,c=flagged.material as T.Material
  // The same source gets one material per way of scrolling.
  expect(a).not.toBe(b)
  expect(a.userData.instancedScroll).toBe(true);expect(b.userData.instancedScroll).toBe(false);expect(c.userData.instancedScroll).toBe(true)
  // The instanced path reads the attribute, not a per-object uniform.
  let reads='';(a.userData.trackScrollNode as {traverse(f:(n:{_attributeName?:string})=>void):void}).traverse(n=>{if(n._attributeName)reads=n._attributeName})
  expect(reads).toBe('trackScroll');expect(a.userData.trackScrollNode.isUniformNode).toBeFalsy()
  expect(b.userData.trackScrollNode.isUniformNode).toBe(true)
  dispose()
 })
 // A bot arriving with its own copies of its kind's materials paid for every node build again
 // (31 to 75 ms at High on a fast Mac). Alike vehicles now draw the same materials.
 const vehicle=(paintHex:number,accentHex:number)=>{
  const owner=new T.Group(),root=new T.Group();owner.add(root)
  const accent=new T.Color(accentHex);owner.userData.vehicleColors={accent};owner.userData.vehicleHeat=createLiquidState()
  const paint=setRole(std('Body',paintHex),'paint'),body=new T.Mesh(box(),paint),canopy=new T.Mesh(box(),setRole(std('Cockpit'),'canopy'))
  root.add(body,canopy)
  const dispose=applyShowroom(root,r=>{addLavaGlow(r)})
  return {owner,root,paint,accent,body,canopy,dispose}
 }
 it('shares materials between alike vehicles, each drawing its own paint and accent',()=>{
  params.set(vehicleShading.def.id,2)
  const reused=showroomShare.reused,a=vehicle(0xff0000,0x00ff00),b=vehicle(0x0000ff,0xffff00)
  expect(b.body.material).toBe(a.body.material);expect(b.canopy.material).toBe(a.canopy.material)
  expect(showroomShare.reused).toBeGreaterThan(reused)
  const colour=(mesh:T.Mesh)=>drawnFor((mesh.material as T.MeshStandardNodeMaterial).colorNode,mesh)
  expect(colour(a.body)).toContain(a.paint.color);expect(colour(b.body)).toContain(b.paint.color);expect(colour(b.body)).not.toContain(a.paint.color)
  expect(colour(a.canopy)).toContain(a.accent);expect(colour(b.canopy)).toContain(b.accent)
  // setColors writes the source in place: the next draw shows it.
  b.paint.color.set(0x123456);expect((colour(b.body).find(v=>v===b.paint.color) as T.Color).getHex()).toBe(0x123456)
  a.dispose();b.dispose()
 })
 it('never disposes a shared material while another vehicle draws it, and frees it after the last',()=>{
  params.set(vehicleShading.def.id,2)
  const a=vehicle(0xff0000,0x00ff00),b=vehicle(0x0000ff,0xffff00),shared=b.body.material as T.Material
  let disposed=0;shared.addEventListener('dispose',()=>disposed++)
  // The owner disposes whatever is still attached after the showroom lets go (as every vehicle class does).
  const release=(v:ReturnType<typeof vehicle>)=>{v.dispose();v.root.traverse(o=>{if(o instanceof T.Mesh)(o.material as T.Material).dispose()})}
  const users=showroomShare.users
  release(a)
  expect(showroomShare.users).toBeLessThan(users)
  expect(disposed).toBe(0);expect(b.body.material).toBe(shared)
  expect(a.body.material).not.toBe(shared)
  release(b)
  expect(disposed).toBe(1)
 })
 it('paints a later clone of a vehicle mesh (the lab\'s stress copies) in that vehicle\'s colours',()=>{
  params.set(vehicleShading.def.id,2)
  const a=vehicle(0xff0000,0x00ff00),b=vehicle(0x0000ff,0xffff00),copy=b.root.clone(true),body=copy.children[0] as T.Mesh
  expect(body.material).toBe(a.body.material)
  expect(drawnFor((body.material as T.MeshStandardNodeMaterial).colorNode,body)).toContain(b.paint.color)
  a.dispose();b.dispose()
 })
 it('glows in lava only on the vehicle that is in it, though the material is shared',()=>{
  params.set(vehicleShading.def.id,2)
  const a=vehicle(0xff0000,0x00ff00),b=vehicle(0xff0000,0x00ff00)
  expect(b.body.material).toBe(a.body.material)
  ;(a.owner.userData.vehicleHeat as ReturnType<typeof createLiquidState>).heat=.8
  const emission=(mesh:T.Mesh)=>drawnFor((mesh.material as T.MeshStandardNodeMaterial).emissiveNode,mesh)
  expect(emission(a.body)).toContain(.8);expect(emission(b.body)).not.toContain(.8)
  a.dispose();b.dispose()
 })
 it('keeps a vehicle\'s own authored emission to itself',()=>{
  params.set(vehicleShading.def.id,2)
  const make=()=>{const root=new T.Group(),m=new T.MeshStandardNodeMaterial();m.name='Stator';m.emissiveNode=uniform(new T.Color(1,0,0));const mesh=new T.Mesh(box(),m);root.add(mesh);return {mesh,dispose:applyShowroom(root,()=>{})}}
  const a=make(),b=make()
  expect(b.mesh.material).not.toBe(a.mesh.material)
  a.dispose();b.dispose()
 })
})

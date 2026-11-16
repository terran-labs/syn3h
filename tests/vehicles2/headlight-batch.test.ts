import { describe, it, expect } from 'vitest'
import * as T from 'three/webgpu'
import { HeadlightBatch, HEADLIGHT_CAPACITY, poolVisibility } from '../../src/vehicles/effects/HeadlightBatch'
import { attachVehicleEffects } from '../../src/vehicles/effects'
import { params } from '../../shared/params'
import type { Terrain } from '../../src/world/Terrain'
import type { Game } from '../../src/core/Game'
import type { Vehicle } from '../../src/vehicles/Vehicle'

const color = new T.Color(1, .9, .7), direction = new T.Vector3(0, 0, -1), camera = new T.Vector3(12, 8, 10)
const ground = (heightAt = (_x:number, _z:number) => 0, water = -Infinity) => ({ heightAt, liquidHeightAt: () => water }) as unknown as Terrain
const modes = (b:HeadlightBatch) => Array.from(b.mesh.geometry.getAttribute('hlMode').array).slice(0,b.stats.quads)

describe('shared generated headlights', () => {
  it('caps all vehicles in one fixed allocation, preserves material and draws no scene lights', () => {
    const b = new HeadlightBatch(), material = b.mesh.material, geometry = b.mesh.geometry
    b.begin()
    for (let i=0;i<HEADLIGHT_CAPACITY+4;i++) b.add(new T.Vector3(i, .8, 0), direction, color, 1, camera, ground())
    b.end()
    expect(b.stats.lamps).toBe(HEADLIGHT_CAPACITY)
    expect(b.mesh.geometry.instanceCount).toBeLessThanOrEqual(geometry.getAttribute('hlTint').count)
    expect(b.mesh.material.depthWrite).toBe(false); expect(b.mesh.material.depthTest).toBe(true)
    expect(b.mesh.material.forceSinglePass).toBe(true)
    expect(b.mesh.children).toHaveLength(0)
    b.begin(); b.end()
    expect(b.mesh.material).toBe(material); expect(b.mesh.geometry).toBe(geometry)
    expect(b.mesh.geometry.instanceCount).toBe(1)
    expect(b.mesh.geometry.getAttribute('hlTint').getW(0)).toBe(0)
    b.dispose()
  })

  it('projects every pool corner onto a sloping periodic surface across a wrapping seam', () => {
    const height = (x:number,z:number) => .1*Math.sin(x*Math.PI/8)+.05*Math.cos(z*Math.PI/8)
    const b=new HeadlightBatch()
    b.begin();b.add(new T.Vector3(15.9,.8,0),direction,color,1,camera,ground(height));b.end()
    const pool=modes(b).map((mode,i)=>mode===1?i:-1).filter(i=>i>=0)
    expect(pool.length).toBeGreaterThan(0)
    for(const i of pool)for(let corner=0;corner<4;corner++){
      const a=b.mesh.geometry.getAttribute(`hlCorner${corner}`)
      expect(a.getY(i)).toBeCloseTo(height(a.getX(i),a.getZ(i))+.035,5)
    }
    b.dispose()
  })

  it('keeps an airborne beam but removes its pool, and fades pools over water depth', () => {
    const b=new HeadlightBatch()
    b.begin();b.add(new T.Vector3(0,8,0),direction,color,1,camera,ground());b.end()
    expect(b.stats.quads).toBeGreaterThan(0);expect(modes(b)).not.toContain(1)
    b.begin();b.add(new T.Vector3(0,.8,0),direction,color,1,camera,ground(undefined,1));b.end()
    expect(modes(b)).not.toContain(1)
    expect(poolVisibility(1,0)).toBe(1);expect(poolVisibility(1,.25)).toBe(.5);expect(poolVisibility(6,0)).toBe(0)
    b.dispose()
  })

  it('makes the beam faint from inside instead of a solid cone', () => {
    const b=new HeadlightBatch(),origin=new T.Vector3(0,2,0)
    b.begin();b.add(origin,direction,color,1,camera,ground());b.end()
    const outside=b.mesh.geometry.getAttribute('hlTint').getW(0)
    b.begin();b.add(origin,direction,color,1,new T.Vector3(0,1.8,-5),ground());b.end()
    expect(b.mesh.geometry.getAttribute('hlTint').getW(0)).toBeLessThan(outside*.4)
    b.dispose()
  })

  it('suppresses daylight, Minimal, Zorb and arrival beams without light mutations', () => {
    const scene=new T.Scene(),sky=new T.Object3D() as T.Object3D&{sunDirection:{value:T.Vector3}}
    sky.sunDirection={value:new T.Vector3(0,-1,0)};scene.add(sky)
    const systems:unknown[]=[]
    const game={scene,camera:new T.PerspectiveCamera(),renderer:{toneMappingExposure:1},add:(s:unknown)=>systems.push(s),remove:(s:{dispose():void})=>s.dispose()} as unknown as Game
    const source={count:1,sample:(_i:number,p:T.Vector3,d:T.Vector3,c:T.Color)=>{p.set(0,1,-1);d.copy(direction);c.copy(color);return true}}
    const object=new T.Object3D();scene.add(object);object.userData.headlights=source
    const mutable={object,kind:'buggy',zorbed:false}
    const vehicle=mutable as unknown as Vehicle
    const old=params.get('gfx.quality')!.value
    const detach=attachVehicleEffects(game,ground(),vehicle,{local:false})
    const mesh=scene.getObjectByName('Shared remote headlight beams and pools') as T.Mesh
    const render=()=>{mesh.onBeforeRender(game.renderer,scene,game.camera,mesh.geometry,mesh.material as T.Material,null as never);return scene.userData.remoteHeadlights.lamps}
    try {
      params.set('gfx.quality',1);expect(render()).toBe(1)
      params.set('gfx.quality',0);expect(render()).toBe(0)
      params.set('gfx.quality',3);sky.sunDirection.value.y=1;expect(render()).toBe(0)
      sky.sunDirection.value.y=-1;mutable.zorbed=true;expect(render()).toBe(0);mutable.zorbed=false
      object.userData.materializeVisual=true;expect(render()).toBe(0);delete object.userData.materializeVisual
      object.userData.materializing=true;expect(render()).toBe(0);delete object.userData.materializing
      object.visible=false;expect(render()).toBe(0)
      expect(scene.children.some(o=>o instanceof T.Light)).toBe(false)
    } finally {detach();params.set('gfx.quality',old)}
  })
})

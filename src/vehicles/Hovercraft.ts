import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { RAPIER, unityTorque } from '../core/physics'
import { defineParam, worldLavaAltitude } from '../../shared/params'
import { Vehicle } from './Vehicle'
import { VehicleModel } from './skins/VehicleModel'

// Settings.js slider defaults, documented in docs/architecture/mars-explorer.md.
export const hoverHeight = defineParam({id:'hover.height',label:'Height',group:'Hovercraft',scope:'world',default:15,min:5,max:25,step:.1})
export const hoverForce = defineParam({id:'hover.force',label:'Hover force',group:'Hovercraft',scope:'world',default:100,min:20,max:180,step:1})
export const hoverRepel = defineParam({id:'hover.repel',label:'Repel',group:'Hovercraft',scope:'world',default:2.5,min:.5,max:4.5,step:.1})
export const hoverThrust = defineParam({id:'hover.thrust',label:'Thrust',group:'Hovercraft',scope:'world',default:220,min:20,max:420,step:1})

/** Hovercraft.js 12-61, with world-down probing and Unity's explicit damping rule. */
export class Hovercraft extends Vehicle {
  readonly kind = 'hovercraft' as const
  readonly camOffset = 2
  readonly ridePosition = new THREE.Object3D()
  private paint?: THREE.MeshPhysicalMaterial
  private accent?: THREE.MeshStandardMaterial
  private glowMaterial?: THREE.MeshBasicMaterial
  private readonly model: VehicleModel
  get modelReady(): Promise<void> {return this.model.ready}
  private readonly textures: THREE.Texture[] = []
  private readonly visualMaterials: THREE.Material[] = []
  private lastDistance = 0
  private targetHeight = 0
  private readonly material = new THREE.MeshStandardMaterial({color:0xd2a142,roughness:.45,metalness:.35})
  private readonly geometry = new THREE.CylinderGeometry(1.5,1.8,.6,8)

  constructor(game: Game, terrain: Terrain, position: THREE.Vector3, heading = 0) {
    super(game,terrain,position,heading)
    // Hovercraft.prefab RideCamera local transform.
    this.ridePosition.position.set(.000051,.56284,-.497794);this.object.add(this.ridePosition)
    this.game.world.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,1.5).setTranslation(0,.4,0).setDensity(0).setCollisionGroups(Vehicle.chassisGroups()),this.body)
    // Hovercraft.js 14-18 explicitly overrides collider-derived inertia.
    this.body.setAdditionalMassProperties(50,{x:0,y:-.3,z:0},{x:15,y:15,z:15},{x:0,y:0,z:0,w:1},true)
    this.body.recomputeMassPropertiesFromColliders()
    const hull = new THREE.Mesh(this.geometry,this.material)
    hull.scale.z = 1.35; hull.castShadow = hull.receiveShadow = true
    this.object.add(hull)
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(.8,.4,1.2),new THREE.MeshStandardMaterial({color:0x203745,metalness:.5,roughness:.2}))
    cockpit.position.set(0,.4,-.3); cockpit.castShadow = true; this.object.add(cockpit)
    const modelRoot=new THREE.Group();modelRoot.add(hull,cockpit);this.object.add(modelRoot)
    this.model = new VehicleModel(modelRoot,'/models/hovercraft.glb',scene=>{
      // Syn3h Hovercraft.prefab LOD0: chrome spoilers, purple cockpit and textured paint.
      const paint=new THREE.MeshPhysicalMaterial({color:0x315d99,metalness:.85,roughness:.2,clearcoat:1,clearcoatRoughness:.15})
      const chrome=new THREE.MeshPhysicalMaterial({color:0xcccccc,metalness:1,roughness:.178})
      const glass=new THREE.MeshPhysicalMaterial({color:0x892ba7,metalness:.35,roughness:.12,clearcoat:1,iridescence:.3})
      const accent=new THREE.MeshStandardMaterial({color:0x515151,metalness:0,roughness:.48})
      this.paint=paint;this.accent=accent
      this.visualMaterials.push(paint,chrome,glass,accent)
      const texture=new THREE.TextureLoader().load('/models/textures/armor-scales.jpg')
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(15,15)
      paint.bumpMap=texture;paint.bumpScale=.008;this.textures.push(texture)
      scene.traverse(o=>{if(o instanceof THREE.Mesh){
        (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())
        o.material=o.name==='Cockpit'?glass:/Chrome|Spoilers/.test(o.name)?chrome:o.name==='Accent'?accent:paint
      }})
      // Prefab rear glow at (0,.692654,-1.218035), reflected into our frame.
      const glowMap=new THREE.TextureLoader().load('/models/textures/thruster-glow.png');this.textures.push(glowMap)
      const glowMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(3,2,4),map:glowMap,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide})
      this.glowMaterial=glowMaterial;this.applyColors()
      this.visualMaterials.push(glowMaterial)
      const glow=new THREE.Mesh(new THREE.PlaneGeometry(.5,.5),glowMaterial)
      glow.position.set(0,.692654,1.218035);scene.add(glow)
    })
  }

  protected applyForces(dt: number): void {
    if (this.body.isKinematic()) return
    const q = new THREE.Quaternion().copy(this.body.rotation()), inv = q.clone().invert()
    const velocity = new THREE.Vector3().copy(this.body.linvel()), speed = velocity.length()
    const local = velocity.clone().applyQuaternion(inv)
    const up = new THREE.Vector3(0,1,0).applyQuaternion(q)
    let drag = 0, angularDrag = 4
    if (!this.input.brakes) this.body.addForce(new THREE.Vector3(-local.x*10,0,-Math.max(0,this.input.y)*hoverThrust.value).applyQuaternion(q),true)
    else {drag = speed > 5 ? 1.5 : 100; angularDrag = 20}
    const position = this.body.translation()
    const cast = (direction: THREE.Vector3, distance: number) => this.game.world.castRayAndGetNormal(new RAPIER.Ray(position,direction),distance,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,this.body)
    const hit = cast(new THREE.Vector3(0,-1,0),30)
    let distance = hit?.timeOfImpact ?? Infinity
    let normal = hit ? new THREE.Vector3().copy(hit.normal) : new THREE.Vector3(0,1,0)
    // Hovercraft.js 34-38 treats the nearest liquid plane as supporting terrain.
    const liquidDistance = Math.max(0,position.y-worldLavaAltitude.value)
    if (liquidDistance < 30 && liquidDistance < distance) {distance = liquidDistance; normal.set(0,1,0)}
    if (distance <= 30) {
      // Hovercraft.js 40-43: duck toward five metres under an overhang.
      if (cast(new THREE.Vector3(0,1,0),5)) this.targetHeight = Math.max(5,this.targetHeight-dt*3)
      else this.targetHeight = Math.min(hoverHeight.value,this.targetHeight+dt*3)
      if (distance < this.targetHeight) {
        this.body.addForce(up.clone().multiplyScalar((this.targetHeight-distance)*hoverForce.value),true)
        if (this.lastDistance > distance) this.body.applyImpulse(normal.clone().multiplyScalar(Math.min((this.lastDistance-distance)*hoverRepel.value,10)*this.body.mass()),true)
      }
      const angle = up.angleTo(normal)*180/Math.PI
      this.body.addTorque(up.clone().cross(normal).multiplyScalar(angle*.2*(40-Math.min(40,distance))),true)
      this.lastDistance = distance
    } else angularDrag = .5
    const roll = new THREE.Euler().setFromQuaternion(q,'YXZ').z*180/Math.PI
    const bank = this.input.x > 0 ? (roll < 40 ? this.input.x : 0) : (roll > -40 ? this.input.x : 0)
    this.body.addTorque(new THREE.Vector3().copy(unityTorque(this.input.y*30,this.input.x*100,-bank*200)).applyQuaternion(q),true)
    // Unity drag clamps to zero at large drag*dt; Rapier's damping cannot reproduce that.
    this.body.setLinvel(new THREE.Vector3().copy(this.body.linvel()).multiplyScalar(Math.max(0,1-drag*dt)),true)
    this.body.setAngvel(new THREE.Vector3().copy(this.body.angvel()).multiplyScalar(Math.max(0,1-angularDrag*dt)),true)
  }

  protected override applyColors():void {
    this.paint?.color.set(this.colors.body);this.accent?.color.set(this.colors.accent)
    this.glowMaterial?.color.set(this.colors.accent).multiplyScalar(3)
  }
  override teleport(position: THREE.Vector3, heading = 0): void {
    super.teleport(position,heading); this.lastDistance = 0; this.targetHeight = 0
  }
  override dispose(): void {
    this.model.dispose();this.textures.forEach(t=>t.dispose());this.visualMaterials.forEach(m=>m.dispose())
    super.dispose()
  }
}

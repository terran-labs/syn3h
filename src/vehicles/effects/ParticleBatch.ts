import {hotExposureNode} from '../skins/hotExposure'
import * as T from 'three/webgpu'
import {attribute,float,instanceIndex,smoothstep,uniform,uv,vec2} from 'three/tsl'
import {particleSeed,unlitShadeNode,type Sprite} from './sprites'

const batches = new WeakMap<T.Object3D, ParticleBatch>()

function particleBuffers(capacity: number) {
  const plane = new T.PlaneGeometry(1, 1)
  const geometry = new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry)
  plane.dispose()
  geometry.instanceCount = capacity
  const make = (name: string, size: number) => {
    const buffer = new T.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(T.DynamicDrawUsage)
    geometry.setAttribute(name, buffer)
    return buffer
  }
  const origin = make('fxOrigin', 3)
  const velocity = make('fxVelocity', 3)
  const settings = make('fxSettings', 4)
  const tint = make('fxTint', 3)
  for (let i = 0; i < capacity; i++) settings.setXYZW(i, -10000, 1, 0, 0)
  return { geometry, origin, velocity, settings, tint }
}

/**
 * Birth records upload only on emission. Motion, fading and the sprite itself run in the
 * billboard shader: `sprite` generates the look (see sprites.ts), so no image is loaded.
 * Noise detail belongs to the material. Capacity and birth records belong to the batch buffers.
 */
export class ParticleBatch {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.SpriteNodeMaterial>
  readonly clock=uniform(0)
  /** Multiplies every particle's opacity, for an owner that fades a whole batch (fireworks smoke by daylight). */
  readonly opacity=uniform(1)
  private octaves = 0
  private readonly selectLook: (octaves: number) => void
  private next=0
  private buffers: ReturnType<typeof particleBuffers>
  private disposed = false
  get capacity(): number { return this.buffers.settings.count }
  emitted=0
  /**
   * Share of the wind a particle is born with: dust takes most of it, exhaust less, sparks
   * none. The wind is sampled once, at the birth position, and added to the birth velocity,
   * so it costs one call per particle and nothing per frame; a particle keeps the wind it was
   * born into for its second or two of life and does not follow a later gust.
   */
  windShare=0
  /** Wind velocity in m/s at a world position (the weather system's `windDrift`). Set by the owner. */
  drift:((x:number,y:number,z:number,out:{x:number;y:number;z:number})=>unknown)|null=null
  private readonly gust={x:0,y:0,z:0}
  constructor(capacity:number,sprite:Sprite,additive=false,octaves=2){
    this.buffers = particleBuffers(capacity)
    const cfg=attribute('fxSettings','vec4'),age=this.clock.sub(cfg.x),unit=age.div(cfg.y).clamp(0,1)
    const m=new T.SpriteNodeMaterial({transparent:true,depthWrite:false,blending:additive?T.AdditiveBlending:T.NormalBlending})
    m.positionNode=attribute('fxOrigin','vec3').add(attribute('fxVelocity','vec3').mul(age.max(0)))
    // Nothing once its life is over (or before it starts): a zero-size quad is never rasterised.
    // The size grew with age without end, so every dead slot was still drawn, transparent and
    // ever larger, for as long as the batch lived.
    const size=cfg.z.add(cfg.w.mul(age.max(0))).max(0).mul(age.greaterThanEqual(0).and(age.lessThan(cfg.y)).select(1,0))
    m.scaleNode=vec2(size,size)
    // Keep both original graphs: the shader compiler sees a literal noise octave count at each level.
    const looks = new Map<number, Pick<T.SpriteNodeMaterial, 'colorNode' | 'opacityNode'>>()
    this.selectLook = count => {
      if (this.octaves === count) return
      let nodes = looks.get(count)
      if (!nodes) {
        const look=sprite(uv().mul(2).sub(1),particleSeed(cfg.x,float(instanceIndex)),age.max(0),count)
        const colorNode=attribute('fxTint','vec3').mul(look.rgb).mul(additive?hotExposureNode():unlitShadeNode())
        const opacityNode=look.alpha.mul(this.opacity).mul(unit.mul(Math.PI).sin().max(0).mul(age.greaterThanEqual(0).select(1,0)).mul(age.lessThan(cfg.y).select(1,0)).mul(additive?.8:.4).mul(float(1).sub(smoothstep(.42,.5,uv().sub(.5).length()))))
        nodes = { colorNode, opacityNode }
        looks.set(count, nodes)
      }
      m.colorNode = nodes.colorNode
      m.opacityNode = nodes.opacityNode
      m.needsUpdate = true
      this.octaves = count
    }
    this.selectLook(octaves)
    this.mesh=new T.Mesh(this.buffers.geometry,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=additive?4:3
    batches.set(this.mesh, this)
  }

  static drawCoveredMinimal(scene: T.Scene, draw: () => void): void {
    const changed = new Map<ParticleBatch, number>()
    try {
      scene.traverse(object => {
        const batch = batches.get(object)
        if (batch && batch.octaves !== 1) {
          changed.set(batch, batch.octaves)
          batch.selectLook(1)
        }
      })
      draw()
    } finally {
      for (const [batch, count] of changed) batch.selectLook(count)
    }
  }
  /** Reset the emission ring for a new budget, keeping the draw object and its shader. */
  resetCapacity(capacity: number, octaves = this.octaves): void {
    this.selectLook(octaves)
    const previous = this.buffers.geometry
    this.buffers = particleBuffers(capacity)
    this.mesh.geometry = this.buffers.geometry
    this.next = 0
    this.emitted = 0
    previous.dispose()
  }
  /** `delay`: born that many seconds from now (nothing drawn until then). */
  emit(position:T.Vector3,velocity:T.Vector3,life:number,size:number,grow:number,color:T.Color,delay=0){
    const i=this.next;this.next=(i+1)%this.capacity;this.emitted++
    let vx=velocity.x,vz=velocity.z
    if(this.windShare>0&&this.drift){const g=this.gust;g.x=g.y=g.z=0;this.drift(position.x,position.y,position.z,g);if(Number.isFinite(g.x)&&Number.isFinite(g.z)){vx+=g.x*this.windShare;vz+=g.z*this.windShare}}
    const { origin, velocity: motion, settings, tint } = this.buffers
    origin.setXYZ(i,position.x,position.y,position.z);motion.setXYZ(i,vx,velocity.y,vz)
    settings.setXYZW(i,this.clock.value+delay,life,size,grow);tint.setXYZ(i,color.r,color.g,color.b)
    // Spelled out: a tuple list here allocated five arrays for every particle born.
    origin.addUpdateRange(i*3,3);origin.needsUpdate=true;motion.addUpdateRange(i*3,3);motion.needsUpdate=true
    settings.addUpdateRange(i*4,4);settings.needsUpdate=true;tint.addUpdateRange(i*3,3);tint.needsUpdate=true
  }
  /**
   * Move every stored birth position by (dx, dz), for a world seam: the world is redrawn one
   * tile over around the player, and particles already in the air must come too. The origins
   * are rewritten in place and the whole buffer uploads once; only the origin moves, since
   * velocities and timings do not depend on where the tile is. This was chosen over a single
   * offset uniform because a uniform would cost a vertex add on every frame forever and every
   * later emit would have to subtract the running offset; a shift is a rare event.
   */
  shift(dx:number,dz:number){
    const { origin } = this.buffers
    const a=origin.array as Float32Array
    for(let i=0;i<a.length;i+=3){a[i]+=dx;a[i+2]+=dz}
    // One range over the whole buffer. Emits later this frame add their own small ranges, which
    // overlap it harmlessly; replacing it would upload only those and lose the shift.
    origin.clearUpdateRanges();origin.addUpdateRange(0,a.length);origin.needsUpdate=true
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    batches.delete(this.mesh)
    this.mesh.removeFromParent()
    this.mesh.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

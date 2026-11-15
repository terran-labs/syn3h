import * as T from 'three/webgpu'
import { attribute, cameraPosition, cross, dot, float, mix, mx_fractal_noise_float, normalize, positionWorld, renderGroup, select, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import { defineParam, params } from '../../../shared/params'
import { paletteFor } from '../terrain/palettes'
import { graphicsLevel } from '../../core/quality'
import { hotExposureDim } from '../../vehicles/skins/hotExposure'
import { vehicleNightAmount } from '../../vehicles/skins/nightReadability'
import { applyCurve } from '../curve'
import type { Ripples } from './ripples'
import { SpraySim, sprayCapacity, type SprayWater } from './spraySim'
export const waterSpray=defineParam<boolean>({id:'water.spray',label:'Spray and wakes',group:'Water',scope:'client',default:true})
export const waterSprayScale=defineParam({id:'water.sprayScale',label:'Spray size',group:'Water',scope:'client',default:1,min:.25,max:3,step:.05})

// TSL nodes are dynamically typed; sprites.ts uses the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * How much light falls on white water: the sun's hue, dimmed by the shared night ramp. Spray
 * is unlit geometry, so without this it would glow at night. One render-group uniform.
 */
function sprayLight(): N {
  let sun: T.DirectionalLight | null = null, search = 0
  const colour = new T.Color()
  return uniform(new T.Color(1, 1, 1)).setGroup(renderGroup).onRenderUpdate(frame => {
    const scene = frame.scene as T.Scene
    if ((!sun || sun.parent === null) && search-- <= 0) { sun = null; search = 120; scene.traverse(o => { if (!sun && (o as T.DirectionalLight).isDirectionalLight) sun = o as T.DirectionalLight }) }
    // The night sky raises exposure; undo that like the lava does, or white foam glows.
    const night = vehicleNightAmount(scene), hasSky = scene.children.some(o => 'sunDirection' in o)
    const level = (1 - .72 * night) * (hasSky ? hotExposureDim(frame.renderer?.toneMappingExposure ?? 1) : 1)
    colour.setRGB(1, 1, 1)
    if (sun) {
      const c = (sun as T.DirectionalLight).color, peak = Math.max(c.r, c.g, c.b, 1e-3)
      colour.setRGB(.5 + .5 * c.r / peak, .5 + .5 * c.g / peak, .5 + .5 * c.b / peak)
    }
    return colour.multiplyScalar(level)
  })
}

/**
 * The planet's shallow-water colour, linear, so spray carries the sea's own tint: blue-green on
 * the alpine world, violet on the ice moon. Read from the terrain look each render.
 */
function waterTint(): N {
  const colour = new T.Color()
  let look = -1
  return uniform(new T.Color(.2, .6, .7)).setGroup(renderGroup).onRenderUpdate(() => {
    const now = Number(params.get('terrain.look')?.value ?? 0)
    if (now !== look) { look = now; colour.set(paletteFor(now).seaShallow) }
    return colour
  })
}

/** Instanced quad with dynamic vec4 attributes; capacity fixed, count set each frame. */
function batch(capacity: number, names: string[]) {
  const plane = new T.PlaneGeometry(1, 1), g = new T.InstancedBufferGeometry().copy(plane as unknown as T.InstancedBufferGeometry); plane.dispose()
  const attributes = names.map(name => { const a = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage); g.setAttribute(name, a); return a })
  g.instanceCount = 0
  return { g, attributes }
}

/**
 * Droplets and mist. Each droplet is a quad in world space, its long axis along the velocity
 * as seen from the camera (so a fast drop reads as a short streak) and its short axis facing
 * the camera. Mist uses the same quad unstretched, larger and much softer.
 */
function dropletMaterial(light: N, tint: N) {
  const a = attribute('sprayA', 'vec4'), b = attribute('sprayB', 'vec4')
  const centre = a.xyz, size = a.w, velocity = b.xyz, mist = b.w.greaterThan(1.5)
  const toCamera = cameraPosition.sub(centre), distance = toCamera.length(), view = toCamera.div(distance.max(1e-4))
  // Never thinner than about a pixel and a half at 720p; a widened drop is fainter in proportion,
  // so distant spray adds up to a haze instead of vanishing or turning into chalk.
  const radius = size.max(distance.mul(.0016)), cover = size.div(radius)
  const across = velocity.sub(view.mul(dot(velocity, view)))
  const speed = across.length()
  // Motion blur of about a sixtieth of a second, plus the drop itself.
  const axis = select(speed.greaterThan(.05), across.div(speed.max(1e-4)), normalize(cross(view, vec3(1, 0, 0)).add(vec3(0, 1e-4, 0))))
  const side = normalize(cross(axis, view))
  const half = select(mist, radius, radius.add(speed.mul(.016)))
  const q = uv().mul(2).sub(1)
  const m = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide })
  m.positionNode = centre.add(side.mul(q.x.mul(radius))).add(axis.mul(q.y.mul(half)))
  const r = q.length()
  // A bead: bright rim catching the light and a slightly clearer middle reads as water, not chalk.
  // A drop is mostly transparent water tinted like the sea, with a bright rim and a small
  // highlight. The tinted body reads against a pale sky, the bright rim against dark water.
  const body = float(1).sub(smoothstep(.6, 1, r))
  const rim = smoothstep(.35, .75, r).mul(float(1).sub(smoothstep(.75, 1, r)))
  const glint = float(1).sub(smoothstep(0, .3, q.sub(vec2(-.25, .35)).length()))
  const bead = body.mul(.45).add(rim.mul(.5)).add(glint.mul(.5)).min(1)
  const n = mx_fractal_noise_float(vec3(q.mul(1.7).add(centre.xz.mul(.37)), 0), 2, 2, .5).mul(.5).add(.5)
  const puff = float(1).sub(smoothstep(.15, 1, r.add(n.mul(.35)))).mul(n.mul(.6).add(.4))
  // Drops passing right by the lens would fill the screen with blobs: fade them out up close.
  const near = smoothstep(1.5, 6, distance)
  const alpha = select(mist, b.w.sub(2), b.w).mul(near)
  m.opacityNode = select(mist, puff.mul(alpha).mul(.7), bead.mul(alpha).mul(cover.mul(.75).add(.25)).mul(.55))
  const water = mix(tint, vec3(1, 1, 1), .35)
  const drop = mix(water, vec3(1.15, 1.18, 1.2), rim.max(glint).mul(.85))
  m.colorNode = select(mist, mix(tint, vec3(1, 1, 1), .6), drop).mul(light).mul(1.2)
  return m
}

/**
 * Foam lying on the water: wake strips and splash rings. A strip quad runs from one wake
 * point to the next, each end with its own side vector, half width and fade, so consecutive
 * quads share their edges exactly. A ring has zero side vectors and draws an annulus.
 * Foam texture is world-anchored noise that breaks into lace as the foam ages.
 */
function foamMaterial(light: N) {
  const A = attribute('foamA', 'vec4'), B = attribute('foamB', 'vec4'), S = attribute('foamSide', 'vec4'), L = attribute('foamLook', 'vec4')
  // Side vectors: zero for a ring, length two for the centre wash, unit for an arm crest.
  const ring = S.xy.length().lessThan(.5), wash = S.xy.length().greaterThan(1.5)
  const q = uv().mul(2).sub(1), t = uv().y
  const sides = normalize(mix(S.xy, S.zw, t).add(1e-5))
  const strip = mix(A.xyz, B.xyz, t).add(vec3(sides.x, 0, sides.y).mul(mix(A.w, B.w, t).mul(q.x)))
  const disc = A.xyz.add(vec3(q.x, 0, q.y).mul(A.w))
  const m = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide })
  m.positionNode = select(ring, disc, strip)
  const fade = select(ring, L.x, mix(L.x, L.y, t)), age = select(ring, L.w, mix(L.z, L.w, t))
  const coarse = mx_fractal_noise_float(vec3(positionWorld.xz.mul(.55), 0), 2, 2, .5).mul(.5).add(.5)
  const fine = mx_fractal_noise_float(vec3(positionWorld.xz.mul(2.6), 3.7), 2, 2, .55).mul(.5).add(.5)
  const texture: N = coarse.mul(.55).add(fine.mul(.55))
  // Feathered edges across the strip; a soft band for the ring. The wash has a ragged edge.
  const ragged = float(1).sub(smoothstep(.3, 1, q.x.abs().add(coarse.sub(.5).mul(.7))))
  const crest = float(1).sub(smoothstep(.2, 1, q.x.abs()))
  const shape = select(ring, float(1).sub(smoothstep(0, .2, q.length().sub(.78).abs())), select(wash, ragged, crest))
  // The wash is solid and brightest right at the stern, then breaks into lace.
  const lead = select(wash, float(1).sub(smoothstep(0, .15, age)), float(0))
  // Young foam is a near-solid blanket; old foam keeps only its brightest lace.
  const threshold = age.mul(select(wash, .62, .5)).add(.24).sub(lead.mul(.3))
  const foam = smoothstep(threshold, threshold.add(.22), texture.mul(shape.mul(.5).add(.6)))
  m.opacityNode = foam.mul(shape).mul(fade).mul(.8)
  m.colorNode = vec3(.86, .93, .98).mul(light).mul(fine.mul(.2).add(1.05).add(lead.mul(.2)))
  return m
}

/** Call update once, then vehicle for each wet or recently wet vehicle each frame. */
export class Spray {
  private sim: SpraySim | null = null
  private drops: { mesh: T.Mesh<T.InstancedBufferGeometry, T.MeshBasicNodeMaterial>; a: Float32Array; b: Float32Array; attributes: T.InstancedBufferAttribute[] } | null = null
  private foam: { mesh: T.Mesh<T.InstancedBufferGeometry, T.MeshBasicNodeMaterial>; arrays: Float32Array[]; attributes: T.InstancedBufferAttribute[] } | null = null
  private tier = -1
  private packed = -1
  /** `water` gives the true moving surface (Terrain.liquidHeightAt) for wakes and landings. */
  constructor(private scene: T.Scene, private ripples: Ripples, private water: SprayWater | null = null) {}
  setWater(water: SprayWater | null) { this.water = water; this.sim?.setWater(water) }
  /** Live simulation, for tests and evidence tools. */
  get state() { return this.sim }
  private allocate(tier: number) {
    this.release()
    const cap = sprayCapacity(tier)
    this.sim = new SpraySim(cap, this.water); this.tier = tier; this.packed = -1
    const light = sprayLight()
    const d = batch(cap.droplets, ['sprayA', 'sprayB'])
    const dropMesh = new T.Mesh(d.g, dropletMaterial(light, waterTint()))
    const segments = cap.vehicles * 3 * cap.points + cap.rings
    const f = batch(segments, ['foamA', 'foamB', 'foamSide', 'foamLook'])
    const foamMesh = new T.Mesh(f.g, foamMaterial(light))
    dropMesh.name = 'water-spray'; foamMesh.name = 'water-foam'
    // After the water (transparent, no depth write) so foam lies on it; droplets after foam.
    foamMesh.renderOrder = 2; dropMesh.renderOrder = 3
    for (const mesh of [dropMesh, foamMesh]) {
      mesh.frustumCulled = false; applyCurve(mesh.material); this.scene.add(mesh)
      // Pack at most once per change, after this frame's emissions, just before the draw.
      mesh.onBeforeRender = () => this.pack()
    }
    this.drops = { mesh: dropMesh, a: d.attributes[0].array as Float32Array, b: d.attributes[1].array as Float32Array, attributes: d.attributes }
    this.foam = { mesh: foamMesh, arrays: f.attributes.map(x => x.array as Float32Array), attributes: f.attributes }
  }
  private pack() {
    const sim = this.sim, drops = this.drops, foam = this.foam
    if (!sim || !drops || !foam || this.packed === sim.version) return
    this.packed = sim.version
    const n = sim.packDroplets(drops.a, drops.b)
    drops.mesh.geometry.instanceCount = n
    for (const a of drops.attributes) { a.clearUpdateRanges(); if (n) { a.addUpdateRange(0, n * 4); a.needsUpdate = true } }
    const [A, B, S, L] = foam.arrays
    const m = sim.packSurface(A, B, S, L)
    foam.mesh.geometry.instanceCount = m
    for (const a of foam.attributes) { a.clearUpdateRanges(); if (m) { a.addUpdateRange(0, m * 4); a.needsUpdate = true } }
  }
  update(dt: number) {
    if (!waterSpray.value) { this.dispose(); return }
    // Allocated up front, not on first contact, and drawn with no instances while idle so the
    // pipelines exist before any vehicle reaches the water.
    const tier = Math.max(0, Math.min(2, Math.round(graphicsLevel.value)))
    if (tier !== this.tier) this.allocate(tier)
    this.sim!.step(dt)
  }
  vehicle(id: string, position: T.Vector3, velocity: T.Vector3, submergedFraction: number, dt: number) {
    if (!waterSpray.value) return
    if (!this.sim) this.allocate(Math.max(0, Math.min(2, Math.round(graphicsLevel.value))))
    const entering = this.sim!.vehicle(id, position.x, position.y, position.z, velocity.x, velocity.y, velocity.z, submergedFraction, dt, waterSprayScale.value)
    const sub = Math.max(0, Math.min(1, submergedFraction)), speed = Math.hypot(velocity.x, velocity.z)
    if (sub > 0 && speed > 1) this.ripples.disturb(position.x, position.z, 1.5, Math.min(.15, speed * .004) * Math.min(.1, Math.max(0, dt)) * 60)
    if (entering) this.ripples.disturb(position.x, position.z, 2, Math.min(.5, Math.abs(velocity.y) * .05 + .1))
  }
  /** The world moved by a whole tile under the player: move what spray has left behind with it. */
  shift(dx: number, dz: number) { this.sim?.shift(dx, dz) }
  private release() {
    for (const mesh of [this.drops?.mesh, this.foam?.mesh]) if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose() }
    this.drops = this.foam = null; this.sim = null; this.tier = -1
  }
  dispose() { this.release() }
}

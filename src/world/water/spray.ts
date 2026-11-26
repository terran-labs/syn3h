import * as T from 'three/webgpu'
import { attribute, cameraPosition, cross, dot, float, mix, mx_fractal_noise_float, normalize, positionWorld, renderGroup, select, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import { defineParam, params } from '../../../shared/params'
import { paletteFor } from '../terrain/palettes'
import { graphicsLevel } from '../../core/quality'
import { applyCurve } from '../curve'
import type { Ripples } from './ripples'
import { SpraySim, sprayCapacity, type SprayWater, type WakeShape } from './spraySim'
export const waterSpray=defineParam<boolean>({id:'water.spray',label:'Spray and wakes',group:'Water',scope:'client',default:true})
export const waterSprayScale=defineParam({id:'water.sprayScale',label:'Spray size',group:'Water',scope:'client',default:1,min:.25,max:3,step:.05})
/** How strongly soft wakes and skip rings show: 0 none, 1 as tuned, 2 twice as dense. */
export const waterWakeStrength=defineParam({id:'water.wakeStrength',label:'Wake strength',group:'Water',scope:'client',default:1,min:0,max:2,step:.05})
/** Width of soft wakes and skip rings, as a multiple of what touches the water. */
/** A broad, low swell of disturbed water beside a hull. Off: beside-hull wakes read as drawn lines. */
export const waterBowSwell=defineParam<boolean>({id:'water.bowSwell',label:'Bow swell beside hulls',group:'Water',scope:'client',default:false})
export const waterWakeWidth=defineParam({id:'water.wakeWidth',label:'Wake width',group:'Water',scope:'client',default:1,min:.3,max:3,step:.05})
/**
 * The moving hull's trail in the ripple field (ripples.ts): how hard it disturbs the field, 1 being
 * the wake before 25 November 2026 (0.004 per m/s, at most 0.15, a frame), and how wide, metres.
 * Visual only: the field bends the sea's shading normals and never moves its mesh or physics.
 */
/** The foam trail behind a moving craft (spraySim.ts foamWidth, foamLife): width and how long it lasts, as multiples of the trail before 25 November 2026. Rings are water.wakeWidth's. */
export const waterWakeFoamWidth=defineParam({id:'water.wakeFoamWidth',label:'Wake foam width',group:'Water',scope:'client',default:2,min:.5,max:4,step:.05})
export const waterWakeFoamLife=defineParam({id:'water.wakeFoamLife',label:'Wake foam persistence',group:'Water',scope:'client',default:2,min:.5,max:4,step:.05})
export const waterWakeRipple=defineParam({id:'water.wakeRipple',label:'Wake ripple strength',group:'Water',scope:'client',default:2.5,min:0,max:4,step:.05})
export const waterWakeRippleWidth=defineParam({id:'water.wakeRippleWidth',label:'Wake ripple width',group:'Water',scope:'client',default:2.5,min:.5,max:6,step:.1})

// TSL nodes are dynamically typed; sprites.ts uses the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The light white water sends back: what a white diffuse surface would, lit by the scene's own
 * sun (or moon) and sky. Spray is unlit geometry, so it is given the scene's actual radiance
 * rather than a fixed white: in daylight it is as bright as sunlit sand, the brightest thing
 * about, never a grey smudge against a pale sky; at night it takes the moon and sky as the
 * ground does. Light colours carry their intensity (Environment.ts sets intensity 1, and the
 * hemisphere colour already includes pi), so a Lambert surface at about 40 degrees to the sun
 * returns sun * 0.75 / pi plus most of the sky and a little of the ground. One render-group
 * uniform.
 */
function sprayLight(): N {
  let sun: T.DirectionalLight | null = null, hemi: T.HemisphereLight | null = null, search = 0
  const colour = new T.Color()
  return uniform(new T.Color(1, 1, 1)).setGroup(renderGroup).onRenderUpdate(frame => {
    const scene = frame.scene as T.Scene
    if ((!sun || sun.parent === null || !hemi || hemi.parent === null) && search-- <= 0) {
      sun = null; hemi = null; search = 120
      scene.traverse(o => {
        if (!sun && (o as T.DirectionalLight).isDirectionalLight) sun = o as T.DirectionalLight
        if (!hemi && (o as T.HemisphereLight).isHemisphereLight) hemi = o as T.HemisphereLight
      })
    }
    // Without the scene's lights (a lab, a test), plain white.
    if (!sun && !hemi) return colour.setRGB(1, 1, 1)
    colour.setRGB(0, 0, 0)
    const s = sun as T.DirectionalLight | null, h = hemi as T.HemisphereLight | null
    if (s) colour.r += s.color.r * s.intensity * .75 / Math.PI, colour.g += s.color.g * s.intensity * .75 / Math.PI, colour.b += s.color.b * s.intensity * .75 / Math.PI
    if (h) {
      const k = h.intensity / Math.PI
      colour.r += (h.color.r * .8 + h.groundColor.r * .2) * k
      colour.g += (h.color.g * .8 + h.groundColor.g * .2) * k
      colour.b += (h.color.b * .8 + h.groundColor.b * .2) * k
    }
    return colour
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
function dropletMaterial(light: N, tint: N, lava = false) {
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
  // Motion blur of about a thirtieth of a second: a fast drop is a streak with a round head at
  // the drop and a tail that tapers to nothing behind it.
  const half = select(mist, radius, radius.add(speed.mul(.009)))
  const q = uv().mul(2).sub(1)
  const m = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide })
  // q.y = 1 is the head, one radius ahead of the drop; the quad runs back 2 x half - radius.
  m.positionNode = centre.add(side.mul(q.x.mul(radius))).add(axis.mul(q.y.mul(half).sub(half.sub(radius))))
  // In drop radii from the drop's centre: `ahead` along the motion (1 at the head), `width` the
  // tail's taper (1 at the drop, 0 at its end) and `rs` the distance from the drop's outline.
  const ahead = q.y.mul(half).sub(half.sub(radius)).div(radius.max(1e-4))
  const length = half.mul(2).sub(radius).div(radius.max(1e-4)).max(1e-3)
  // The tail narrows only to 40 per cent and fades: a soft smear behind the drop, not a thorn.
  const fall = ahead.negate().div(length).clamp(0, 1)
  const width = select(ahead.greaterThan(0), float(1), float(1).sub(fall.mul(.6)))
  const rs = select(ahead.greaterThan(0), vec2(q.x, ahead).length(), q.x.abs().div(width.max(.05)))
  // Everything soft: a smooth falloff to nothing at the outline, no disc edge.
  const body = float(1).sub(smoothstep(0, 1, rs)).pow(1.3).mul(float(1).sub(fall).pow(1.5))
  // Light on a drop: a bright rim and a highlight on the head over a clear body tinted like the sea.
  const rim = smoothstep(.45, .85, rs).mul(float(1).sub(smoothstep(.85, 1, rs))).mul(float(1).sub(fall))
  const glint = float(1).sub(smoothstep(0, .35, vec2(q.x.add(.3), ahead.sub(.25)).length()))
  const n = mx_fractal_noise_float(vec3(q.mul(1.7).add(centre.xz.mul(.37)), 0), 2, 2, .5).mul(.5).add(.5)
  const puff = float(1).sub(smoothstep(.1, 1, q.length().add(n.mul(.3)))).pow(1.5).mul(n.mul(.6).add(.4))
  // Drops passing right by the lens would fill the screen with blobs: fade them out up close.
  const near = smoothstep(1.5, 6, distance)
  const alpha = select(mist, b.w.sub(2), b.w).mul(near)
  // Big clots (splash crowns and columns) are churned full of air: a soft white tuft, uneven
  // with noise, with a faint haze of fine mist round it, never a flat disc.
  const aerated = smoothstep(.03, .12, size)
  const tuft = float(1).sub(smoothstep(0, 1, rs.add(n.sub(.5).mul(.45)))).pow(1.4).mul(n.mul(.5).add(.6)).mul(float(1).sub(fall).pow(.8))
  const drop = body.mul(.65).add(rim.mul(.35)).add(glint.mul(.5)).min(1)
  m.opacityNode = select(mist, puff.mul(alpha).mul(.6), mix(drop.mul(.8), tuft.mul(.9), aerated).mul(alpha).mul(cover.mul(.75).add(.25)))
  // A drop is clear water: the sea's colour through it, deeper below and paler where its upper
  // side catches the sky, with a white glint and rim, so it reads against a pale sky as well as
  // against the sea. A clot is white with air, a little of the sea in its shadow side.
  const up = positionWorld.y.sub(centre.y).div(radius.max(1e-4)).clamp(-1, 1)
  const water = mix(tint.mul(.9), mix(tint, vec3(.8, .9, 1), .45), smoothstep(-.6, .8, up))
  const clot = mix(mix(tint, vec3(1, 1, 1), .6), vec3(1.15, 1.18, 1.2), smoothstep(-.9, .3, up))
  const lit = mix(mix(water, vec3(1.15, 1.18, 1.2), rim.max(glint).mul(.85)), clot, aerated.mul(.85))
  // Spray thrown into the sun scatters it forward: clots and mist read brighter than lit sand.
  m.colorNode = select(mist, mix(tint, vec3(1, 1, 1), .75).mul(1.35), lit.mul(mix(float(1), float(1.6), aerated))).mul(light)
  if (lava) {
    // Molten drops glow on their own and cool as they fade: yellow-orange to a dark clot.
    // Lava "mist" is a hot, dark smoke.
    const heat = select(mist, b.w.sub(2), b.w).clamp(0, 1)
    const molten = mix(vec3(.12, .04, .02), mix(vec3(2.2, .45, .05), vec3(3.4, 1.5, .3), heat), smoothstep(.15, .6, heat))
    m.colorNode = select(mist, mix(vec3(.25, .2, .2), vec3(.9, .3, .06), heat.mul(.6)), molten.mul(body.mul(.6).add(.4)))
    m.opacityNode = select(mist, puff.mul(alpha).mul(.45), body.mul(alpha).mul(cover.mul(.75).add(.25)).mul(.95))
  }
  return m
}

/**
 * Foam lying on the liquid: wake strips and rings, all soft, none cut out with a hard edge.
 * A strip quad runs from one wake point to the next, each end with its own side vector, half
 * width and fade, so consecutive quads share their edges exactly. A ring has zero side
 * vectors; B.w is 2 for the soft patch a landing drop leaves.
 *
 * Foam has structure: it is densest right behind its source, then opens into separate patches
 * with clear water between that thin with age, so a trail dissolves in pieces rather than
 * fading as one shape. The patches are laid out across the strip in its own proportions, so
 * they drift apart as the strip spreads. A ring is a band of foam broken into arcs and
 * flecks. `octaves` 1 at the safe graphics level keeps it cheap.
 */
function foamMaterial(light: N, tint: N, lava = false, octaves = 2) {
  const A = attribute('foamA', 'vec4'), B = attribute('foamB', 'vec4'), S = attribute('foamSide', 'vec4'), L = attribute('foamLook', 'vec4')
  const kindLength = S.xy.length()
  const ring = kindLength.lessThan(.5)
  const ripplet = ring.and(B.w.greaterThan(1.5))
  const q = uv().mul(2).sub(1), t = uv().y
  const sides = normalize(mix(S.xy, S.zw, t).add(1e-5))
  const strip = mix(A.xyz, B.xyz, t).add(vec3(sides.x, 0, sides.y).mul(mix(A.w, B.w, t).mul(q.x)))
  const disc = A.xyz.add(vec3(q.x, 0, q.y).mul(A.w))
  const m = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide })
  m.positionNode = select(ring, disc, strip)
  const fade = select(ring, L.x, mix(L.x, L.y, t)), age = select(ring, L.w, mix(L.z, L.w, t))
  // Along the strip in metres, across it in its own proportions: patches spread as it widens.
  const along = dot(positionWorld.xz, vec2(sides.y, sides.x.negate()))
  const patchy = mx_fractal_noise_float(vec3(q.x.mul(1.7), along.mul(.32), 0), octaves, 2, .5).mul(.5).add(.5)
  const lace = mx_fractal_noise_float(vec3(positionWorld.xz.mul(2.4), 3.7), octaves, 2, .55).mul(.5).add(.5)
  // Strips: a feathered profile across whose edge wanders.
  const edge = q.x.abs().add(patchy.sub(.5).mul(.4)).max(0)
  const profile = float(1).sub(smoothstep(.12, 1, edge)).pow(1.3)
  // Young foam is a blanket; with age it opens into patches over clear water, which thin
  // until the last pieces go. A churned patch breaks up sooner.
  const open = age.mul(.85).add(.08)
  const patches = smoothstep(open.sub(.13), open.add(.13), patchy.mul(.62).add(lace.mul(.5)))
  const blanket = float(1).sub(smoothstep(0, .22, age))
  const stripAlpha = profile.mul(patches.max(blanket.mul(.85))).mul(fade)
  // Rings: a band of foam, a few times thicker where it starts, broken into arcs and flecks
  // from the first frame and fading from the outside in, so no continuous outline ever shows.
  // A ripplet (where a drop landed) is a soft patch of disturbed water, never an outline.
  const around = mx_fractal_noise_float(vec3(q.x.mul(2.2), q.y.mul(2.2), A.x.add(A.z).mul(.13)), octaves, 2, .5).mul(.5).add(.5)
  const flecks = mx_fractal_noise_float(vec3(q.x.mul(7), q.y.mul(7), A.x.sub(A.z).mul(.11).add(7)), octaves, 2, .5).mul(.5).add(.5)
  const rr = q.length().add(around.sub(.5).mul(.12))
  const thick = mix(float(.26), float(.09), age.clamp(0, 1)).mul(around.mul(.8).add(.6))
  const centreR = float(.8)
  const band = float(1).sub(smoothstep(thick.mul(.2), thick, rr.sub(centreR).abs()))
  // The outer side of the band goes first.
  const outerGone = smoothstep(centreR.add(thick.mul(float(1).sub(age.mul(1.3)).max(-1))), centreR.add(thick.mul(float(1).sub(age.mul(1.3)).max(-1))).add(.12), rr)
  const arcs = smoothstep(.4, .58, around.mul(.55).add(flecks.mul(.55)).sub(age.mul(.25)))
  const ringFoam = band.mul(arcs).mul(float(1).sub(outerGone)).mul(flecks.mul(.6).add(.55))
  const inside = float(1).sub(smoothstep(.3, .75, rr)).mul(float(1).sub(smoothstep(0, .35, age))).mul(.12)
  const patch = float(1).sub(smoothstep(0, .95, rr)).pow(1.5).mul(smoothstep(.3, .7, flecks.mul(.6).add(lace.mul(.5)))).mul(.6)
  const ringAlpha = select(ripplet, patch, ringFoam.add(inside)).mul(float(1).sub(smoothstep(.92, 1, q.length()))).mul(fade)
  const alpha = select(ring, ringAlpha, stripAlpha).clamp(0, 1)
  m.opacityNode = alpha.mul(.95)
  // Fresh foam is white with air; as it settles it takes the liquid's own colour.
  const fresh = float(1).sub(smoothstep(.05, .7, age))
  m.colorNode = mix(mix(tint, vec3(1, 1, 1), .55), vec3(.95, .98, 1), fresh).mul(light).mul(lace.mul(.15).add(.95)).mul(select(ring, ringFoam.mul(.12).add(1), float(1)))
  if (lava) {
    // Churned lava: bright where the crust was broken, crusting over dark as it ages.
    m.colorNode = mix(vec3(3.2, 1.25, .2).mul(lace.mul(.4).add(.8)), vec3(.07, .035, .025), smoothstep(.15, .85, age)).add(vec3(2.5, .9, .1).mul(blanket.mul(.6)))
    m.opacityNode = alpha
  }
  return m
}

/** Call update once, then vehicle for each wet or recently wet vehicle each frame. */
export class Spray {
  private sim: SpraySim | null = null
  private drops: { mesh: T.Mesh<T.InstancedBufferGeometry, T.MeshBasicNodeMaterial>; a: Float32Array; b: Float32Array; attributes: T.InstancedBufferAttribute[] } | null = null
  private foam: { mesh: T.Mesh<T.InstancedBufferGeometry, T.MeshBasicNodeMaterial>; arrays: Float32Array[]; attributes: T.InstancedBufferAttribute[] } | null = null
  private tier = -1
  private packed = -1
  /**
   * `water` gives the true moving surface (Terrain.liquidHeightAt) for wakes and landings.
   * `liquid` 'lava' draws molten spray and a glowing wake that crusts over, thrown lower and
   * slower (lava is three times as dense and far more viscous), and leaves the water's ripple
   * field alone.
   */
  constructor(private scene: T.Scene, private ripples: Ripples, private water: SprayWater | null = null, private readonly liquid: 'water' | 'lava' = 'water') {}
  setWater(water: SprayWater | null) { this.water = water; this.sim?.setWater(water) }
  /** Live simulation, for tests and evidence tools. */
  get state() { return this.sim }
  private allocate(tier: number) {
    const octaves = tier === 0 ? 1 : 2
    if (this.tier >= 0 && (this.tier === 0) !== (tier === 0)) this.release()
    // Lava drops sink into the crust: no ripplets where they land.
    const cap = { ...sprayCapacity(tier), ...(this.liquid === 'lava' ? { ripplets: 0 } : {}) }
    this.sim = new SpraySim(cap, this.water); this.tier = tier; this.packed = -1
    const d = batch(cap.droplets, ['sprayA', 'sprayB'])
    const lava = this.liquid === 'lava'
    const segments = cap.vehicles * 3 * cap.points + cap.rings + cap.ripplets
    const f = batch(segments, ['foamA', 'foamB', 'foamSide', 'foamLook'])
    let dropMesh = this.drops?.mesh, foamMesh = this.foam?.mesh
    if (dropMesh && foamMesh) {
      const oldDrops = dropMesh.geometry, oldFoam = foamMesh.geometry
      dropMesh.geometry = d.g
      foamMesh.geometry = f.g
      oldDrops.dispose()
      oldFoam.dispose()
      if (!dropMesh.parent) this.scene.add(dropMesh, foamMesh)
    } else {
      const light = sprayLight()
      dropMesh = new T.Mesh(d.g, dropletMaterial(light, waterTint(), lava))
      foamMesh = new T.Mesh(f.g, foamMaterial(light, waterTint(), lava, octaves))
      dropMesh.name = `${this.liquid}-spray`; foamMesh.name = `${this.liquid}-foam`
      // After the water (transparent, no depth write) so foam lies on it; droplets after foam.
      foamMesh.renderOrder = 2; dropMesh.renderOrder = 3
      for (const mesh of [dropMesh, foamMesh]) {
        mesh.frustumCulled = false; applyCurve(mesh.material); this.scene.add(mesh)
        // Pack at most once per change, after this frame's emissions, just before the draw.
        mesh.onBeforeRender = () => this.pack()
      }
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
    if (!waterSpray.value) {
      if (graphicsLevel.value !== 0) { this.dispose(); return }
      // Minimal skips spray entirely. Keep its compiled draws for a return to Low.
      if (this.sim) {
        this.drops?.mesh.removeFromParent()
        this.foam?.mesh.removeFromParent()
        this.sim = null
      }
      return
    }
    // Allocated up front, not on first contact, and drawn with no instances while idle so the
    // pipelines exist before any vehicle reaches the water.
    const tier = Math.max(0, Math.min(2, Math.round(graphicsLevel.value)))
    if (!this.sim || tier !== this.tier) this.allocate(tier)
    this.sim!.step(dt)
  }
  /**
   * A climbed level (Game.prepareClimbedLevel): allocate for it now, as update would on the next
   * frame, so the preparation draw submits the batches (drawn with no instances while idle) and
   * their pipelines exist before play. Leaving Minimal, they were not in the scene at all.
   */
  prepareClimb() {
    if (!waterSpray.value) return
    const tier = Math.max(0, Math.min(2, Math.round(graphicsLevel.value)))
    if (!this.sim || tier !== this.tier) this.allocate(tier)
  }
  /** One vehicle this frame; `shape` says what touches the liquid (spraySim.ts WakeShape). */
  vehicle(id: string, position: T.Vector3, velocity: T.Vector3, submergedFraction: number, dt: number, shape?: WakeShape, touchdown = false) {
    if (!waterSpray.value) return
    if (!this.sim) this.allocate(Math.max(0, Math.min(2, Math.round(graphicsLevel.value))))
    this.sim!.wakeStrength = waterWakeStrength.value; this.sim!.wakeWidth = waterWakeWidth.value; this.sim!.bowSwell = waterBowSwell.value; this.sim!.foamWidth = waterWakeFoamWidth.value; this.sim!.foamLife = waterWakeFoamLife.value
    const entering = this.sim!.vehicle(id, position.x, position.y, position.z, velocity.x, velocity.y, velocity.z, submergedFraction, dt, waterSprayScale.value * (this.liquid === 'lava' ? .7 : 1), shape, touchdown)
    if (this.liquid === 'lava') return entering
    const sub = Math.max(0, Math.min(1, submergedFraction)), speed = Math.hypot(velocity.x, velocity.z)
    if (sub > 0 && speed > 1) this.ripples.disturb(position.x, position.z, waterWakeRippleWidth.value, waterWakeRipple.value * Math.min(.15, speed * .004) * Math.min(.1, Math.max(0, dt)) * 60)
    // Air pressing on the water (a cushion, a downwash) ruffles a wider patch of it, even at rest.
    const near = shape?.air && sub <= 0 ? Math.max(0, Math.min(1, shape.near ?? 0)) : 0
    if (near > .02) this.ripples.disturb(position.x, position.z, (shape!.beam ?? 1.5) * 1.4, waterWakeRipple.value * near * (shape!.air === 'cushion' ? .06 : .04) * Math.min(.1, Math.max(0, dt)) * 60)
    // Rings of ripples spreading from the hole, wider and stronger for a harder hit.
    if (entering) { const impact = this.sim!.lastSplash; this.ripples.disturb(position.x, position.z, 2 + Math.min(4, impact * .12), Math.min(.6, impact * .04 + .1)) }
    return entering
  }
  /**
   * A splash where something that is not a vehicle hits the surface (a shot): the same crown,
   * column and foam ring as an entry at `speed` m/s straight down, with ripples on water.
   */
  impact(position: T.Vector3, speed: number) {
    if (!waterSpray.value) return
    if (!this.sim) this.allocate(Math.max(0, Math.min(2, Math.round(graphicsLevel.value))))
    this.sim!.impact(position.x, position.y, position.z, 0, -Math.max(0, speed), 0, waterSprayScale.value * (this.liquid === 'lava' ? .7 : 1))
    if (this.liquid !== 'lava') this.ripples.disturb(position.x, position.z, 2 + Math.min(4, speed * .12), Math.min(.6, speed * .04 + .1))
  }
  /** The world moved by a whole tile under the player: move what spray has left behind with it. */
  shift(dx: number, dz: number) { this.sim?.shift(dx, dz) }
  private release() {
    for (const mesh of [this.drops?.mesh, this.foam?.mesh]) if (mesh) {
      mesh.removeFromParent()
      mesh.dispose()
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this.drops = this.foam = null; this.sim = null; this.tier = -1
  }
  dispose() { this.release() }
}

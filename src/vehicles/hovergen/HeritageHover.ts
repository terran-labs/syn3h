import * as T from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { bodyRings, loft, type Mat } from '../jetgen/shapes'
import { mergeStatic } from '../skins/mergeStatic'
import { applyShowroom, setRole } from '../skins/showroom'


import { buildHeritage, heritageHull, addHeritageBox, type HeritageDesign } from './heritage'
import { vehicleDecoration, noDecoration } from '../skins/decoration'

/** Round two uses the common vehicle materials. Round one retains its original builder. */
export class HeritageHover {
  readonly object = new T.Group()
  readonly thruster = new T.Group()
  readonly ports: [number, number, number][]
  readonly cockpitClearance: number
  private readonly paint: T.MeshStandardMaterial
  private readonly accent: T.MeshStandardMaterial
  private readonly head = setRole(new T.MeshStandardMaterial({ color: 0xd8e4ff, emissive: 0xe8f4ff }), 'lamp')
  private readonly tail = setRole(new T.MeshStandardMaterial({ color: 0x400808, emissive: 0xff1605 }), 'lamp')
  private readonly glow: T.MeshStandardMaterial
  private readonly sources: T.Material[] = []
  private readonly glowMeshes: T.Mesh[] = []
  private detach = () => {}

  /**
   * `game` defers the shared shading until `showroom()`: the tiers and the night and lava
   * passes register with the owning vehicle, which only exists once the craft is attached.
   * The lab leaves it false and gets the shading at once, with no game passes.
   */
  constructor(readonly design: HeritageDesign, readonly level: 0 | 1 | 2, private readonly game = false) {
    this.paint = setRole(new T.MeshStandardMaterial({ color: design.paint, metalness: .8, roughness: .24 }), 'paint')
    this.accent = setRole(new T.MeshStandardMaterial({ color: design.accent, roughness: .4 }), 'accent')
    this.glow = setRole(new T.MeshStandardMaterial({ color: design.accent, emissive: design.accent, emissiveIntensity: 2, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }), 'glow')
    this.glow.forceSinglePass = true
    this.sources.push(this.paint, this.accent, this.glow, this.head, this.tail)
    this.object.userData.vehicleColors = { body: this.paint.color, accent: this.accent.color }
    if (level === 2) {
      this.ports = []; this.cockpitClearance = Infinity
      // Explicit silhouette: one draw, ten eight-sided hull stations and two spoiler blades.
      const pieces = [loft(bodyRings(heritageHull(design), 0, 1, 8))]
      pieces.push(loft(bodyRings([[-1.37, .03, .03, .02, .47, 2], [-.63, .49, .46, .04, .48, 2.6], [.43, .04, .03, .02, .56, 2]], 0, 1, 8)))
      for (const x of [-.78, .78]) pieces.push(new T.BoxGeometry(.18, .72, .42).rotateX(.35).translate(x, .87, 1.47))
      if (design.bridge) pieces.push(new T.BoxGeometry(1.56, .05, .30).translate(0, 1.22 * design.blade, 1.67))
      const merged = mergeGeometries(pieces); pieces.forEach(g => g.dispose())
      this.object.add(new T.Mesh(merged, this.paint))
      return
    }
    const b = buildHeritage(design, level === 0 ? .55 : .16)
    this.ports = b.hover; this.cockpitClearance = b.cockpitClearance()
    const canopy = setRole(new T.MeshStandardMaterial({ color: design.accent, transparent: true, opacity: .18, depthWrite: false, side: T.DoubleSide }), 'canopy')
    canopy.forceSinglePass = true
    const chrome = setRole(new T.MeshStandardMaterial({ color: 0xd5dce2, metalness: 1, roughness: .18 }), 'chrome')
    const frame = setRole(new T.MeshStandardMaterial({ color: 0x171c24, metalness: .3, roughness: .6 }), 'frame')
    const trim = setRole(new T.MeshStandardMaterial({ color: 0x161c22, roughness: .8 }), 'trim')
    this.sources.push(canopy, chrome, frame, trim)
    const materials: Record<Mat, T.MeshStandardMaterial> = { paint: this.paint, panel: this.paint, accent: this.accent, chrome, dark: frame, glass: canopy, trim, glow: this.glow }
    if (level === 0) {
      // Seat and low dashboard remain below the forward sightline. The kit owns the tub.
      addHeritageBox(b, 'trim', [.48, .06, .43], [0, .17, -.51])
      addHeritageBox(b, 'trim', [.48, .42, .07], [0, .37, -.20])
      addHeritageBox(b, 'trim', [.64, .07, .15], [0, .36, -1.07])
    }
    for (const part of b.pieces) {
      const mesh = new T.Mesh(part.geometry, materials[part.mat])
      mesh.name = `heritage-${part.mat}`; mesh.castShadow = mesh.receiveShadow = !['glow', 'glass'].includes(part.mat)
      this.object.add(mesh)
    }
    // Large round lenses in chrome rings, and stacked rear bars contained in dark sockets.
    // These repeat the approved Box arm fittings without adding wheel hardware to a hovercraft.
    for (const side of [-1, 1]) {
      const x = side * .76
      const rim = new T.Mesh(new T.TorusGeometry(.115, .022, 6, level === 0 ? 16 : 8), chrome)
      rim.position.set(x, .30, -1.79); this.object.add(rim)
      const lens = new T.Mesh(new T.SphereGeometry(.103, level === 0 ? 12 : 8, 6).scale(1, 1, .25), this.head)
      lens.position.copy(rim.position); lens.position.z -= .013; this.object.add(lens)
      const socket = new T.Mesh(new T.BoxGeometry(.43, .21, .10), frame)
      socket.position.set(side * .60, .34, 1.79); this.object.add(socket)
      for (const y of [.30, .38]) {
        const light = new T.Mesh(new T.BoxGeometry(.35, .045, .016), this.tail)
        light.position.set(side * .60, y, 1.847); this.object.add(light)
      }
    }
    if (level === 0 && b.gimbal) {
      this.thruster.position.set(0, b.gimbal.y, b.gimbal.z)
      for (const x of [-.08, .08]) {
        const vane = new T.Mesh(new T.BoxGeometry(.018, .25, .12), chrome)
        vane.position.set(x, 0, .02); this.thruster.add(vane)
      }
      this.object.add(this.thruster)
    }
    mergeStatic(this.object)
    this.object.traverse(o => { if (o instanceof T.Mesh && o.material === this.glow) this.glowMeshes.push(o) })
    if (!game) this.detach = applyShowroom(this.object, noDecoration)
    this.setLights(false, false)
  }

  /** Game use: call once the craft is attached to its vehicle. The far silhouette has no tiers. */
  showroom(): void {
    if (!this.game || this.level === 2 || this.shaded) return
    this.shaded = true
    this.detach = applyShowroom(this.object, vehicleDecoration)
  }
  private shaded = false

  setColors(body: T.ColorRepresentation, accent: T.ColorRepresentation): void {
    this.paint.color.set(body); this.accent.color.set(accent)
    this.glow.color.set(accent); this.glow.emissive.set(accent)
  }
  setVector(yaw: number): void { this.thruster.rotation.y = -yaw }
  setThrottle(amount: number): void {
    const value = .3 + Math.max(0, Math.min(1, amount)) * .7
    this.glow.emissiveIntensity = value * 2
    for (const mesh of this.glowMeshes) mesh.userData.glow = value
  }
  setLights(on: boolean, braking: boolean): void {
    // mergeStatic keeps references to emissive colours, so update colours, not copied scalars.
    this.head.emissive.set(0xe8f4ff).multiplyScalar(on ? 3 : 0)
    this.tail.emissive.set(0xff1605).multiplyScalar(braking ? 1.5 : on ? .6 : .04)
  }
  triangles(): number {
    let n = 0
    this.object.traverse(o => { if (o instanceof T.Mesh) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 })
    return n
  }
  dispose(): void {
    this.detach()
    const geometries = new Set<T.BufferGeometry>(), materials = new Set(this.sources)
    this.object.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m) } })
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
  }
}

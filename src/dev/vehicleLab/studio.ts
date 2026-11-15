/**
 * The lab's photo studio: a generated softbox environment for reflections, a key light with
 * shadows, a day and a night mode, and two floors. Everything is generated at load time; no
 * textures are fetched.
 *
 * Floors:
 * - Gloss: a dark glossy floor that mirrors the vehicle, like the owner's studio renders. The
 *   mirror is a real reflection pass (three's reflector node), so it follows animation, detail
 *   levels and lamps. It costs one extra scene render at half resolution.
 * - Shadow: a plain matte floor that shows the contact shadow clearly and costs nothing extra.
 *
 * Either floor fades out as the camera comes down to it and is gone at floor level and below
 * (see fade()), so the camera can go under the floor and look up at a vehicle's underside.
 */
import * as THREE from 'three/webgpu'
import { color, reflector, uniform } from 'three/tsl'
import { floorOpacity, type FloorName } from './logic'

/**
 * A dark room lit by a few long softboxes, rendered once into a PMREM environment map. The long
 * thin panels are what put streaky studio highlights on clear coat and chrome, the "reflective
 * shine" of the tank studies. Positions and powers are the tank viewer's, which the owner liked.
 */
function softboxRoom(): THREE.Scene {
  const room = new THREE.Scene()
  room.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: 0x2b2d32, side: THREE.BackSide })))
  const box = (w: number, h: number, x: number, y: number, z: number, power: number, tint = 0xffffff) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(power), side: THREE.DoubleSide }))
    panel.position.set(x, y, z)
    panel.lookAt(0, 0, 0)
    room.add(panel)
  }
  // Two tall overhead strips, two side banks (one cool), and a long low panel at each end.
  box(4, 34, -6, 24, 1, 9); box(3, 34, 8, 24, 1, 6)
  box(8, 26, -24, 10, -6, 3.2); box(8, 26, 24, 10, 8, 2.4, 0xdfe8ff)
  box(26, 5, 0, 8, 28, 2.2); box(22, 4, 0, 6, -30, 2.6, 0xfff0dd)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0x17181b }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -6
  room.add(floor)
  return room
}

/** Strength of the light from below once the floor has faded out (see Studio.fade). */
const UNDER_LIGHT = 2.2
const DAY = { background: 0x8d9096, key: 2.6, hemi: .5, environment: 1, reflection: .42 }
const NIGHT = { background: 0x06080c, key: .08, hemi: .07, environment: .14, reflection: .55 }

export class Studio {
  readonly key = new THREE.DirectionalLight(0xfff3e4, DAY.key)
  readonly hemi = new THREE.HemisphereLight(0xdde6f5, 0x2a2b30, DAY.hemi)
  /** Lights undersides from below. Off above the floor; comes up as the floor fades out. */
  readonly under = new THREE.DirectionalLight(0xe6ecf5, 0)
  night = false
  floor: FloorName = 'Gloss'
  private readonly background = new THREE.Color(DAY.background)
  private readonly fog = new THREE.Fog(DAY.background, 30, 85)
  private readonly environment: THREE.Texture
  private readonly gloss: THREE.Mesh
  private readonly matte: THREE.Mesh
  private readonly reflection = uniform(DAY.reflection)
  private readonly reflector: ReturnType<typeof reflector>
  /** How solid the floor is drawn, 0 to 1 (see fade()). */
  private readonly opacity = uniform(1)

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGPURenderer, o: { reflectionScale?: number } = {}) {
    scene.background = this.background
    scene.fog = this.fog
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = softboxRoom()
    this.environment = pmrem.fromScene(room, .03).texture
    room.traverse(x => { if (x instanceof THREE.Mesh) { x.geometry.dispose(); (x.material as THREE.Material).dispose() } })
    pmrem.dispose()
    scene.environment = this.environment

    this.key.position.set(-7, 14, -6)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.normalBias = .03
    this.key.shadow.bias = -.0003
    this.fitShadow(8)
    this.under.position.set(3, -12, -4)
    scene.add(this.key, this.key.target, this.hemi, this.under, this.under.target)

    // Gloss floor: dark base colour, plus the mirror image added as emission so the key light
    // does not double light the reflection.
    this.reflector = reflector({ resolutionScale: o.reflectionScale ?? .5 })
    const glossMaterial = new THREE.MeshStandardNodeMaterial({ metalness: .2, roughness: .28, transparent: true })
    glossMaterial.opacityNode = this.opacity
    glossMaterial.colorNode = color(0x1b1c20)
    glossMaterial.emissiveNode = this.reflector.rgb.mul(this.reflection)
    this.gloss = new THREE.Mesh(new THREE.CircleGeometry(90, 64), glossMaterial)
    this.gloss.rotation.x = -Math.PI / 2
    this.gloss.receiveShadow = true
    this.gloss.name = 'Gloss floor'
    // The reflector's target defines the mirror plane: its local +Z is the plane normal.
    this.gloss.add(this.reflector.target)

    this.matte = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: 0x6f737a, roughness: .92, metalness: 0, transparent: true }))
    this.matte.rotation.x = -Math.PI / 2
    this.matte.receiveShadow = true
    this.matte.name = 'Shadow floor'
    // Drawn before a vehicle's own see-through parts (canopies, force field wings), which
    // stand on it.
    this.gloss.renderOrder = this.matte.renderOrder = -10
    scene.add(this.gloss, this.matte)
    this.setFloor('Gloss')
  }

  /** Sizes the key light's shadow box to cover a stage of this half width, in metres. */
  fitShadow(halfWidth: number): void {
    const s = this.key.shadow.camera
    const r = Math.max(4, halfWidth)
    Object.assign(s, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 40 + r })
    s.updateProjectionMatrix()
  }

  /** Fog starts beyond what is framed, so wide shots (stress grids, line ups) stay clear. */
  fitFog(distance: number): void {
    this.fog.near = distance + 15
    this.fog.far = distance * 2 + 70
  }

  setFloor(name: FloorName): void {
    this.floor = name
    this.showFloor()
  }

  /**
   * Call each frame with the camera's height above the floor. The floor fades as the camera
   * nears it and is not drawn at all from floor level down, which also skips the gloss floor's
   * reflection pass there.
   */
  fade(cameraHeight: number): void {
    const o = floorOpacity(cameraHeight)
    if (o === this.opacity.value) return
    this.opacity.value = o
    this.under.intensity = (1 - o) * UNDER_LIGHT
    ;(this.matte.material as THREE.MeshStandardMaterial).opacity = o
    this.showFloor()
  }

  private showFloor(): void {
    const shown = this.opacity.value > 0
    this.gloss.visible = shown && this.floor === 'Gloss'
    this.matte.visible = shown && this.floor === 'Shadow'
  }

  setNight(on: boolean): void {
    this.night = on
    const p = on ? NIGHT : DAY
    this.background.setHex(p.background)
    this.fog.color.setHex(p.background)
    this.key.intensity = p.key
    this.key.color.setHex(on ? 0xa8c0ff : 0xfff3e4)
    this.hemi.intensity = p.hemi
    this.scene.environmentIntensity = p.environment
    this.reflection.value = p.reflection
    ;(this.matte.material as THREE.MeshStandardMaterial).color.setHex(on ? 0x2a2c30 : 0x6f737a)
  }

  dispose(): void {
    this.environment.dispose()
    for (const m of [this.gloss, this.matte]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.removeFromParent() }
    this.reflector.dispose()
    this.key.dispose(); this.hemi.dispose(); this.under.dispose(); this.under.removeFromParent()
  }
}

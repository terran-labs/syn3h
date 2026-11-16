import * as THREE from 'three/webgpu'
import type {Game} from '../core/Game'
import type {Vehicle} from './Vehicle'
import {compileAhead} from '../core/compileAhead'

/** Draw the actual cached player instance through the normal pass, then keep it alive.
 * Include hidden mechanisms on this same instance so lowered gear is warm too.
 * No physics or controller is registered while this runs. */
export class PlayerVehicleWarm {
  private vehicle: Vehicle | null = null
  private drawn = false
  /** True while the vehicle is being compiled ahead (see compileAhead); it finishes when that does. */
  private compiling = false
  private frames = 0
  private updates = 0
  private readonly restore: (() => void)[] = []
  private readonly hooked = new Set<THREE.Object3D>()
  private readonly cameraPosition = new THREE.Vector3()

  constructor(private readonly game: Game) {}

  get current(): Vehicle | null { return this.vehicle }

  begin(vehicle: Vehicle): void {
    this.finish()
    this.vehicle = vehicle
    this.frames = this.updates = 0
    this.drawn = false
    this.compiling = false
    vehicle.body.setEnabled(false)
    this.game.scene.add(vehicle.object)
  }

  update(): void {
    const vehicle = this.vehicle
    if (!vehicle || this.compiling) return
    if (this.drawn) { this.drawn = false; this.frames++ }
    if (this.frames >= 3 || this.updates++ > 900) { this.finish(); return }
    // This selects the same local detail and material tier that the player will use.
    vehicle.update(0, 1)
    vehicle.object.traverse(object => {
      if (!this.hooked.has(object)) {
        const visible = object.visible
        this.restore.push(() => { object.visible = visible })
      }
      object.visible = true
      if (this.hooked.has(object)) return
      this.hooked.add(object)
      if (!(object as THREE.Mesh).isMesh) return
      const before = object.onBeforeRender, culled = object.frustumCulled
      object.frustumCulled = false
      object.onBeforeRender = (...args) => { this.drawn = true; before.apply(object, args) }
      this.restore.push(() => { object.onBeforeRender = before; object.frustumCulled = culled })
    })
    // Inside the near plane, so the real material compiles but covers no visible pixels.
    this.game.camera.getWorldPosition(this.cameraPosition)
    vehicle.object.position.copy(this.cameraPosition)
    vehicle.object.scale.setScalar(.001)
    // In a running game, compile it a slice per frame without drawing it (drawing compiled
    // every pipeline of the vehicle in one frame), then finish.
    const ahead = compileAhead(vehicle.object)
    if (ahead) {
      this.compiling = true
      vehicle.object.visible = false
      const done = () => { if (this.vehicle === vehicle) { this.compiling = false; this.finish() } }
      ahead.then(done, done)
    }
  }

  finish(): void {
    if (!this.vehicle) return
    for (const restore of this.restore) restore()
    this.restore.length = 0
    this.hooked.clear()
    this.vehicle.object.scale.setScalar(1)
    this.vehicle.setParked(true)
    this.vehicle = null
  }
}

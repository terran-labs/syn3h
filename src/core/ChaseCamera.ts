/** Syn3h CoreCamera port. Source and deliberate extensions are documented in tests/core/camera.md. */
import * as THREE from 'three/webgpu'
import { defineParam, params } from '../../shared/params'
import type { Terrain } from '../world/Terrain'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Game, System } from './Game'
import { CameraDirector } from './CameraDirector'
import { curveOffset } from '../world/curve'
import { waterUnderwater } from '../world/water/underwater'
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.1) => defineParam({ id: `camera.${id}`, label, group: 'Camera', scope: 'client', default: value, min, max, step })
const boolean = (id: string, label: string, value: boolean) => defineParam({ id: `camera.${id}`, label, group: 'Camera', scope: 'client', default: value })
// _Runtime.prefab:8755-8795, terra.buggy.prefab:586, CoreCamera.cs:177.
export const camDistance = number('distance', 'Orbit distance', 6.25, 0, 25, 0.25)
export const camZoomSpeed = number('zoomSpeed', 'Zoom speed', 0.4, 0.05, 2, 0.05)
/** One notch is 100 CSS pixels or one line/page; cap large wheel events. */
export function cameraWheelNotches(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 0
  return Math.max(-1, Math.min(1, deltaY / (deltaMode === 0 ? 100 : 1)))
}
export const camHeight = number('height', 'Vertical bump ratio', 0.15, 0, 0.6, 0.01)
export const camMode = number('mode', '0 chase 1 cockpit 2 orbit 3 stationary 4 roam', 0, 0, 4, 1)
export const camOffset = number('offset', 'Vehicle clearance', 3, 0, 10)
export const camFov = number('fov', 'Chase FOV', 80, 40, 110, 1)
export const camRideFov = number('rideFov', 'Ride FOV', 70, 40, 110, 1)
export const camRotationClose = number('rotationClose', 'Near rotation smoothing', 10, 0.1, 30)
export const camRotationFar = number('rotationFar', 'Far rotation smoothing', 5, 0.1, 30)
export const camAutoRotation = number('autoRotation', 'Travel direction smoothing', 3, 0.1, 20)
export const camRideRotation = number('rideRotation', 'Ride rotation smoothing', 5, 0.1, 20)
export const camDistanceSmoothing = number('distanceSmoothing', 'Distance smoothing', 4, 0.1, 20)
export const camVelocitySmoothing = number('velocitySmoothing', 'Speed smoothing', 0.2, 0.1, 10)
export const camFovSmoothing = number('fovSmoothing', 'FOV smoothing', 7, 0.1, 20)
// 0.5 in the original. On steep ground half a metre at one point under the lens still lets
// the corners of the view dip into the hillside.
export const camClearance = number('clearance', 'Terrain clearance', 1.2, 0.1, 3)
export const camAutoDelay = number('autoDelay', 'Resume chase after look', 3, 0, 10)
// 1 in the original: the view pitched with every bump the car took. A camera operator
// follows the slope of the hill, not the suspension.
export const camPitchDamping = number('pitchDamping', 'Travel pitch response', 0.45, 0, 1)
export const camSpeedDistance = boolean('speedDistance', 'Enable repaired speed distance', false)
export const camSpeedMultiplier = number('speedMultiplier', 'Speed distance multiplier', 0.05, 0, 0.1, 0.005)
export const camFlight = boolean('flight', 'Flight camera', true)
export const camGyro = boolean('gyro', 'Follow vehicle roll', false)
export const camHorizonSmoothing = number('horizonSmoothing', 'Horizon smoothing', 20, 1, 30)
export const camSensitivity = number('sensitivity', 'Mouse rotation multiplier', 4, 0.1, 10)
export const camScope = number('scope', 'Scope magnification', 3.25, 1.5, 5, 0.25)
export const camRoamSpeed = number('roamSpeed', 'Roam speed', 2, 0.25, 25)
export const camRideHeight = number('rideHeight', 'Fallback ride height', 0.95, 0, 5)
/** Seconds to ease from a director shot into the chase view when the player takes the controls back. */
export const DIRECTOR_HANDBACK_SECONDS = 1.2
/** Cut between cinematic shots while the vehicle drives itself (Daydream). */
export const camDaydreamShots = boolean('daydreamShots', 'Cinematic shots while daydreaming', true)

export interface CameraVehicle extends Vehicle {
  wingOpen?: boolean
  camSmooth?: boolean
  camOffset?: number
  ridePosition?: THREE.Object3D
  ridePos?: THREE.Object3D
}
const ease = (dt: number, rate: number) => 1 - Math.exp(-Math.max(0, dt) * rate)
const clamp = THREE.MathUtils.clamp

type CameraTerrain = Pick<Terrain, 'heightAt' | 'liquidHeightAt'> & Partial<Pick<Terrain, 'liquidKindAt'>>
function liquidHeight(terrain: CameraTerrain, x: number, z: number): number {
  // Water Lab: with the underwater camera on, the camera may follow a vehicle under water.
  if (waterUnderwater.value && terrain.liquidKindAt?.(x, z) === 'water') return -Infinity
  const height = terrain.liquidHeightAt?.(x, z)
  return height != null && Number.isFinite(height) ? height : -Infinity
}
function surfaceHeight(terrain: CameraTerrain, x: number, z: number): number {
  return Math.max(terrain.heightAt(x, z), liquidHeight(terrain, x, z))
}

/** Sample the camera arm so hills cannot hide the car; stay above liquid too. */
export function constrainCamera(terrain: CameraTerrain, pivot: THREE.Vector3, desired: THREE.Vector3, clearance: number, from = 0): THREE.Vector3 {
  const start = pivot.clone(), result = desired.clone()
  // Lift a submerged arm instead of collapsing it onto the vehicle at the shore.
  // Existing rotation easing still controls the chase; the surface is a hard lower bound.
  start.y = Math.max(start.y, liquidHeight(terrain, start.x, start.z) + clearance)
  result.y = Math.max(result.y, liquidHeight(terrain, result.x, result.z) + clearance)
  const distance = start.distanceTo(result)
  const steps = Math.min(160, Math.max(1, Math.ceil(distance / 0.25)))
  // `from` skips the start of the arm: on a road cut into a hillside the ground beside the
  // car is above the arm's first metre, and that is the car's own ground, not an obstacle.
  for (let i = Math.max(1, Math.ceil(steps * from)); i <= steps; i++) {
    const t = i / steps, x = THREE.MathUtils.lerp(start.x, result.x, t), z = THREE.MathUtils.lerp(start.z, result.z, t)
    const y = THREE.MathUtils.lerp(start.y, result.y, t)
    if (y < surfaceHeight(terrain, x, z) + clearance) { result.lerpVectors(start, result, Math.max(0, (i - 1) / steps)); break }
  }
  // Essential after collision shortening, teleports and interpolation.
  result.y = Math.max(result.y, surfaceHeight(terrain, result.x, result.z) + clearance)
  return result
}

/**
 * How far the far end of the camera arm must rise for the whole arm to clear the ground and
 * any liquid between the car and the lens. Rising over a hill keeps the car in frame at the
 * same distance; the old answer, shortening the arm, snapped the view metres closer in one
 * frame. The first fifth of the arm is not tested: the ground the car stands on is not in
 * the way. Capped, so a cliff face behind the car still falls back to shortening.
 */
export function armLift(terrain: CameraTerrain, pivot: THREE.Vector3, desired: THREE.Vector3, clearance: number, cap = 10): number {
  const length = pivot.distanceTo(desired)
  const steps = Math.min(48, Math.max(4, Math.ceil(length / 0.75)))
  let lift = 0
  for (let i = Math.ceil(steps * 0.2); i <= steps; i++) {
    const t = i / steps, x = THREE.MathUtils.lerp(pivot.x, desired.x, t), z = THREE.MathUtils.lerp(pivot.z, desired.z, t)
    const need = surfaceHeight(terrain, x, z) + clearance - THREE.MathUtils.lerp(pivot.y, desired.y, t)
    if (need > 0) lift = Math.max(lift, need / t)
  }
  return Math.min(cap, lift)
}

/** The highest ground or liquid in a small ring round a point: what the lens has to stay above. */
function ringHeight(terrain: CameraTerrain, x: number, z: number, radius: number): number {
  let top = surfaceHeight(terrain, x, z)
  for (let a = 0; a < 6; a++) top = Math.max(top, surfaceHeight(terrain, x + Math.cos(a * Math.PI / 3) * radius, z + Math.sin(a * Math.PI / 3) * radius))
  return top
}

export class ChaseCamera implements System {
  target: THREE.Object3D | null = null
  private vehicle: CameraVehicle | null = null
  private previousTarget: THREE.Object3D | null = null
  private readonly previousPosition = new THREE.Vector3()
  private readonly velocity = new THREE.Vector3()
  private readonly pivot = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private readonly automatic = new THREE.Quaternion()
  private readonly autoTarget = new THREE.Quaternion()
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly direction = new THREE.Vector3()
  private readonly keys = new Set<string>()
  private readonly unbind: (() => void)[] = []
  /** Smoothed copies: the car's height without its suspension bounce, its velocity without the bumps. */
  private pivotY = NaN
  private readonly steady = new THREE.Vector3()
  /** How far the arm is currently raised over ground in its way. Rises fast, settles slowly. */
  private lift = 0
  private backingFor = 0
  /** Yaw and pitch rates of the travel-following spring, radians per second. */
  private readonly turn = [0, 0]
  /** Unity's SmoothDamp: a critically damped spring toward `target`, velocity kept in `rates[index]`. */
  private damp(current: number, target: number, rates: number[], index: number, time: number, dt: number, angle: boolean): number {
    let change = current - target
    if (angle) change = Math.atan2(Math.sin(change), Math.cos(change))
    const goal = current - change, omega = 2 / Math.max(1e-3, time), x = omega * dt
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const temp = (rates[index] + omega * change) * dt
    rates[index] = (rates[index] - omega * temp) * decay
    return goal + (change + temp) * decay
  }
  private readonly aheadPivot = new THREE.Vector3()
  private readonly aheadDesired = new THREE.Vector3()
  /** Share of the full arm length in use, 1 unless something forced the camera in. */
  private arm = 1
  private readonly nose = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private distance = camDistance.value
  private speed = 0
  private elapsed = 0
  private lastManual = -Infinity
  private dragging = false
  private scopeHeld = false
  private hiddenTarget: THREE.Object3D | null = null
  /**
   * What the ride view hid, with each object's visibility before. A vehicle that tags parts
   * with `userData.hideInRide = true` (a cockpit canopy, say) loses only those, so the driver
   * sees their own body around them. A vehicle that tags nothing is hidden whole, as before.
   * A vehicle whose object has `userData.cockpit === true` hides nothing at all.
   */
  private readonly hidden: { object: THREE.Object3D; wasVisible: boolean }[] = []
  private hidWhole = false
  private hideCheck = 0

  constructor(private readonly game: Game, private readonly terrain: Terrain) {
    if (typeof window === 'undefined') return
    const listen = (target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, handler, options)
      this.unbind.push(() => target.removeEventListener(type, handler, options))
    }
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))
    listen(window, 'keydown', ((event: KeyboardEvent) => {
      if (editable(event.target) || this.game.input.suspended) return
      this.keys.add(event.code)
      if (event.code === 'KeyC' && !event.repeat) {
        // Release old driving keys before entering roam, then capture its controls below.
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft']) window.dispatchEvent(new KeyboardEvent('keyup', { code }))
        params.set(camMode.def.id, (Math.round(camMode.value) + 1) % 5); event.preventDefault()
      }
      if (event.code === 'KeyZ') this.scopeHeld = true
      if (event.code === 'Equal' || event.code === 'Minus') params.set(camDistance.def.id, camDistance.value + (event.code === 'Minus' ? 1 : -1) * 2 * camZoomSpeed.value)
      if (Math.round(camMode.value) === 4 && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft'].includes(event.code)) { event.stopImmediatePropagation(); event.preventDefault() }
    }) as EventListener, { capture: true })
    listen(window, 'keyup', ((event: KeyboardEvent) => { this.keys.delete(event.code); if (event.code === 'KeyZ') this.scopeHeld = false }) as EventListener)
    listen(window, 'blur', () => { this.keys.clear(); this.scopeHeld = false; this.dragging = false })
    listen(game.canvas, 'pointerdown', ((event: PointerEvent) => {
      if (event.button === 2) { params.set(camMode.def.id, Math.round(camMode.value) === 1 ? 0 : 1); event.preventDefault() }
      if (event.button === 1 || event.button === 0 && event.altKey) { this.dragging = true; event.stopImmediatePropagation(); event.preventDefault() }
    }) as EventListener, { capture: true })
    listen(window, 'pointerup', () => { this.dragging = false })
    listen(game.canvas, 'contextmenu', event => event.preventDefault())
    listen(window, 'syn3h:daydream', ((event: CustomEvent<{ active: boolean }>) => { if (event.detail?.active) this.director.start(); else this.director.stop() }) as EventListener)
    listen(window, 'pointermove', ((event: PointerEvent) => {
      if ((!this.dragging && document.pointerLockElement !== game.canvas) || this.game.input.suspended) return
      this.look(event.movementX, event.movementY)
    }) as EventListener)
    // Touch aiming (src/ui/TouchControls.ts): finger travel in CSS px, treated as mouse travel.
    listen(window, 'syn3h:look', ((event: CustomEvent<{ dx: number; dy: number }>) => this.look(event.detail.dx, event.detail.dy)) as EventListener)
    listen(game.canvas, 'wheel', ((event: WheelEvent) => {
      event.preventDefault()
      this.zoom(event.deltaY, event.deltaMode)
    }) as EventListener, { passive: false })
  }

  /** Turn the view by pointer travel in CSS px, at the mouse sensitivity; chase resumes after camera.autoDelay. */
  look(dx: number, dy: number): void {
    if (this.game.input.suspended || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const sensitivity = camSensitivity.value * (this.scopeHeld ? 0.75 / 4 : 1) * Math.PI / 180 * 0.1
    this.yaw -= dx * sensitivity; this.pitch = clamp(this.pitch - dy * sensitivity, -Math.PI * 0.49, Math.PI * 0.49)
    this.lastManual = this.elapsed
  }

  /** Proportional wheel input, preserving scope and roam units and parameter ranges. */
  zoom(deltaY: number, deltaMode = 0): void {
    const param = this.scopeHeld ? camScope : Math.round(camMode.value) === 4 ? camRoamSpeed : camDistance
    const step = this.scopeHeld ? -0.25 : param === camRoamSpeed ? 1 : camZoomSpeed.value
    params.set(param.def.id, param.value + cameraWheelNotches(deltaY, deltaMode) * step)
  }

  /** Chooses shots while the vehicle drives itself. Started and stopped by Daydream's event. */
  readonly director = new CameraDirector()
  /** True while the current cinematic pose is the director's, not the attract mode's. */
  private directed = false
  private readonly bend = { x: 0, y: 0, z: 0 }
  private readonly lookAt = new THREE.Vector3()
  private readonly shotPosition = new THREE.Vector3()
  private readonly shotTarget = new THREE.Vector3()
  private direct(dt: number): void {
    const vehicle = this.vehicle
    // A pose set from outside (the descent into a world, the lobby's tour) outranks the
    // director: it takes none of those frames and starts no shot under them.
    const free = !this.cinematic || this.directed
    const wanted = free && this.director.active && camDaydreamShots.value && vehicle?.body.isValid()
      && this.director.update(clamp(dt, 0, 0.25), vehicle.object.position, vehicle.body.linvel(), this.terrain, this.shotPosition, this.shotTarget)
    if (wanted) { this.writeCinematicPose(this.shotPosition, this.shotTarget); this.directed = true }
    else if (this.directed) {
      this.directed = false
      // Between its own shots the director cuts back to the chase view, as a film does. When
      // it stops because the player took the controls, the view is theirs again and must not
      // jump: ease from the shot into the chase pose.
      this.clearCinematicPose(this.director.active ? 0 : DIRECTOR_HANDBACK_SECONDS)
    }
  }

  setVehicle(vehicle: CameraVehicle | null): void { this.restoreVisibility(); this.vehicle = vehicle; this.target = vehicle?.object ?? null }

  /**
   * External pose override for cinematic shots (attract mode). While set, the camera eases
   * to this pose instead of following the vehicle; parameters and modes are left untouched.
   */
  setCinematicPose(position: THREE.Vector3, target: THREE.Vector3, fov?: number): void {
    // Whatever shot the director was on, the camera now eases from there to this pose.
    this.directed = false
    this.writeCinematicPose(position, target, fov)
  }
  private writeCinematicPose(position: THREE.Vector3, target: THREE.Vector3, fov?: number): void {
    if (!this.cinematic) this.cinematic = { position: new THREE.Vector3(), target: new THREE.Vector3(), look: target.clone() }
    this.cinematic.position.copy(position); this.cinematic.target.copy(target); this.cinematic.fov = fov
    this.blend = null
  }
  /**
   * Back to following the vehicle. With `blendSeconds` above 0 the view does not cut: it eases
   * from wherever the camera is (position, orientation and field of view) into the live chase
   * pose over that time, so a scripted shot can land in the follow camera without a jump
   * (the lobby's descent does). With 0, as before, the chase pose is taken at once.
   */
  clearCinematicPose(blendSeconds = 0): void {
    this.cinematic = null; this.previousTarget = null
    const camera = this.game.camera
    this.blend = blendSeconds > 0 ? { from: camera.position.clone(), turn: camera.quaternion.clone(), fov: camera.fov, time: 0, length: blendSeconds, own: null } : null
  }
  private cinematic: { position: THREE.Vector3; target: THREE.Vector3; look: THREE.Vector3; fov?: number } | null = null
  /**
   * A blend out of a cinematic pose: where the camera was, and the chase camera's own last
   * pose (kept apart from the blended one shown, so the chase camera's smoothing runs on its
   * own values and the blend never feeds back into it).
   */
  private blend: { from: THREE.Vector3; turn: THREE.Quaternion; fov: number; time: number; length: number; own: { position: THREE.Vector3; turn: THREE.Quaternion; fov: number } | null } | null = null

  /** Follow the target across the seam of a wrapping world: move everything by a whole tile. */
  shift(dx: number, dz: number): void {
    for (const v of [this.previousPosition, this.pivot, this.desired, this.game.camera.position]) { v.x += dx; v.z += dz }
    if (this.cinematic) for (const v of [this.cinematic.position, this.cinematic.target, this.cinematic.look]) { v.x += dx; v.z += dz }
    if (this.blend) for (const v of [this.blend.from, this.blend.own?.position]) if (v) { v.x += dx; v.z += dz }
    this.director.shift(dx, dz)
  }

  update(dt: number): void {
    const camera = this.game.camera, before = this.blend
    // Give the chase camera back its own last pose before it updates.
    if (before?.own) { camera.position.copy(before.own.position); camera.quaternion.copy(before.own.turn); camera.fov = before.own.fov }
    this.follow(dt)
    // Read the blend again: following can end one (a new shot) or begin one (the director
    // handing back), and a blend begun this frame must shape this frame too, or the view
    // would show the bare chase pose for one frame before easing toward it.
    const blend = this.blend
    if (!blend) return
    if (this.cinematic) { this.blend = null; return }
    blend.own = { position: camera.position.clone(), turn: camera.quaternion.clone(), fov: camera.fov }
    blend.time += clamp(dt, 0, 0.25)
    const t = clamp(blend.time / blend.length, 0, 1), w = t * t * (3 - 2 * t)
    camera.position.lerpVectors(blend.from, blend.own.position, w)
    // A straight line between two clear points can still cut a hill: keep the floor.
    camera.position.y = Math.max(camera.position.y, surfaceHeight(this.terrain, camera.position.x, camera.position.z) + camClearance.value)
    camera.quaternion.slerpQuaternions(blend.turn, blend.own.turn, w)
    camera.fov = THREE.MathUtils.lerp(blend.fov, blend.own.fov, w); camera.updateProjectionMatrix()
    if (t >= 1) this.blend = null
  }
  private follow(dt: number): void {
    // The round mapping is refreshed after this by terrain.afterCamera() (wired in main.ts),
    // so the world is bent about this frame's camera, not the last one's.
    this.direct(dt)
    if (this.cinematic) {
      const camera = this.game.camera, c = this.cinematic, k = ease(clamp(dt, 0, 0.25), 2)
      this.restoreVisibility()
      // Keep the shot above the ground even if the script asks for a point inside a hill.
      const y = Math.max(c.position.y, surfaceHeight(this.terrain, c.position.x, c.position.z) + camClearance.value + 1)
      camera.position.lerp(this.desired.set(c.position.x, y, c.position.z), k)
      camera.position.y = Math.max(camera.position.y, surfaceHeight(this.terrain, camera.position.x, camera.position.z) + camClearance.value)
      c.look.lerp(c.target, k)
      // A far subject is drawn round the curve of the planet, below and nearer than its flat
      // position: aim at where it appears. No effect on a flat world or on close shots.
      curveOffset(c.look.x, c.look.y, c.look.z, this.bend)
      camera.up.set(0, 1, 0); camera.lookAt(this.lookAt.set(c.look.x + this.bend.x, c.look.y + this.bend.y, c.look.z + this.bend.z))
      camera.fov = THREE.MathUtils.lerp(camera.fov, c.fov ?? 55, k); camera.updateProjectionMatrix()
      return
    }
    const target = this.target
    if (!target) { this.restoreVisibility(); return }
    dt = clamp(dt, 0, 0.25); this.elapsed += dt
    const camera = this.game.camera, vehicle = this.vehicle?.object === target ? this.vehicle : null
    const displacement = target.position.distanceTo(this.previousPosition)
    const reset = target !== this.previousTarget || displacement > 50 || (!vehicle && dt > 0 && displacement / dt > 200)
    this.velocity.copy(vehicle?.body.linvel() ?? this.direction.copy(target.position).sub(this.previousPosition).multiplyScalar(dt > 0 ? 1 / dt : 0))
    if (reset) {
      this.direction.set(0, 0, -1).applyQuaternion(target.quaternion)
      this.yaw = Math.atan2(-this.direction.x, -this.direction.z); this.pitch = 0
      this.rotation.setFromEuler(this.euler.set(0, this.yaw, 0)); this.velocity.set(0, 0, 0)
      this.distance = camDistance.value; this.speed = 0; this.lastManual = -Infinity
    }
    // Aim by a steadier velocity than the body's own: a wheel over a rock kicks the true one
    // about, and the view should not twitch with it. At walking pace the car's own nose is
    // a better guide than a velocity that is mostly noise.
    if (reset) { this.steady.copy(this.velocity); this.pivotY = NaN; this.lift = 0; this.turn[0] = this.turn[1] = 0 }
    else this.steady.lerp(this.velocity, ease(dt, 5))
    this.previousTarget = target; this.previousPosition.copy(target.position)
    const speed = this.velocity.length(), mode = Math.round(camMode.value), first = mode === 1 || this.scopeHeld
    const flight = camFlight.value && Boolean(vehicle?.wingsOpen || vehicle?.wingOpen || vehicle?.kind === 'jet')
    this.speed = THREE.MathUtils.lerp(this.speed, speed, ease(dt, camVelocitySmoothing.value))
    this.distance = THREE.MathUtils.lerp(this.distance, camDistance.value, ease(dt, camDistanceSmoothing.value))
    this.pivot.copy(target.position)
    // A zorb ball is a larger clearance: keep the camera outside it (src/vehicles/zorb.ts).
    const offset = Math.max(vehicle?.camOffset ?? camOffset.value, vehicle?.zorb?.radius ?? 0)
    let distance = offset + this.distance * (1 + (camSpeedDistance.value ? this.speed * camSpeedMultiplier.value : 0))
    if (first) {
      const ride = vehicle?.ridePosition ?? vehicle?.ridePos
      if (ride) ride.getWorldPosition(this.pivot)
      else this.pivot.add(this.direction.set(0, camRideHeight.value, 0).applyQuaternion(target.quaternion))
      distance = 0
    } else {
      // Follow the car's height through a soft spring: the body bounces on its suspension
      // several times a second and the camera should ride over that, not with it.
      this.pivotY = Number.isFinite(this.pivotY) ? THREE.MathUtils.lerp(this.pivotY, target.position.y, ease(dt, 7)) : target.position.y
      // Never let the spring leave the car far out of frame on a big drop or climb.
      this.pivotY = clamp(this.pivotY, target.position.y - 2.5, target.position.y + 2.5)
      this.pivot.y = this.pivotY + distance * camHeight.value
    }

    // CoreCamera.cs:642-703: delay manual recentering, follow velocity above 1m/s.
    if ((mode === 0 || first) && this.elapsed - this.lastManual > camAutoDelay.value && speed > 1 && (first || flight || Math.hypot(this.velocity.x, this.velocity.z) > 1)) {
      if (first || flight) this.direction.set(0, 0, -1).applyQuaternion(target.quaternion)
      else {
        const pace = Math.hypot(this.steady.x, this.steady.z), slow = clamp(1 - (pace - 1) / 4, 0, 1)
        this.nose.set(0, 0, -1).applyQuaternion(target.quaternion)
        this.direction.copy(this.steady).normalize()
        // Backing up is not a change of direction: stay behind the car and look past its
        // nose instead of swinging the whole view round for a three point turn. The weight
        // toward the nose grows smoothly as travel opposes it, so a slide or a donut (travel
        // across the nose, not against it) never makes the aim jump. Only for a short
        // while: a car that keeps reversing really is going that way.
        const against = clamp(-(this.direction.x * this.nose.x + this.direction.z * this.nose.z) / 0.5, 0, 1)
        this.backingFor = against > 0.5 && pace < 12 ? this.backingFor + dt : Math.max(0, this.backingFor - dt * 2)
        const hold = against * clamp(3.5 - this.backingFor, 0, 1) * clamp((12 - pace) / 4, 0, 1)
        this.direction.lerp(this.nose, Math.max(hold, slow * 0.6))
      }
      this.direction.normalize()
      const wantedYaw = Math.atan2(-this.direction.x, -this.direction.z)
      let wantedPitch = Math.asin(clamp(this.direction.y, -1, 1))
      if (!first && !flight) {
        // On the ground, pitch with the hill, read from the terrain along the way the car is
        // going, not from the car's vertical speed: that is mostly suspension and bumps, and
        // following it makes the horizon nod. In the air (a jump, a drop) the car's own
        // path is the only guide, so blend back to it with height.
        const flat = Math.hypot(this.direction.x, this.direction.z) || 1, ux = this.direction.x / flat, uz = this.direction.z / flat
        const p = target.position
        const slope = Math.atan2(surfaceHeight(this.terrain, p.x + ux * 7, p.z + uz * 7) - surfaceHeight(this.terrain, p.x - ux * 4, p.z - uz * 4), 11)
        const air = clamp((p.y - surfaceHeight(this.terrain, p.x, p.z) - 2) / 4, 0, 1)
        wantedPitch = THREE.MathUtils.lerp(slope, wantedPitch, air) * camPitchDamping.value
      }
      // Turn toward the direction of travel through a critically damped spring on each angle.
      // A plain exponential ease starts turning at full rate the instant the target moves,
      // which reads as a twitch; a spring eases in as well as out, like a hand on a tripod.
      // About 0.45 s at the default: on real drives the view then trails the direction of
      // travel by about six degrees on average, close enough to see where you are going.
      const time = 1.35 / (first ? camRideRotation.value : camAutoRotation.value)
      this.yaw = this.damp(this.yaw, wantedYaw, this.turn, 0, time, dt, true)
      this.pitch = this.damp(this.pitch, wantedPitch, this.turn, 1, first || flight ? time : time * 2, dt, false)
    } else this.turn[0] = this.turn[1] = 0
    const wantedRoll = camGyro.value && (flight || first) ? this.euler.setFromQuaternion(target.quaternion, 'YXZ').z : 0
    this.euler.setFromQuaternion(this.rotation, 'YXZ')
    const roll = THREE.MathUtils.lerp(this.euler.z, wantedRoll, ease(dt, camHorizonSmoothing.value))
    this.automatic.setFromEuler(this.euler.set(this.pitch, this.yaw, roll))
    const rate = first ? camRideRotation.value : THREE.MathUtils.lerp(camRotationClose.value, camRotationFar.value, clamp(distance / 25, 0, 1))
    if (reset || vehicle?.camSmooth === false) this.rotation.copy(this.automatic)
    else this.rotation.slerp(this.automatic, ease(dt, rate))
    if (mode === 4 && !first) {
      const axis = (positive: string, negative: string) => Number(this.keys.has(positive)) - Number(this.keys.has(negative))
      this.direction.set(axis('KeyD', 'KeyA'), axis('KeyE', 'KeyQ'), -axis('KeyW', 'KeyS')).applyQuaternion(this.rotation)
      this.desired.copy(camera.position).addScaledVector(this.direction, dt * camRoamSpeed.value * (this.keys.has('ShiftLeft') ? 10 : 1))
    } else if (mode === 3 && !first && !reset) this.desired.copy(camera.position)
    else this.desired.set(0, 0, distance).applyQuaternion(this.rotation).add(this.pivot)
    const clearance = camClearance.value
    if (mode !== 4 && !first) {
      // Rise over what is in the way. Up quickly, because the ground will not wait; back
      // down slowly, so cresting a hill does not make the view bob.
      // Look where the arm will be in a third of a second as well as where it is: the lift
      // then starts before the bank or crest arrives, instead of the arm being caught by it.
      this.aheadPivot.copy(this.pivot).addScaledVector(this.steady, 0.35); this.aheadDesired.copy(this.desired).addScaledVector(this.steady, 0.35)
      const wanted = Math.max(armLift(this.terrain, this.pivot, this.desired, clearance), armLift(this.terrain, this.aheadPivot, this.aheadDesired, clearance))
      this.lift = reset ? wanted : THREE.MathUtils.lerp(this.lift, wanted, ease(dt, wanted > this.lift ? 12 : 1.5))
      this.desired.y += this.lift
    }
    camera.position.copy(constrainCamera(this.terrain, mode === 4 ? camera.position : this.pivot, this.desired, clearance, mode === 4 || first ? 0 : 0.2))
    if (mode !== 4 && !first) {
      // If the arm still has to shorten (a cliff face behind the car), pull in quickly and
      // let out slowly, so the distance never snaps and never flutters.
      const full = this.pivot.distanceTo(this.desired), ratio = full > 1e-3 ? camera.position.distanceTo(this.pivot) / full : 1
      this.arm = reset ? ratio : THREE.MathUtils.lerp(this.arm, Math.min(1, ratio), ease(dt, ratio < this.arm ? 10 : 2))
      camera.position.lerpVectors(this.pivot, this.desired, this.arm)
    }
    // The hard floor: clear of the highest ground in a ring round the lens, and of where the
    // lens will be a quarter of a second from now, so the corners of the view stay out of a
    // hillside. This is what stops the void showing through.
    if (!first) {
      const floor = Math.max(ringHeight(this.terrain, camera.position.x, camera.position.z, 1.2), surfaceHeight(this.terrain, camera.position.x + this.steady.x * 0.25, camera.position.z + this.steady.z * 0.25)) + clearance
      if (camera.position.y < floor) { this.lift += floor - camera.position.y; camera.position.y = floor }
    }
    if (mode === 3 && !first) { camera.up.set(0, 1, 0); camera.lookAt(this.pivot) }
    else camera.quaternion.copy(this.rotation)
    // CoreCamera.cs:409,525,529,773: fixed mode FOV, no speed-based FOV change.
    const fov = first ? camRideFov.value / (this.scopeHeld ? camScope.value : 1) : camFov.value
    camera.fov = reset ? fov : THREE.MathUtils.lerp(camera.fov, fov, ease(dt, camFovSmoothing.value))
    camera.near = first ? 0.1 : Math.min(0.5, camClearance.value / 2)
    camera.updateProjectionMatrix()
    // A vehicle's model loads after the vehicle exists, so its tags can appear while the whole
    // target is already hidden: look again now and then until some are found.
    if (first && (this.hiddenTarget !== target || (this.hidWhole && ++this.hideCheck >= 30))) this.hideForRide(target)
    else if (!first) this.restoreVisibility()
  }
  private hideForRide(target: THREE.Object3D): void {
    this.restoreVisibility()
    this.hiddenTarget = target
    this.hideCheck = 0
    // A vehicle modelled with a cockpit to sit in says so, and keeps every part: from its
    // own seat the driver should see the tub, the canopy and the nose around them.
    if (target.userData.cockpit === true) { this.hidWhole = false; return }
    target.traverse(o => { if (o.userData.hideInRide === true) this.hidden.push({ object: o, wasVisible: o.visible }) })
    this.hidWhole = this.hidden.length === 0
    if (this.hidWhole) this.hidden.push({ object: target, wasVisible: target.visible })
    for (const h of this.hidden) h.object.visible = false
  }
  private restoreVisibility() {
    for (const h of this.hidden) h.object.visible = h.wasVisible
    this.hidden.length = 0; this.hiddenTarget = null; this.hidWhole = false
  }
  dispose() { this.restoreVisibility(); for (const off of this.unbind) off(); this.unbind.length = 0 }
}

/** Syn3h CoreCamera port. Source and deliberate extensions are documented in tests/core/camera.md. */
import * as THREE from 'three/webgpu'
import { defineParam, params } from '../../shared/params'
import type { Terrain } from '../world/Terrain'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Game, System } from './Game'
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.1) => defineParam({ id: `camera.${id}`, label, group: 'Camera', scope: 'client', default: value, min, max, step })
const boolean = (id: string, label: string, value: boolean) => defineParam({ id: `camera.${id}`, label, group: 'Camera', scope: 'client', default: value })
// _Runtime.prefab:8755-8795, terra.buggy.prefab:586, CoreCamera.cs:177.
export const camDistance = number('distance', 'Orbit distance', 6.25, 0, 25, 0.25)
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
export const camClearance = number('clearance', 'Terrain clearance', 0.5, 0.1, 3)
export const camAutoDelay = number('autoDelay', 'Resume chase after look', 3, 0, 10)
export const camPitchDamping = number('pitchDamping', 'Travel pitch response', 1, 0, 1)
export const camSpeedDistance = boolean('speedDistance', 'Enable repaired speed distance', false)
export const camSpeedMultiplier = number('speedMultiplier', 'Speed distance multiplier', 0.05, 0, 0.1, 0.005)
export const camFlight = boolean('flight', 'Flight camera', true)
export const camGyro = boolean('gyro', 'Follow vehicle roll', false)
export const camHorizonSmoothing = number('horizonSmoothing', 'Horizon smoothing', 20, 1, 30)
export const camSensitivity = number('sensitivity', 'Mouse rotation multiplier', 4, 0.1, 10)
export const camScope = number('scope', 'Scope magnification', 3.25, 1.5, 5, 0.25)
export const camRoamSpeed = number('roamSpeed', 'Roam speed', 2, 0.25, 25)
export const camRideHeight = number('rideHeight', 'Fallback ride height', 0.95, 0, 5)

export interface CameraVehicle extends Vehicle {
  wingOpen?: boolean
  camSmooth?: boolean
  camOffset?: number
  ridePosition?: THREE.Object3D
  ridePos?: THREE.Object3D
}
const ease = (dt: number, rate: number) => 1 - Math.exp(-Math.max(0, dt) * rate)
const clamp = THREE.MathUtils.clamp

/** Sample the whole camera arm, not just its endpoint, so hills cannot hide the car. */
export function constrainCamera(terrain: Pick<Terrain, 'heightAt'>, pivot: THREE.Vector3, desired: THREE.Vector3, clearance: number): THREE.Vector3 {
  const result = desired.clone(), distance = pivot.distanceTo(desired)
  const steps = Math.min(160, Math.max(1, Math.ceil(distance / 0.25)))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = THREE.MathUtils.lerp(pivot.x, desired.x, t), z = THREE.MathUtils.lerp(pivot.z, desired.z, t)
    const y = THREE.MathUtils.lerp(pivot.y, desired.y, t)
    if (y < terrain.heightAt(x, z) + clearance) { result.lerpVectors(pivot, desired, Math.max(0, (i - 1) / steps)); break }
  }
  // Final clamp is essential after collision shortening, teleports and interpolation.
  result.y = Math.max(result.y, terrain.heightAt(result.x, result.z) + clearance)
  return result
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
  private yaw = 0
  private pitch = 0
  private distance = camDistance.value
  private speed = 0
  private elapsed = 0
  private lastManual = -Infinity
  private dragging = false
  private scopeHeld = false
  private hiddenTarget: THREE.Object3D | null = null
  private hiddenWasVisible = true

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
      if (event.code === 'Equal' || event.code === 'Minus') params.set(camDistance.def.id, camDistance.value + (event.code === 'Minus' ? 1 : -1))
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
    listen(window, 'pointermove', ((event: PointerEvent) => {
      if ((!this.dragging && document.pointerLockElement !== game.canvas) || this.game.input.suspended) return
      const sensitivity = camSensitivity.value * (this.scopeHeld ? 0.75 / 4 : 1) * Math.PI / 180 * 0.1
      this.yaw -= event.movementX * sensitivity; this.pitch = clamp(this.pitch - event.movementY * sensitivity, -Math.PI * 0.49, Math.PI * 0.49)
      this.lastManual = this.elapsed
    }) as EventListener)
    listen(game.canvas, 'wheel', ((event: WheelEvent) => {
      event.preventDefault()
      const param = this.scopeHeld ? camScope : Math.round(camMode.value) === 4 ? camRoamSpeed : camDistance
      params.set(param.def.id, param.value + Math.sign(event.deltaY) * (this.scopeHeld ? -0.25 : 1))
    }) as EventListener, { passive: false })
  }

  setVehicle(vehicle: CameraVehicle | null): void { this.vehicle = vehicle; this.target = vehicle?.object ?? null }

  update(dt: number): void {
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
    this.previousTarget = target; this.previousPosition.copy(target.position)
    const speed = this.velocity.length(), mode = Math.round(camMode.value), first = mode === 1 || this.scopeHeld
    const flight = camFlight.value && Boolean(vehicle?.wingsOpen || vehicle?.wingOpen || vehicle?.kind === 'jet')
    this.speed = THREE.MathUtils.lerp(this.speed, speed, ease(dt, camVelocitySmoothing.value))
    this.distance = THREE.MathUtils.lerp(this.distance, camDistance.value, ease(dt, camDistanceSmoothing.value))
    this.pivot.copy(target.position)
    const offset = vehicle?.camOffset ?? camOffset.value
    let distance = offset + this.distance * (1 + (camSpeedDistance.value ? this.speed * camSpeedMultiplier.value : 0))
    if (first) {
      const ride = vehicle?.ridePosition ?? vehicle?.ridePos
      if (ride) ride.getWorldPosition(this.pivot)
      else this.pivot.add(this.direction.set(0, camRideHeight.value, 0).applyQuaternion(target.quaternion))
      distance = 0
    } else this.pivot.y += distance * camHeight.value

    // CoreCamera.cs:642-703: delay manual recentering, follow velocity above 1m/s.
    if ((mode === 0 || first) && this.elapsed - this.lastManual > camAutoDelay.value && speed > 1 && (first || flight || Math.hypot(this.velocity.x, this.velocity.z) > 1)) {
      this.direction.copy(first || flight ? this.direction.set(0, 0, -1).applyQuaternion(target.quaternion) : this.velocity).normalize()
      const wantedYaw = Math.atan2(-this.direction.x, -this.direction.z)
      const wantedPitch = Math.asin(clamp(this.direction.y, -1, 1)) * (first || flight ? 1 : camPitchDamping.value)
      this.autoTarget.setFromEuler(this.euler.set(wantedPitch, wantedYaw, 0))
      this.automatic.copy(this.rotation).slerp(this.autoTarget, ease(dt, first ? camRideRotation.value : camAutoRotation.value))
      this.euler.setFromQuaternion(this.automatic, 'YXZ'); this.yaw = this.euler.y; this.pitch = this.euler.x
    }
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
    camera.position.copy(constrainCamera(this.terrain, mode === 4 ? camera.position : this.pivot, this.desired, camClearance.value))
    if (mode === 3 && !first) { camera.up.set(0, 1, 0); camera.lookAt(this.pivot) }
    else camera.quaternion.copy(this.rotation)
    // CoreCamera.cs:409,525,529,773: fixed mode FOV, no speed-based FOV change.
    const fov = first ? camRideFov.value / (this.scopeHeld ? camScope.value : 1) : camFov.value
    camera.fov = reset ? fov : THREE.MathUtils.lerp(camera.fov, fov, ease(dt, camFovSmoothing.value))
    camera.near = first ? 0.1 : Math.min(0.5, camClearance.value / 2)
    camera.updateProjectionMatrix()
    if (first && this.hiddenTarget !== target) { this.restoreVisibility(); this.hiddenTarget = target; this.hiddenWasVisible = target.visible; target.visible = false }
    else if (!first) this.restoreVisibility()
  }
  private restoreVisibility() { if (this.hiddenTarget) this.hiddenTarget.visible = this.hiddenWasVisible; this.hiddenTarget = null }
  dispose() { this.restoreVisibility(); for (const off of this.unbind) off(); this.unbind.length = 0 }
}

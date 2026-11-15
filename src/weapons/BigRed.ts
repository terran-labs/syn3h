/**
 * Big Red's controls: with Big Red in hand, hold the tag control to charge a red glow at the
 * nose; once it is full, let go to send the beam. Letting go early fizzles. The beam itself is
 * a red kind of tag beam (Lasers.ts, shot.k = 'red'): it tags, and shoves what it touches.
 * Aims where the camera looks while the cursor is captured, straight ahead otherwise.
 */
import * as THREE from 'three/webgpu'
import type { Game, System } from '../core/Game'
import type { RAPIER } from '../core/physics'
import { hotExposureDim } from '../vehicles/skins/hotExposure'
import { aimFrom, type GearControl } from './aim'
import { bigRedAllowed, bigRedCharge, bigRedCooldown } from './bigRedParams'

export interface BigRedHooks {
  control?(): GearControl

  body(): RAPIER.RigidBody | undefined
  object(): THREE.Object3D | undefined
  inHand(): boolean
  /** Send a Big Red along unit `d` from the local vehicle. */
  fire(d: [number, number, number]): void
  cue?(name: 'bigRedCharge' | 'bigRedReady' | 'bigRedFizzle', at: THREE.Vector3): void
}

// Kept low in green and blue so tone mapping leaves it red, not peach.
const GLOW_RGB = [2.4, 0.12, 0.06] as const
/** Short pause after a fizzle, so a mashed button does not stutter. */
const FIZZLE_PAUSE = 0.2

export class BigRed implements System {
  /** 0 to 1 while charging; -1 when not. */
  charge = -1
  private fireWas = false
  private readyAt = 0
  private readonly glow: THREE.Mesh
  private readonly mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...GLOW_RGB), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  // The tag beam's recipe: additive light alone washes to salmon over an orange sky, so a
  // normally blended deep red core keeps it reading red at noon.
  private readonly core: THREE.Mesh
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.01, 0.01), transparent: true, opacity: 0.75, depthWrite: false })
  stats = { sent: 0, fizzled: 0 }

  constructor(private readonly game: Game, private readonly hooks: BigRedHooks) {
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.mat)
    this.glow.visible = false
    this.core = new THREE.Mesh(this.glow.geometry, this.coreMat)
    this.core.scale.setScalar(0.6)
    this.core.renderOrder = -1
    this.glow.add(this.core)
    game.scene.add(this.glow)
  }

  /** True when a full charge is waiting for release. */
  get ready(): boolean {
    return this.charge >= 1
  }

  fixedUpdate(dt: number): void {
    const fire = bigRedAllowed.value && this.hooks.inHand() && (this.hooks.control?.().fire ?? this.game.input.state.fire)
    const pressed = fire && !this.fireWas
    const released = !fire && this.fireWas
    this.fireWas = fire
    if (pressed && this.game.time >= this.readyAt) {
      this.charge = 0
      const o = this.hooks.object()
      if (o) this.hooks.cue?.('bigRedCharge', o.position)
    }
    if (fire && this.charge >= 0 && this.charge < 1) {
      this.charge = Math.min(1, this.charge + dt / Math.max(0.05, bigRedCharge.value))
      const o = this.hooks.object()
      if (this.charge >= 1 && o) this.hooks.cue?.('bigRedReady', o.position)
    }
    if (released && this.charge >= 0) this.letGo()
  }

  /** Release: send it if charged, fizzle if not. Public for automated checks. */
  letGo(): boolean {
    const body = this.hooks.body()
    const full = this.charge >= 1
    this.charge = -1
    if (!full || !body) {
      this.stats.fizzled++
      this.readyAt = this.game.time + FIZZLE_PAUSE
      const o = this.hooks.object()
      if (o) this.hooks.cue?.('bigRedFizzle', o.position)
      return false
    }
    const aim = aimFrom(this.game, body, 400, 0.4, 2.4, 0, !this.hooks.control)
    if (this.hooks.control) aim.d.set(...this.hooks.control().direction).normalize()
    this.hooks.fire([aim.d.x, aim.d.y, aim.d.z])
    this.stats.sent++
    this.readyAt = this.game.time + bigRedCooldown.value
    return true
  }

  /** Cancel without firing when authority, target or selected gear changes. */
  cancel(): void {
    this.charge = -1
    this.fireWas = false
  }

  update(): void {
    const o = this.hooks.object()
    if (this.charge < 0 || !o) { this.glow.visible = false; return }
    const dim = hotExposureDim(this.game.renderer.toneMappingExposure)
    this.mat.color.setRGB(GLOW_RGB[0] * dim, GLOW_RGB[1] * dim, GLOW_RGB[2] * dim)
    const t = this.game.time
    // Grows while charging, then throbs when ready.
    const pulse = this.charge >= 1 ? 1 + 0.18 * Math.sin(t * 22) : 1 + 0.05 * Math.sin(t * 40)
    this.glow.scale.setScalar((0.25 + 0.85 * this.charge) * pulse)
    this.glow.position.copy(o.position).add(new THREE.Vector3(0, 1.9, -1.2).applyQuaternion(o.quaternion))
    this.glow.visible = true
  }

  dispose(): void {
    this.game.scene.remove(this.glow)
    this.glow.geometry.dispose()
    this.mat.dispose()
    this.coreMat.dispose()
  }
}

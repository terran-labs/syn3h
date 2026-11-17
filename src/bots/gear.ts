import { Quaternion, Vector3 } from 'three/webgpu'
import type { InputState } from '../core/Input'
import type { Vehicle } from '../vehicles/Vehicle'
import { nearestImage } from '../../shared/wrap'
import { hashString } from './random'

export interface BotGearOption {
  id: 'bungee' | 'yoink' | 'red' | 'pester'
  range: number
  cooldown: number
  chargeSeconds?: number
}
export interface BotGearAction {
  gear: BotGearOption['id']
  target: Vehicle
  phase: 'press' | 'hold' | 'release' | 'cancel'
  /** Aim this many metres above the target's centre: its roof, when the centre is out of sight. */
  aimUp?: number
  /** Bungee 'hold' only: false keeps the cord attached without reeling in (a towed vehicle). */
  reel?: boolean
}
export interface BotGearHooks {
  available(vehicle: Vehicle): readonly BotGearOption[]
  threats(vehicle: Vehicle): readonly { id: string; position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }[]
  act(vehicle: Vehicle, action: BotGearAction): void
}

/** Decisions only. The gear owner validates and executes actions, including their effects. */
export class BotGearController {
  private hooks: BotGearHooks | null = null
  private active: { option: BotGearOption; target: Vehicle; held: number } | null = null
  private wait = 0
  private candidate: Vehicle | null = null
  private seenFor = 0
  private sequence = 0
  private threatId: string | null = null
  private threatTime = 0
  private dodge = 0
  private readonly seed: number
  private readonly forward = new Vector3()
  private readonly rotation = new Quaternion()
  constructor(
    private readonly vehicle: Vehicle,
    private readonly wrapSize: () => number | undefined,
    private readonly clearShot: (target: Vehicle) => boolean,
    private readonly safe: (x: number, z: number) => boolean,
  ) { this.seed = hashString(`gear:${vehicle.id}`) >>> 0 }

  setHooks(hooks: BotGearHooks | null) {
    if (hooks === this.hooks) return
    this.cancel()
    this.hooks = hooks
    this.wait = 0.6 + this.seed % 9 * 0.1
    this.candidate = null; this.seenFor = 0; this.dodge = 0
    this.threatId = null; this.threatTime = 0
  }
  cancel() {
    if (this.active) {
      this.hooks?.act(this.vehicle, { gear: this.active.option.id, target: this.active.target, phase: 'cancel' })
      this.wait = Math.max(this.wait, 1.5)
    }
    this.active = null
  }
  step(dt: number, target: Vehicle | null, input: InputState, mayFire: boolean, mayDrive: boolean) {
    if (!this.hooks) return
    dt = Math.max(0, Math.min(dt, 0.1))
    this.wait = Math.max(0, this.wait - dt)
    if (!this.vehicle.body.isValid()) { this.cancel(); return }
    this.rotation.copy(this.vehicle.body.rotation())
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation)
    if (mayDrive) this.avoid(dt, input)
    else { this.dodge = 0; this.threatId = null; this.threatTime = 0 }
    const options = this.hooks.available(this.vehicle).filter(o => Number.isFinite(o.range) && o.range > 0 && Number.isFinite(o.cooldown) && o.cooldown >= 0 && (o.chargeSeconds === undefined || Number.isFinite(o.chargeSeconds) && o.chargeSeconds >= 0))
    if (!mayFire || !target?.body.isValid() || target === this.vehicle) { this.cancel(); this.candidate = null; this.seenFor = 0; return }
    const here = this.vehicle.body.translation(), raw = target.body.translation(), wrap = this.wrapSize()
    const x = wrap ? nearestImage(raw.x, here.x, wrap) : raw.x, z = wrap ? nearestImage(raw.z, here.z, wrap) : raw.z
    const dx = x - here.x, dy = raw.y - here.y, dz = z - here.z, distance = Math.hypot(dx, dy, dz)
    const aimed = distance > 1 && (dx * this.forward.x + dy * this.forward.y + dz * this.forward.z) / distance > 0.85
    const usable = options.filter(o => distance <= o.range)
    if (!aimed || !usable.length || !this.clearShot(target)) { this.cancel(); this.seenFor = 0; return }
    if (this.active) {
      const a = this.active
      if (a.target !== target || !usable.some(o => o.id === a.option.id)) { this.cancel(); return }
      input.fire = false
      a.held += dt
      // Three physics steps cover executor ordering and floating point charge accumulation.
      const duration = a.option.id === 'red' ? Math.max(0.05, a.option.chargeSeconds ?? 1.5) + 0.06 : a.option.id === 'yoink' ? 0.8 : a.option.id === 'bungee' ? 1.2 : 0
      if (a.held >= duration) {
        this.hooks.act(this.vehicle, { gear: a.option.id, target, phase: a.option.id === 'bungee' ? 'cancel' : 'release' })
        this.wait = Math.max(1.5, a.option.cooldown) + this.seed % 5 * 0.1
        this.active = null; this.seenFor = 0
      } else this.hooks.act(this.vehicle, { gear: a.option.id, target, phase: 'hold' })
      return
    }
    if (this.candidate !== target) { this.candidate = target; this.seenFor = 0 }
    this.seenFor += dt
    if (this.wait > 0 || this.seenFor < 0.4 + this.seed % 4 * 0.1) return
    const option = usable[(this.seed + this.sequence++) % usable.length]
    this.active = { option: { ...option }, target, held: 0 }
    input.fire = false
    this.hooks.act(this.vehicle, { gear: option.id, target, phase: 'press' })
  }

  private avoid(dt: number, input: InputState) {
    // Wheel steering only. Aircraft use pitch/throttle on these axes and need their pilot.
    if (this.vehicle.kind === 'jet' || this.vehicle.kind === 'hovercraft') return
    const here = this.vehicle.body.translation(), velocity = this.vehicle.body.linvel(), wrap = this.wrapSize()
    let closest = 30, threat: ReturnType<BotGearHooks['threats']>[number] | null = null
    for (const t of this.hooks!.threats(this.vehicle)) {
      const dx = (wrap ? nearestImage(t.position.x, here.x, wrap) : t.position.x) - here.x
      const dz = (wrap ? nearestImage(t.position.z, here.z, wrap) : t.position.z) - here.z
      const d = Math.hypot(dx, dz)
      const closing = dx * (t.velocity.x - velocity.x) + dz * (t.velocity.z - velocity.z) < 0
      if (closing && d < closest && Math.abs(t.position.y - here.y) < 8) { closest = d; threat = t }
    }
    if (this.threatId !== (threat?.id ?? null)) { this.threatId = threat?.id ?? null; this.threatTime = 0 }
    this.threatTime += dt
    let desired = 0
    if (threat && this.threatTime > 0.35 + this.seed % 4 * 0.1 && input.y > 0) {
      const speed = Math.hypot(velocity.x, velocity.z), look = Math.max(8, Math.min(24, speed * 1.2))
      const first = this.seed % 2 ? 1 : -1
      for (const side of [first, -first]) {
        let safe = true
        for (const fraction of [0.33, 0.66, 1]) {
          const x = here.x + this.forward.x * look * fraction - this.forward.z * side * 4 * fraction
          const z = here.z + this.forward.z * look * fraction + this.forward.x * side * 4 * fraction
          if (!this.safe(x, z)) { safe = false; break }
        }
        if (safe) { desired = side * 0.3; break }
      }
    }
    this.dodge += Math.max(-dt, Math.min(dt, desired - this.dodge))
    // Recheck the residual turn while easing out: a safe route last step may now be a cliff.
    if (Math.abs(this.dodge) > 0.001) {
      const side = Math.sign(this.dodge), look = Math.max(8, Math.min(24, Math.hypot(velocity.x, velocity.z) * 1.2))
      if (![0.33, 0.66, 1].every(f => this.safe(here.x + this.forward.x * look * f - this.forward.z * side * 4 * f, here.z + this.forward.z * look * f + this.forward.x * side * 4 * f))) this.dodge = 0
    }
    input.x = Math.max(-1, Math.min(1, input.x + this.dodge))
  }
}

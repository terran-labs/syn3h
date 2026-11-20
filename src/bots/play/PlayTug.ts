/**
 * One bot's playful grab (src/bots/play/PlayDirector.ts): drive up beside the person, fire the
 * hook when close and facing them, reel in for a few seconds, then let go. Unlike a rescue tow
 * (rescue/TowRescue.ts) the person is free and moving the whole time, so there is no "freed"
 * to wait for: it lets go on time, or as soon as it is told to.
 *
 * Drives through a pilot and fires through the rescue's TowGear, the same networked gear as a
 * person's. One `step` per physics step.
 */
import { Quaternion, Vector3 } from 'three/webgpu'
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { DriveGoal, Pilot } from '../pilot/types'
import type { TowGear } from '../rescue/TowRescue'

/** Close enough to fire, metres; and the cone it must be facing them in (cosine). */
const FIRE_WITHIN = 30
const FACING = 0.8
/** Seconds to get a hook on before giving up; seconds the cord stays on once tied. */
const REACH_S = 20
const HOOK_WAIT_S = 2

export class PlayTug {
  phase: 'approach' | 'hook' | 'reel' | 'done' = 'approach'
  private time = 0
  private phaseTime = 0
  private readonly goal: DriveGoal = { x: 0, z: 0, speed: 0 }
  private readonly q = new Quaternion()
  private readonly forward = new Vector3()

  constructor(readonly bot: Vehicle, readonly target: Vehicle, private readonly gear: TowGear, private readonly pilot: Pilot, private readonly pull: { x: number; z: number }, private readonly hold: number) {}

  get finished(): boolean { return this.phase === 'done' }

  step(dt: number, input: InputState): void {
    if (this.finished) return
    this.time += dt; this.phaseTime += dt
    if (!this.target.body.isValid() || !this.bot.body.isValid()) { this.letGo(); return }
    const b = this.bot.body.translation(), t = this.target.body.translation()
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz) || 1
    this.q.copy(this.bot.body.rotation())
    this.forward.set(0, 0, -1).applyQuaternion(this.q)
    const facing = (this.forward.x * dx + this.forward.z * dz) / d
    if (this.phase === 'approach') {
      // Come in from the pull side, a little way off, and match the person's pace.
      this.goal.x = t.x + this.pull.x * 12; this.goal.z = t.z + this.pull.z * 12
      const v = this.target.body.linvel()
      this.goal.speed = Math.max(6, Math.hypot(v.x, v.z) + 4); this.goal.stopWithin = undefined
      this.pilot.drive(this.goal, input, dt)
      if (d < FIRE_WITHIN && facing > FACING) { this.gear.fire(this.target); this.set('hook') }
      else if (this.time > REACH_S) this.letGo()
      return
    }
    if (this.phase === 'hook') {
      this.brake(input)
      if (this.gear.attachedTo(this.target)) this.set('reel')
      else if (!this.gear.flying() && this.phaseTime > HOOK_WAIT_S) this.letGo()
      return
    }
    // Reeling: a playful tug, then let go on time.
    this.gear.reel(this.target)
    this.goal.x = b.x + this.pull.x * 20; this.goal.z = b.z + this.pull.z * 20; this.goal.speed = 4
    this.pilot.drive(this.goal, input, dt)
    if (!this.gear.attachedTo(this.target) || this.phaseTime >= this.hold) this.letGo()
  }

  /** Let go now (told to, done, or the person broke free). */
  letGo(): void {
    if (this.finished) return
    this.gear.release(this.target)
    this.phase = 'done'
  }

  private brake(input: InputState): void { input.y = 0; input.x = 0; input.brakes = true }
  private set(phase: PlayTug['phase']): void { this.phase = phase; this.phaseTime = 0 }
}

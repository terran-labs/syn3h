import type { RaceState, RaceUpdate } from '../../shared/protocol'
import { nearestImage, wrapCoord } from '../../shared/wrap'
import type { Terrain } from '../world/Terrain'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Navigator } from './pilot/types'
import type { PointOfInterest } from './nav'
import { GROUND_PROFILE } from './pilot/ground'

export interface BotRaceCandidate { id: number; vehicle: Vehicle; active: boolean; human: boolean }
export interface BotRaceHooks {
  /** Synchronized room clock in seconds. Install hooks only after clock synchronization. */
  now(): number
  /** Initially the actively driving host and its bots. Never lobby spectators. */
  candidates(): readonly BotRaceCandidate[]
  publish(update: RaceUpdate): void
}
const COUNTDOWN = 5, RUN = 120, RESULT = 8, COOLDOWN = 90
const groundVehicle = (v: Vehicle) => v.kind !== 'jet' && v.kind !== 'hovercraft'

/** Host-only race decisions. The room accepts transitions; this never advances on UI time. */
export class BotRaces {
  private hooks: BotRaceHooks | null = null
  private state: RaceUpdate | null = null
  private acknowledged = false
  private sentAt = 0
  private endsAt = 0
  private nextAt = 0
  private serial = 0
  private readonly previous = new Map<number, { x: number; y: number; z: number }>()
  constructor(private readonly terrain: Terrain, private readonly navigator: Navigator, private readonly places: () => readonly PointOfInterest[]) {}
  setHooks(hooks: BotRaceHooks | null) {
    if (hooks === this.hooks) return
    this.hooks = hooks; this.state = null; this.acknowledged = false; this.previous.clear()
    this.nextAt = hooks ? hooks.now() + 30 : Infinity
  }
  /** Accept server corrections, withdrawals and cancellations, including reconnect snapshots. */
  apply(state: RaceState | null) {
    if (!this.hooks) return
    if (!state) {
      if (this.state) this.nextAt = Math.max(this.nextAt, this.hooks.now() + COOLDOWN)
      this.state = null; this.previous.clear(); return
    }
    // A host must not adopt another host's simulation after transfer.
    if (!this.state || state.id !== this.state.id || state.revision < this.state.revision) return
    this.state = { ...state, destination: { ...state.destination }, participants: state.participants.map(p => ({ ...p })) }
    this.endsAt = state.updatedAt + state.remainingMs / 1000
    this.acknowledged = true
    if (state.phase === 'finished' || state.phase === 'cancelled') this.nextAt = Math.max(this.nextAt, state.updatedAt + COOLDOWN)
  }
  cancel(reason = 'world-changed') {
    if (this.state && this.state.phase !== 'finished' && this.state.phase !== 'cancelled') this.transition('cancelled', RESULT, null, reason)
  }
  /** Destination for a participating bot. Countdown asks it to wait; humans keep control. */
  goal(vehicle: Vehicle): { countdown: boolean; destination: RaceUpdate['destination'] } | null {
    if (!this.state || !this.acknowledged || !['countdown', 'running'].includes(this.state.phase)) return null
    const candidate = this.hooks?.candidates().find(c => !c.human && c.vehicle === vehicle)
    if (!candidate || !this.state.participants.some(p => p.id === candidate.id && p.status === 'racing')) return null
    return { countdown: this.state.phase === 'countdown', destination: this.state.destination }
  }
  update() {
    if (!this.hooks) return
    const now = this.hooks.now()
    if (!Number.isFinite(now)) return
    if (!this.state) {
      if (!this.hooks.candidates().some(c => c.human && c.active && c.vehicle.body.isValid() && groundVehicle(c.vehicle))) {
        this.nextAt = Math.max(this.nextAt, now + 30)
        return
      }
      if (now < this.nextAt) return
      this.nextAt = now + 10
      this.start(now)
      return
    }
    if (!this.acknowledged) {
      // A rejected/disconnected publication must not leave bots controlled indefinitely.
      if (now - this.sentAt > 5) { this.state = null; this.previous.clear(); this.nextAt = now + COOLDOWN }
      return
    }
    const state = this.state
    if (state.phase === 'finished' || state.phase === 'cancelled') {
      if (now >= this.endsAt) { this.state = null; this.previous.clear() }
      return
    }
    const candidates = this.hooks.candidates()
    let changed = false
    for (const p of state.participants) if (p.status === 'racing' && !candidates.some(c => c.id === p.id && c.active && c.vehicle.body.isValid() && groundVehicle(c.vehicle))) { p.status = 'withdrawn'; changed = true }
    const racing = state.participants.filter(p => p.status === 'racing')
    if (racing.length < 2 || !racing.some(p => candidates.some(c => c.id === p.id && c.human))) { this.cancel('no-contest'); return }
    if (changed) { this.publish(); return }
    if (state.phase === 'countdown') {
      if (now >= this.endsAt) { this.previous.clear(); this.transition('running', Math.max(0, RUN - Math.max(0, now - this.endsAt))) }
      return
    }
    if (now >= this.endsAt) { this.transition('finished', RESULT, null, 'timeout'); return }
    const goal = state.destination
    let winner: number | null = null, earliest = Infinity
    for (const p of racing) {
      const c = candidates.find(c => c.id === p.id)!, raw = c.vehicle.body.translation(), w = this.terrain.wrapSize
      const here = { x: w ? nearestImage(raw.x, goal.x, w) : raw.x, y: raw.y, z: w ? nearestImage(raw.z, goal.z, w) : raw.z }
      const old = this.previous.get(p.id) ?? here
      this.previous.set(p.id, here)
      // A recovery teleport cannot win. The next ordinary step may cross the finish.
      if (Math.hypot(here.x - old.x, here.y - old.y, here.z - old.z) > 15) continue
      const dx = here.x - old.x, dz = here.z - old.z, length2 = dx * dx + dz * dz
      const ox = old.x - goal.x, oz = old.z - goal.z
      // Count entry through the finish circle, not merely being parked inside after a reset.
      const outside = ox * ox + oz * oz - goal.radius * goal.radius
      if (outside <= 0 || length2 < 1e-8) continue
      const dot = ox * dx + oz * dz, discriminant = dot * dot - length2 * outside
      if (discriminant < 0) continue
      const t = (-dot - Math.sqrt(discriminant)) / length2
      const y = old.y + t * (here.y - old.y)
      if (t >= 0 && t <= 1 && Math.abs(y - goal.y) < 6 && (t < earliest || t === earliest && p.id < (winner ?? Infinity))) { winner = p.id; earliest = t }

    }
    if (winner !== null) {
      state.participants.find(p => p.id === winner)!.status = 'finished'
      this.transition('finished', RESULT, winner)
    }
  }
  private publish() {
    if (!this.state || !this.hooks) return
    this.state.revision++
    this.state.remainingMs = Math.max(0, Math.round((this.endsAt - this.hooks.now()) * 1000))
    this.acknowledged = false
    this.sentAt = this.hooks.now()
    this.hooks.publish({ ...this.state, destination: { ...this.state.destination }, participants: this.state.participants.map(p => ({ ...p })) })
  }
  private transition(phase: RaceUpdate['phase'], seconds: number, winnerId: number | null = null, reason?: string) {
    if (!this.state || !this.hooks) return
    this.state.phase = phase; this.state.winnerId = winnerId; this.state.reason = reason
    this.endsAt = this.hooks.now() + seconds
    if (phase === 'finished' || phase === 'cancelled') this.nextAt = this.hooks.now() + COOLDOWN
    this.publish()
  }
  private start(now: number) {
    const all = this.hooks!.candidates().filter(c => c.active && c.vehicle.body.isValid() && groundVehicle(c.vehicle)).sort((a, b) => a.id - b.id)
    const human = all.find(c => c.human)
    if (!human) return
    const w = this.terrain.wrapSize, raw = human.vehicle.body.translation()
    const from = { x: w ? wrapCoord(raw.x, w) : raw.x, y: raw.y, z: w ? wrapCoord(raw.z, w) : raw.z }
    const nearby = all.filter(c => {
      const p = c.vehicle.body.translation()
      return Math.hypot((w ? nearestImage(p.x, from.x, w) : p.x) - from.x, (w ? nearestImage(p.z, from.z, w) : p.z) - from.z) < 60
    }).slice(0, 4)
    if (!nearby.includes(human) || nearby.length < 2) return
    const distanceTo = (p: { x: number; z: number }) => Math.hypot((w ? nearestImage(p.x, from.x, w) : p.x) - from.x, (w ? nearestImage(p.z, from.z, w) : p.z) - from.z)
    // Avoid shorelines and hazards. A finish needs space around it, not just a dry centre.
    for (const place of this.places().filter(p => p.kind !== 'shore' && p.kind !== 'vent').slice().sort((a, b) => Math.abs(distanceTo(a) - 150) - Math.abs(distanceTo(b) - 150)).slice(0, 8)) {
      const distance = distanceTo(place)
      if (distance < 80 || distance > 250) continue
      let safe = true
      for (let i = 0; i < 8; i++) {
        const x = place.x + Math.cos(i * Math.PI / 4) * 10, z = place.z + Math.sin(i * Math.PI / 4) * 10
        if (!this.navigator.passable(x, z, GROUND_PROFILE) || this.terrain.heightAt(x, z) < (this.terrain.liquidHeightAt?.(x, z) ?? -Infinity) + 0.5) { safe = false; break }
      }
      if (!safe || !this.navigator.passable(place.x, place.z, GROUND_PROFILE)) continue
      const eligible = nearby.filter(c => {
        const p = c.vehicle.body.translation()
        const start = { x: w ? wrapCoord(p.x, w) : p.x, z: w ? wrapCoord(p.z, w) : p.z }
        const route = this.navigator.route(start, place, GROUND_PROFILE)
        if (!route?.reached || !route.points.length) return false
        const length = route.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - route.points[i].x, p.z - route.points[i].z), 0)
        // The grid may route the long way round a seam. Do not announce a two-minute race
        // that requires circumnavigating the planet; use only routes the planner can deliver.
        return length <= 500 && Math.hypot(route.points.at(-1)!.x - place.x, route.points.at(-1)!.z - place.z) < 12
      })
      if (!eligible.includes(human) || eligible.length < 2) continue
      this.state = { id: `race-${human.id}-${Math.floor(now * 1000)}-${++this.serial}`, revision: 0, phase: 'countdown', remainingMs: COUNTDOWN * 1000, destination: { label: place.name ?? 'Landmark', x: place.x, y: this.terrain.heightAt(place.x, place.z), z: place.z, radius: 10 }, participants: eligible.map(c => ({ id: c.id, name: c.vehicle.name, status: 'racing' })), winnerId: null }
      this.endsAt = now + COUNTDOWN
      this.publish()
      return
    }
  }
}

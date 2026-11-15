import type { Vehicle } from '../../vehicles/Vehicle'
import type { Terrain } from '../../world/Terrain'
import type { BotGearHooks } from '../gear'
import type { DriveGoal, NavProfile, Navigator } from '../pilot/types'
import { nearestImage } from '../../../shared/wrap'
import { hashString } from '../random'

type Threat = ReturnType<BotGearHooks['threats']>[number]
export type ThreatSource = () => readonly Threat[]
type Point = { x: number; z: number }

/** A brief pilot destination, never a force or a replacement activity. */
export class PilotEvasion {
  private source: ThreatSource | null = null
  private time = 0
  private sampleAt = 0
  private seenAt = 0
  private observed: Threat | null = null
  private impactIn = Infinity
  private cooldown = 0
  private active: (Point & { until: number; id: string; height: number; speed: number }) | null = null
  private readonly used = new Set<string>()
  private readonly seed: number
  constructor(private readonly vehicle: Vehicle, private readonly terrain: Terrain,
    private readonly profile: NavProfile, private readonly navigator?: Navigator,
    private readonly others?: () => readonly Vehicle[]) { this.seed = hashString(vehicle.id) >>> 0 }
  setSource(source: ThreatSource | null) {
    if (this.source === source) return
    this.source = source; this.reset()
  }
  reset() { this.active = this.observed = null; this.used.clear(); this.time = this.sampleAt = this.seenAt = this.cooldown = 0; this.impactIn = Infinity }
  apply(dt: number, goal: DriveGoal): boolean {
    if (!this.source || !this.vehicle.body.isValid()) { this.reset(); return false }
    this.time += Math.max(0, Math.min(dt, .1))
    if (this.time >= this.sampleAt) {
      this.sampleAt = this.time + .2
      const threats = this.source()
      if (this.active && !threats.some(t => t.id === this.active!.id)) this.active = null
      const next = this.closest(threats)
      if (next?.id !== this.observed?.id) this.seenAt = this.time
      this.observed = next
    }
    if (this.active && (this.time >= this.active.until || !this.safe(this.active))) this.active = null
    if (!this.active && this.observed && this.impactIn <= 1 && !this.used.has(this.observed.id) && this.time >= this.cooldown && this.time - this.seenAt >= .4 + this.seed % 4 * .1) {
      const t = this.observed, here = this.vehicle.body.translation(), velocity = this.vehicle.body.linvel()
      const length = Math.hypot(t.velocity.x, t.velocity.z)
      const wrap = this.terrain.wrapSize
      const dx = (wrap ? nearestImage(t.position.x,here.x,wrap) : t.position.x)-here.x
      const dz = (wrap ? nearestImage(t.position.z,here.z,wrap) : t.position.z)-here.z
      const missX = dx+(t.velocity.x-velocity.x)*this.impactIn
      const missZ = dz+(t.velocity.z-velocity.z)*this.impactIn
      const outward = t.velocity.z*missX-t.velocity.x*missZ
      const preferred = Math.abs(outward) > .01 ? Math.sign(outward) : this.seed % 2 ? 1 : -1
      if (length > .1) for (const side of [preferred, -preferred]) {
        const point = { speed: Math.max(6, goal.speed), height: here.y + (this.profile.flies ? 4 : 0), x: here.x + velocity.x * .8 - t.velocity.z / length * 8 * side, z: here.z + velocity.z * .8 + t.velocity.x / length * 8 * side }
        if (!this.safe(point)) continue
        this.active = { ...point, id: t.id, until: this.time + 1.5 }; break
      }
      // One attempt per shot, even when both sides are unsafe. No perpetual extension.
      this.used.add(t.id); if (this.used.size > 32) this.used.delete(this.used.values().next().value!)
      this.cooldown = this.time + 3
    }
    if (!this.active) return false
    if (this.profile.flies) goal.altitude = Math.max(goal.altitude ?? 0, this.active.height - this.surface(this.vehicle.body.translation().x, this.vehicle.body.translation().z))
    goal.x = this.active.x; goal.z = this.active.z
    goal.speed = this.active.speed; goal.stopWithin = undefined; goal.special = false
    return true
  }
  private closest(threats: readonly Threat[]): Threat | null {
    const here = this.vehicle.body.translation(), v = this.vehicle.body.linvel(), w = this.terrain.wrapSize
    // Default catch radius is 2.4m; a 0.6m margin admits small observed steering
    // changes without reacting to every harmless pass several metres away.
    let best: Threat | null = null, soonest = 4
    for (const t of threats) {
      if (![t.position.x,t.position.y,t.position.z,t.velocity.x,t.velocity.y,t.velocity.z].every(Number.isFinite)) continue
      const dx = (w ? nearestImage(t.position.x, here.x, w) : t.position.x) - here.x
      const dz = (w ? nearestImage(t.position.z, here.z, w) : t.position.z) - here.z, dy = t.position.y - here.y
      const vx = t.velocity.x - v.x, vy = t.velocity.y - v.y, vz = t.velocity.z - v.z
      const vv = vx * vx + vy * vy + vz * vz
      const time = vv > .01 ? -(dx * vx + dy * vy + dz * vz) / vv : -1
      if (time <= 0 || time >= soonest || Math.hypot(dx,dy,dz) > 90 || Math.hypot(dx+vx*time,dy+vy*time,dz+vz*time) > 3) continue
      soonest = time; best = t
    }
    this.impactIn = best ? soonest : Infinity
    return best
  }
  private surface(x: number, z: number) { return Math.max(this.terrain.heightAt(x,z), this.terrain.liquidHeightAt?.(x,z) ?? -Infinity) }
  private safe(goal: Point & { height?: number; speed?: number }): boolean {
    const here = this.vehicle.body.translation(), v = this.vehicle.body.linvel(), w = this.terrain.wrapSize
    if (![here.x,here.y,here.z,v.x,v.y,v.z,goal.x,goal.z].every(Number.isFinite)) return false
    const surface = this.surface(here.x,here.z), radius = this.profile.flies ? 5 : 3
    if (!Number.isFinite(surface) || (this.profile.flies && here.y - surface < 5)) return false
    // Check the lateral leg AND the momentum carried past it. Include each endpoint and
    // the whole footprint; the ordinary aircraft crossable check samples more coarsely.
    const end = { x: goal.x + v.x * 1.2, z: goal.z + v.z * 1.2 }
    const gap = Math.hypot(goal.x-here.x,goal.z-here.z) || 1
    const travel = Math.max(Math.hypot(v.x,v.z),goal.speed??0)*1.2
    const accelerating = {x:goal.x+(goal.x-here.x)/gap*travel,z:goal.z+(goal.z-here.z)/gap*travel}
    const obstacles = (this.others?.() ?? []).filter(o => o !== this.vehicle && o.body.isValid())
    for (const [a,b] of [[here,goal],[goal,end],[goal,accelerating]] as const) {
      const length = Math.hypot(b.x-a.x,b.z-a.z), n = Math.max(1,Math.ceil(length))
      let previous = this.surface(a.x,a.z)
      for (let i=0;i<=n;i++) {
        const f=i/n,x=a.x+(b.x-a.x)*f,z=a.z+(b.z-a.z)*f,h=this.surface(x,z)
        if (!Number.isFinite(h) || (!this.profile.flies && Math.abs(h-previous) > this.profile.maxGrade * Math.max(.001,length/n))) return false
        previous=h
        for (const [ox,oz] of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]]) {
          const px=x+ox,pz=z+oz,top=this.surface(px,pz)
          if (!w && (Math.abs(px)>this.terrain.size/2-40 || Math.abs(pz)>this.terrain.size/2-40)) return false
          if (!Number.isFinite(top) || (this.profile.flies ? top > here.y-4 : Math.abs(top-h)>radius*this.profile.maxGrade || this.navigator && !this.navigator.passable(px,pz,this.profile))) return false
        }
        // Conservative linear occupancy check, not a promise about other drivers' turns.
        for (const other of obstacles) {
          const p=other.body.translation(),ov=other.body.linvel()
          const px=(w?nearestImage(p.x,here.x,w):p.x)+ov.x*f*1.2,pz=(w?nearestImage(p.z,here.z,w):p.z)+ov.z*f*1.2
          if (p.y+ov.y*f*1.2 >= here.y-4 && p.y+ov.y*f*1.2 <= Math.max(here.y,goal.height??here.y)+4 && Math.hypot(px-x,pz-z)<radius+3) return false
        }
      }
    }
    return true
  }
}

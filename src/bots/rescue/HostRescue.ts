/**
 * Bots rescue each other, on the client that simulates them (the host). Everyone sees the
 * same thing: the bots' positions and the grapple cords travel the room like any bot's.
 *
 * Twice a second it looks at each bot's trouble (BotBrain.trouble). A bot stuck past the
 * limits in rules.ts holds off its old self-rescue (a hop back to a landing pad) and the
 * others weigh going to help against staying with their player (rules.rescueScore). At most
 * two go. Each rescuer gets a TowRescue: it drives over, fires the grapple, pulls the bot
 * out, lets go. The stuck bot drives with the cord. A rescue that fails, or takes longer
 * than RESCUE_LIMIT, lets the old self-rescue happen, with grumbling.
 *
 * Route planning is the existing planner, once per approach for far rescuers; the close-in
 * choices are a few dozen height samples a second per rescuer. No per-frame work here.
 */
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import { BOT_ID_BASE, MODE_TAG } from '../../../shared/protocol'
import { botRescue } from '../../../shared/chat'
import type { BotBrain, BotTerrain } from '../BotBrain'
import type { BotGearHooks } from '../gear'
import { createPilot } from '../pilot'
import type { Navigator } from '../pilot/types'
import { VOICES, voiceFor } from '../banter/voices'
import { TowRescue, type StuckKind, type TowGear, type TowPhase } from './TowRescue'
import { MishapSchedule, botMishaps, chooseRescuers, pullDirection, stuckKind, torn, type Candidate } from './rules'

/** A whole rescue, from noticing to freed or given up, never takes longer than this. */
export const RESCUE_LIMIT = 75
const DECIDE = 0.5
/** How far a stuck bot's recent track goes back, seconds. */
const TRACK = 8

export type RescueEvent =
  | { kind: 'stuck'; stuck: number; clumsy: boolean; count: number }
  | { kind: 'pointed'; stuck: number }
  | { kind: 'conflict'; bot: number; stuck: number; player: number | null; going: boolean }
  | { kind: 'start'; bot: number; stuck: number }
  | { kind: 'retry'; bot: number; stuck: number }
  | { kind: 'freed'; stuck: number; by: number[]; players: number[]; count: number }
  | { kind: 'giveup'; stuck: number }
  | { kind: 'player.came'; player: number; stuck: number }
  | { kind: 'mishap'; bot: number }

export interface RescueNet {
  readonly isHost: boolean
  readonly connected: boolean
  readonly mode: number
  vehicleOf(id: number): Vehicle | undefined
  readonly botGearHooks: BotGearHooks
  botCord(id: number): { flying: boolean; to: number | null } | null
  displayName(id: number): string
  /** A bot's hidden role, for its voice. */
  botRole?(id: number): string
  /** People in the room (not bots), by id. */
  people(): number[]
}

interface Rescue {
  stuck: number
  kind: StuckKind
  since: number
  rescuers: Map<number, TowRescue>
  /** Who has been asked and said no (they comment, they do not go). */
  declined: Set<number>
  playersNear: Set<number>
  pointedAt: number
  /** A person's vehicle rather than a bot. */
  person: boolean
}

export class HostRescue {
  /** A bot's name and hidden role, "Temolin Dust Clerk", as the voice table reads it. */
  private identity(id: number): string {
    const name = this.net.displayName(id), role = this.net.botRole?.(id)
    return role ? `${name} ${role}` : name
  }
  private readonly rescues = new Map<number, Rescue>()
  private readonly tracks = new Map<number, { t: number; x: number; z: number }[]>()
  private readonly count = new Map<number, number>()
  private time = 0
  private decideTime = 0
  private mishaps: MishapSchedule | null = null
  /** The session's accident-prone bot, by name (names survive a bot being respawned). */
  clumsyName: string | null = null
  /** Counts for the report and tests. */
  readonly stats = { noticed: 0, freed: 0, gaveUp: 0, mishaps: 0 }

  constructor(
    private readonly terrain: BotTerrain,
    private readonly net: RescueNet,
    private readonly bots: { readonly vehicles: readonly Vehicle[]; readonly brainList: readonly BotBrain[] },
    private readonly navigator: Navigator | null,
    private readonly onEvent: (e: RescueEvent) => void,
    private readonly withPlayer: (bot: number) => number | null,
  ) {}

  /** Call every frame; it works on its own slow timer. */
  update(dt: number): void {
    this.time += dt
    this.decideTime += dt
    if (this.decideTime < DECIDE) return
    this.decideTime = 0
    if (!this.net.connected || !this.net.isHost) { this.clear(); return }
    if (!botRescue.value) { this.clear(); return }
    this.track()
    this.notice()
    for (const r of [...this.rescues.values()]) this.manage(r)
    this.misbehave()
  }

  /** A player's vehicle is stuck: send one rescuer, if anyone can. True if someone goes. */
  helpPlayer(player: number): boolean {
    if (!botRescue.value || this.rescues.has(player)) return this.rescues.has(player)
    const v = this.net.vehicleOf(player)
    if (!v) return false
    const at = v.body.translation(), liquid = this.terrain.liquidHeightAt?.(at.x, at.z)
    const wet = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(at.x, at.z) < liquid + 0.3
    const r: Rescue = { stuck: player, kind: wet ? 'bogged' : 'wedged', since: this.time, rescuers: new Map(), declined: new Set(), playersNear: new Set(), pointedAt: this.time, person: true }
    this.rescues.set(player, r)
    this.recruit(r, 1)
    if (!r.rescuers.size) { this.rescues.delete(player); return false }
    return true
  }

  /** Rescues under way, for tests and the transcript tool. */
  active(): { stuck: number; rescuers: number[]; phases: TowPhase[] }[] {
    return [...this.rescues.values()].map((r) => ({ stuck: r.stuck, rescuers: [...r.rescuers.keys()], phases: [...r.rescuers.values()].map((t) => t.phase) }))
  }

  dispose(): void { this.clear() }

  // -------------------------------------------------------------------------------------

  private brain(id: number): BotBrain | undefined { return this.bots.brainList[id - BOT_ID_BASE] }
  private vehicle(id: number): Vehicle | undefined { return this.net.vehicleOf(id) }

  /** Each bot's recent positions, for the way it came in. */
  private track(): void {
    for (let i = 0; i < this.bots.vehicles.length; i++) {
      const v = this.bots.vehicles[i], id = BOT_ID_BASE + i
      if (!v.body.isValid()) continue
      const p = v.body.translation()
      const list = this.tracks.get(id) ?? []
      const last = list[list.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1.5) list.push({ t: this.time, x: p.x, z: p.z })
      while (list.length && this.time - list[0].t > TRACK * 3) list.shift()
      this.tracks.set(id, list)
    }
  }

  private notice(): void {
    for (let i = 0; i < this.bots.brainList.length; i++) {
      const brain = this.bots.brainList[i], id = BOT_ID_BASE + i
      if (this.rescues.has(id) || this.rescuing(id)) continue
      const kind = stuckKind(brain.trouble)
      if (!kind) continue
      const name = this.net.displayName(id)
      const n = (this.count.get(id) ?? 0) + 1
      this.count.set(id, n)
      brain.holdRecovery = true
      const r: Rescue = { stuck: id, kind, since: this.time, rescuers: new Map(), declined: new Set(), playersNear: new Set(), pointedAt: this.time, person: false }
      this.rescues.set(id, r)
      this.stats.noticed++
      this.onEvent({ kind: 'stuck', stuck: id, clumsy: name === this.clumsyName, count: n })
      // The stuck bot drives with the cord while being pulled.
      brain.directive = { kind: 'control', step: (dt: number, input: InputState) => this.assist(r, input) }
    }
  }

  private assist(r: Rescue, input: InputState): boolean {
    if (!this.rescues.has(r.stuck)) return false
    const towing = [...r.rescuers.values()].find((t) => t.phase === 'tow')
    if (towing) towing.assist(input)
    else { input.x = input.y = input.z = input.w = 0; input.brakes = false; input.fire = false }
    return true
  }

  private rescuing(id: number): boolean {
    for (const r of this.rescues.values()) if (r.rescuers.has(id)) return true
    return false
  }

  private manage(r: Rescue): void {
    const stuckVehicle = this.vehicle(r.stuck)
    if (!stuckVehicle) { this.finish(r, false); return }
    const elapsed = this.time - r.since
    // Did it get out on its own (or did someone else's pull do it)?
    if (!r.person && !r.rescuers.size && !stuckKind(this.brain(r.stuck)?.trouble ?? { stuck: 0, flipped: 0, bog: 0 })) { this.finish(r, true); return }
    if (elapsed > RESCUE_LIMIT) { this.finish(r, false); return }
    // Recruit up to two, re-weighed every decision while nobody has gone yet.
    if (r.rescuers.size < 2 && elapsed > 2) this.recruit(r, r.person ? 1 : 2)
    // Rescuers that finished: success ends the rescue, failure frees the slot.
    for (const [id, tow] of r.rescuers) {
      if (tow.phase === 'done') { this.finish(r, true); return }
      if (tow.phase === 'failed') { r.rescuers.delete(id); this.release(id); r.declined.add(id) }
    }
    if (!r.rescuers.size && elapsed > 40) { this.finish(r, false); return }
    // Increasingly pointed remarks while nobody comes.
    if (!r.rescuers.size && this.time - r.pointedAt > 14) { r.pointedAt = this.time; this.onEvent({ kind: 'pointed', stuck: r.stuck }) }
    // A person comes to help: within ten metres of the stuck bot.
    const s = stuckVehicle.body.translation()
    for (const pid of this.net.people()) {
      if (r.playersNear.has(pid) || pid === r.stuck) continue
      const pv = this.vehicle(pid)
      if (!pv) continue
      const q = pv.body.translation()
      if (Math.hypot(q.x - s.x, q.z - s.z) < 10) { r.playersNear.add(pid); this.onEvent({ kind: 'player.came', player: pid, stuck: r.stuck }) }
    }
  }

  private recruit(r: Rescue, max: number): void {
    const stuckVehicle = this.vehicle(r.stuck)
    if (!stuckVehicle) return
    const s = stuckVehicle.body.translation()
    const candidates: Candidate[] = []
    for (let i = 0; i < this.bots.brainList.length; i++) {
      const id = BOT_ID_BASE + i, brain = this.bots.brainList[i], v = this.bots.vehicles[i]
      if (id === r.stuck || r.rescuers.has(id) || r.declined.has(id) || !v?.body.isValid()) continue
      const voice = VOICES[voiceFor(this.identity(id))]
      const p = v.body.translation()
      const free = brain.mind && !this.rescues.has(id) && !this.rescuing(id) && brain.directive?.kind !== 'control' && !brain.raceGoal
      candidates.push({ id, distance: Math.hypot(p.x - s.x, p.z - s.z), loyalty: voice.loyalty, withPlayer: this.withPlayer(id) !== null, able: Boolean(free), eager: voice.id === 'intern' })
    }
    const situation = { stuckFor: this.time - r.since, helpers: r.rescuers.size, tag: this.net.mode === MODE_TAG, enabled: Boolean(botRescue.value) }
    const going = chooseRescuers(candidates, situation).slice(0, max - r.rescuers.size)
    // Those torn between their player and the stuck bot say so, going or staying.
    for (const c of candidates) {
      if (!torn(c, situation) || r.declined.has(c.id)) continue
      const goes = going.includes(c.id)
      this.onEvent({ kind: 'conflict', bot: c.id, stuck: r.stuck, player: this.withPlayer(c.id), going: goes })
      if (!goes) r.declined.add(c.id)
    }
    for (const id of going) this.dispatch(r, id, stuckVehicle)
  }

  private dispatch(r: Rescue, id: number, stuckVehicle: Vehicle): void {
    const brain = this.brain(id), v = this.vehicle(id)
    if (!brain || !v) return
    const pilot = createPilot(v, this.terrain)
    if (!pilot) return
    const s = stuckVehicle.body.translation()
    const list = this.tracks.get(r.stuck) ?? []
    const back = list.find((p) => this.time - p.t > TRACK) ?? list[0] ?? null
    const q = stuckVehicle.body.rotation()
    // Forward (-z) of the stuck vehicle on the ground.
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const dry = (x: number, z: number) => { const l = this.terrain.liquidHeightAt?.(x, z); return !(l != null && Number.isFinite(l) && this.terrain.heightAt(x, z) < l + 0.3) }
    let pull = pullDirection(r.kind, s, back, { x: fx, z: fz }, dry, (x, z) => this.terrain.heightAt(x, z))
    // A second rescuer pulls from 30 degrees round, so the two cords do not tangle.
    if (r.rescuers.size) { const c = Math.cos(0.52), sn = Math.sin(0.52); pull = { x: pull.x * c - pull.z * sn, z: pull.x * sn + pull.z * c } }
    const gear = this.gearFor(id, v)
    const tow = new TowRescue(v, stuckVehicle, this.terrain, gear, pilot, {
      kind: r.kind, pull, navigator: this.navigator ?? undefined,
      onPhase: (phase) => {
        if (phase === 'fire') this.onEvent({ kind: 'start', bot: id, stuck: r.stuck })
        if (phase === 'approach' && tow.attempt > 1) this.onEvent({ kind: 'retry', bot: id, stuck: r.stuck })
      },
    })
    r.rescuers.set(id, tow)
    brain.directive = { kind: 'control', step: (dt: number, input: InputState) => { tow.step(dt, input); return !tow.finished } }
  }

  /** The grapple through the bots' gear hooks: the same gear, limits and network as a player's. */
  private gearFor(id: number, v: Vehicle): TowGear {
    const hooks = this.net.botGearHooks
    const act = (target: Vehicle, phase: 'press' | 'hold' | 'release', reel = true) => hooks.act(v, { gear: 'bungee', target, phase, aimUp: 0.9, reel })
    return {
      fire: (t) => act(t, 'press'),
      reel: (t) => act(t, 'hold'),
      hold: (t) => act(t, 'hold', false),
      release: (t) => act(t, 'release'),
      attachedTo: (t) => { const c = this.net.botCord(id); return !!c && !c.flying && c.to !== null && this.net.vehicleOf(c.to) === t },
      flying: () => Boolean(this.net.botCord(id)?.flying),
    }
  }

  private release(id: number): void {
    const brain = this.brain(id)
    if (brain?.directive?.kind === 'control') { brain.directive = null; brain.mind?.reset() }
  }

  private finish(r: Rescue, freed: boolean): void {
    for (const [id, tow] of r.rescuers) { tow.abort(); this.release(id) }
    this.rescues.delete(r.stuck)
    const brain = r.person ? undefined : this.brain(r.stuck)
    if (brain) {
      brain.holdRecovery = false
      if (brain.directive?.kind === 'control') { brain.directive = null; brain.mind?.reset() }
      if (freed) brain.clearTrouble()
    }
    if (freed) {
      this.stats.freed++
      this.onEvent({ kind: 'freed', stuck: r.stuck, by: [...r.rescuers.keys()], players: [...r.playersNear], count: this.count.get(r.stuck) ?? 1 })
    } else {
      this.stats.gaveUp++
      // The old self-rescue now happens: its timers are long past the limit.
      if (!r.person) this.onEvent({ kind: 'giveup', stuck: r.stuck })
    }
  }

  private clear(): void {
    for (const r of [...this.rescues.values()]) {
      for (const [id, tow] of r.rescuers) { tow.abort(); this.release(id) }
      const brain = r.person ? undefined : this.brain(r.stuck)
      if (brain) { brain.holdRecovery = false; if (brain.directive?.kind === 'control') brain.directive = null }
    }
    this.rescues.clear()
  }

  /**
   * The accident-prone bot, now and then, takes a bolder line: it heads for the nearest shore
   * and keeps going a few metres too far. Within reason: `bots.mishapsPerHour`, never closer
   * than four minutes apart, and never while it is busy with a player or a race.
   */
  private misbehave(): void {
    const names = this.bots.vehicles.map((_, i) => this.net.displayName(BOT_ID_BASE + i))
    const identities = new Map(this.bots.vehicles.map((_, i) => [this.net.displayName(BOT_ID_BASE + i), this.identity(BOT_ID_BASE + i)]))
    if (!names.length) return
    if (!this.clumsyName || !names.includes(this.clumsyName)) {
      // The clumsiest voice present; ties go to the first.
      let best = -1
      for (const n of names) { const c = VOICES[voiceFor(identities.get(n) ?? n)].clumsy; if (c > best) { best = c; this.clumsyName = n } }
      this.mishaps = new MishapSchedule(this.clumsyName ?? 'clumsy', this.time, () => botMishaps.value)
    }
    if (!this.mishaps?.due(this.time)) return
    const i = names.indexOf(this.clumsyName!)
    const id = BOT_ID_BASE + i, brain = this.bots.brainList[i], v = this.bots.vehicles[i]
    if (!brain?.mind || brain.directive || brain.raceGoal || this.rescues.has(id) || this.rescuing(id) || this.withPlayer(id) !== null) return
    const p = v.body.translation()
    const spot = this.troubleNear(p.x, p.z)
    if (!spot) return
    this.stats.mishaps++
    brain.directive = { kind: 'goto', x: spot.x, y: 0, z: spot.z, radius: 2, until: brain.clock + 40 }
    this.onEvent({ kind: 'mishap', bot: id })
  }

  /** A spot a few metres into liquid beside dry ground within 150 m: a shore to misjudge. */
  private troubleNear(x: number, z: number): { x: number; z: number } | null {
    const wet = (a: number, b: number) => { const l = this.terrain.liquidHeightAt?.(a, b); return l != null && Number.isFinite(l) && this.terrain.heightAt(a, b) < l - 0.4 }
    for (const r of [30, 60, 100, 150]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
        // Wet here, dry a few metres back towards the bot: the edge of a shore.
        if (wet(px, pz) && !wet(px - Math.cos(a) * 6, pz - Math.sin(a) * 6)) return { x: px, z: pz }
      }
    }
    return null
  }
}

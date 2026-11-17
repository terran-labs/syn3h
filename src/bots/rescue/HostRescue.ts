/**
 * Bots rescue each other, on the client that simulates them (the host). Everyone sees the
 * same thing: the bots' positions and the grapple cords travel the room like any bot's.
 *
 * Twice a second it looks at each bot's trouble (BotBrain.trouble). A bot stuck past the
 * limits in rules.ts holds off its old self-rescue (a hop back to a landing pad) and waits:
 * no clock ends a rescue (the owner, 16 November 2026: "a valiant effort by the other bots
 * to go and rescue it, even if it takes multiple minutes"). The others weigh going against
 * staying with their player (rules.rescueScore), and the guilt grows with every minute.
 *
 * The effort escalates. One rescuer goes first. Each of its pulls that makes no progress
 * makes it reposition (TowRescue: another angle, a longer or shorter line); after the first
 * failed pull a second joins from another angle; after several, a third; a rescuer out of
 * ideas rests while another takes over (a hovercraft or jet is preferred in liquid); a
 * rescuer that gets stuck itself lets go, says so, and becomes a rescue of its own.
 *
 * Only these end a rescue without freeing the bot:
 *   - it is lost (below the world, non-finite): BotBrain recovers it at once and silently;
 *   - nobody can help: no other bot that can drive, and no person who hooks it, or the
 *     setting or the grapple turned off: the old self-rescue, with a line;
 *   - `bots.rescuePatience` minutes with no progress at all: the rescuers call it off in
 *     character and the stuck bot hops home.
 *
 * Lines follow the plan: a bot says it is going only once it has actually been sent.
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
import { bungeeAllowed } from '../../weapons/bungee/params'
import { TowRescue, type StuckKind, type TowGear, type TowPhase } from './TowRescue'
import { MAX_RESCUERS, MishapSchedule, botMishaps, chooseRescuers, pullDirection, rescueAfter, rescuePatience, stuckKind, torn, type Candidate } from './rules'

const DECIDE = 0.5
/** How far a stuck bot's recent track goes back, seconds. */
const TRACK = 8
/** Metres the stuck vehicle must get beyond its best so far to count as progress. */
const PROGRESS_M = 1.2
/** A rescuer whose tow ran out of ideas rests this long before it may come back. */
const REST_S = 25
/** A bot that stayed with its player is asked again after this long, guiltier. */
const ASK_AGAIN_S = 45
/** With rescuers working but no progress, the stuck bot remarks this often. */
const WAITING_S = 35
/** Nobody can come: how long a person nearby has to hook the bot before it frees itself. */
const PERSON_WAIT_S = 45
/** A person within this many metres can be asked for a hand. */
const ASK_RANGE = 70
/** Ask any one person for a hand at most this often, seconds, so it is never a nag. */
const ASK_PERSON_S = 300
/**
 * After a rescue gives up, the bot frees itself the old way (BotBrain, after its recovery
 * time): it is left alone this long, or until it has, instead of being noticed again at once.
 */
const SELF_RESCUE_S = 30
/** A quiet episode (trouble not yet called a rescue) ends once the trouble has been gone this long. */
const QUIET_CLEAR_S = 3

export type RescueEvent =
  | { kind: 'stuck'; stuck: number; clumsy: boolean; count: number }
  | { kind: 'pointed'; stuck: number }
  | { kind: 'waiting'; stuck: number; minutes: number }
  | { kind: 'conflict'; bot: number; stuck: number; player: number | null; going: boolean }
  | { kind: 'start'; bot: number; stuck: number }
  | { kind: 'join'; bot: number; stuck: number; others: number[] }
  | { kind: 'retry'; bot: number; stuck: number }
  | { kind: 'swap'; bot: number; stuck: number }
  | { kind: 'freed'; stuck: number; by: number[]; players: number[]; count: number }
  | { kind: 'giveup'; stuck: number }
  | { kind: 'calloff'; bot: number; stuck: number }
  | { kind: 'player.came'; player: number; stuck: number }
  | { kind: 'player.ask'; player: number; stuck: number }
  | { kind: 'player.hooked'; player: number; stuck: number }
  | { kind: 'mishap'; bot: number }
  | { kind: 'handoff'; bot: number; stuck: number }

export interface RescueNet {
  readonly isHost: boolean
  readonly connected: boolean
  readonly mode: number
  vehicleOf(id: number): Vehicle | undefined
  readonly botGearHooks: BotGearHooks
  botCord(id: number): { flying: boolean; to: number | null } | null
  /** A person's cord, as the host sees it (null when they have none or it is not known). */
  playerCord?(id: number): { flying: boolean; to: number | null } | null
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
  /** Bots that stayed with their player, and when they may be asked again. */
  declined: Map<number, number>
  /** Rescuers whose tow ran out of ideas, and until when they rest. */
  rested: Map<number, number>
  playersNear: Set<number>
  /** People who have hooked the stuck vehicle. */
  hooked: Set<number>
  /** Time of the last remark by the stuck bot. */
  pointedAt: number
  /** A person's vehicle rather than a bot. */
  person: boolean
  /** Pulls that did not free it, across every rescuer: the escalation counter. */
  attempts: number
  /** Where it was when noticed, its best distance from there, and when that last grew. */
  from: { x: number; z: number }
  best: number
  progressAt: number
  /** The bot's own recoveries when the rescue began: one more means it was recovered (lost). */
  recoveries: number
  /** Since when nobody at all could come (no bot able to drive), or -1. */
  aloneSince: number
  /** A person was asked for a hand in this rescue. */
  asked: boolean
  /** Seconds it has looked free (upright, dry, off the spot) with nobody's tow judging it. */
  freeFor: number
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
  /** Seconds each rescuer has itself been bogged or upside down. */
  private readonly troubleOf = new Map<number, number>()
  /** When each person was last asked for a hand. */
  private readonly askedAt = new Map<number, number>()
  /**
   * Bots in trouble that are still trying to free themselves, unannounced: since when (counted
   * from the start of the trouble), and since when the trouble has been gone (-1 while it lasts).
   */
  private readonly quiet = new Map<number, { since: number; clearSince: number }>()
  /** Bots freeing themselves after a rescue gave up: until when, and their recoveries then. */
  private readonly selfRescue = new Map<number, { until: number; recoveries: number }>()
  private time = 0
  private decideTime = 0
  private mishaps: MishapSchedule | null = null
  /** The session's accident-prone bot, by name (names survive a bot being respawned). */
  clumsyName: string | null = null
  /** Counts for the report and tests. */
  readonly stats = { noticed: 0, freed: 0, gaveUp: 0, mishaps: 0, attempts: 0, calledOff: 0, quiet: 0 }

  constructor(
    private readonly terrain: BotTerrain,
    private readonly net: RescueNet,
    private readonly bots: { readonly vehicles: readonly Vehicle[]; readonly brainList: readonly BotBrain[] },
    private readonly navigator: Navigator | null,
    private readonly onEvent: (e: RescueEvent) => void,
    private readonly withPlayer: (bot: number) => number | null,
    /**
     * The player a bot has been asked to stay with, if any. A mishap waits while there is one;
     * merely trailing the host does not count, since that is where a person sees the mishap.
     */
    private readonly escorting: (bot: number) => number | null = withPlayer,
  ) {}

  /** Call every frame; it works on its own slow timer. */
  update(dt: number): void {
    this.time += dt
    this.decideTime += dt
    if (this.decideTime < DECIDE) return
    this.decideTime = 0
    if (!this.net.connected || !this.net.isHost) { this.clear(); return }
    if (!botRescue.value || !bungeeAllowed.value) { this.clear(); return }
    this.track()
    this.notice()
    for (const r of [...this.rescues.values()]) this.manage(r)
    this.misbehave()
  }

  /** A player's vehicle is stuck: send rescuers, if anyone can. True if someone goes. */
  helpPlayer(player: number): boolean {
    if (!botRescue.value || !bungeeAllowed.value || this.rescues.has(player)) return this.rescues.has(player)
    const v = this.net.vehicleOf(player)
    if (!v) return false
    const at = v.body.translation(), liquid = this.terrain.liquidHeightAt?.(at.x, at.z)
    const wet = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(at.x, at.z) < liquid + 0.3
    const r = this.newRescue(player, wet ? 'bogged' : 'wedged', true, v)
    this.rescues.set(player, r)
    this.recruit(r)
    if (!r.rescuers.size) { this.rescues.delete(player); return false }
    return true
  }

  /** Rescues under way, for tests and the transcript tool. */
  active(): { stuck: number; rescuers: number[]; phases: TowPhase[]; attempts: number; seconds: number }[] {
    return [...this.rescues.values()].map((r) => ({ stuck: r.stuck, rescuers: [...r.rescuers.keys()], phases: [...r.rescuers.values()].map((t) => t.phase), attempts: r.attempts, seconds: Math.round(this.time - r.since) }))
  }

  dispose(): void { this.clear() }

  // -------------------------------------------------------------------------------------

  private brain(id: number): BotBrain | undefined { return this.bots.brainList[id - BOT_ID_BASE] }
  private vehicle(id: number): Vehicle | undefined { return this.net.vehicleOf(id) }

  private newRescue(stuck: number, kind: StuckKind, person: boolean, v: Vehicle): Rescue {
    const p = v.body.translation()
    return {
      stuck, kind, since: this.time, rescuers: new Map(), declined: new Map(), rested: new Map(), playersNear: new Set(), hooked: new Set(),
      pointedAt: this.time, person, attempts: 0, from: { x: p.x, z: p.z }, best: 0, progressAt: this.time,
      recoveries: person ? 0 : this.brain(stuck)?.rescues ?? 0, aloneSince: -1, asked: false, freeFor: 0,
    }
  }

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
      const brain = this.bots.brainList[i], id = BOT_ID_BASE + i, v = this.bots.vehicles[i]
      if (!v?.body.isValid() || this.rescues.has(id) || this.rescuing(id)) continue
      // Left to free itself after a rescue gave up: until it has, or for a while.
      const self = this.selfRescue.get(id)
      if (self && this.time < self.until && brain.rescues === self.recoveries) continue
      this.selfRescue.delete(id)
      const kind = stuckKind(brain.trouble)
      // Trouble is noticed at once but called a rescue only after the bot has failed to free
      // itself for bots.rescueAfter seconds, or at once when it plainly cannot. Meanwhile its
      // own self-help runs and its hop home is held, so the clock is not cut short.
      const q = this.quiet.get(id)
      if (!kind) {
        if (q) {
          if (q.clearSince < 0) q.clearSince = this.time
          else if (this.time - q.clearSince > QUIET_CLEAR_S) { this.quiet.delete(id); brain.holdRecovery = false; this.stats.quiet++ }
        }
        continue
      }
      const t = brain.trouble
      if (!q) this.quiet.set(id, { since: this.time - Math.max(t.stuck, t.bog, t.flipped), clearSince: -1 })
      else q.clearSince = -1
      const since = this.quiet.get(id)!.since
      if (!(kind === 'flipped' || this.sunk(v)) && this.time - since < rescueAfter.value) { brain.holdRecovery = true; continue }
      this.quiet.delete(id)
      const name = this.net.displayName(id)
      const n = (this.count.get(id) ?? 0) + 1
      this.count.set(id, n)
      brain.holdRecovery = true
      const r = this.newRescue(id, kind, false, v)
      this.rescues.set(id, r)
      this.stats.noticed++
      this.onEvent({ kind: 'stuck', stuck: id, clumsy: name === this.clumsyName, count: n })
      // The stuck bot drives with the cord while being pulled.
      brain.directive = { kind: 'control', step: (dt: number, input: InputState) => this.assist(r, input) }
    }
  }

  /** Wheels on the bed under liquid: no amount of trying gets a buggy up from there. */
  private sunk(v: Vehicle): boolean {
    if (v.kind === 'hovercraft' || v.kind === 'jet') return false
    const p = v.body.translation(), liquid = this.terrain.liquidHeightAt?.(p.x, p.z)
    return liquid != null && Number.isFinite(liquid) && p.y < liquid - 1
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

  /** Bots other than `not` that could ever help: valid, with a mind, not stuck themselves. */
  private helpersExist(not: number): boolean {
    for (let i = 0; i < this.bots.brainList.length; i++) {
      const id = BOT_ID_BASE + i, v = this.bots.vehicles[i], brain = this.bots.brainList[i]
      if (id === not || !v?.body.isValid() || !brain?.mind) continue
      if (this.rescues.has(id)) continue
      return true
    }
    return false
  }

  private manage(r: Rescue): void {
    const stuckVehicle = this.vehicle(r.stuck)
    if (!stuckVehicle) { this.end(r); return }
    const brain = r.person ? undefined : this.brain(r.stuck)
    // Recovered underneath us (it was lost: below the world, or non-finite): end silently.
    if (brain && brain.rescues > r.recoveries) { this.end(r); return }
    const elapsed = this.time - r.since
    // Did it get out on its own (or did someone else's pull do it)?
    if (!r.person && !r.rescuers.size && !stuckKind(brain?.trouble ?? { stuck: 0, flipped: 0, bog: 0 })) { this.finish(r, true); return }
    // Progress: the stuck vehicle got farther from where it was stuck than ever before.
    const s = stuckVehicle.body.translation()
    const moved = Math.hypot(s.x - r.from.x, s.z - r.from.z)
    if (moved > r.best + PROGRESS_M) { r.best = moved; r.progressAt = this.time }
    // Out, judged here when no bot's tow is judging it (a person pulled it, or it crawled out
    // while the rescuers were still on their way): upright, out of the liquid, off the spot.
    if (!r.person && ![...r.rescuers.values()].some((t) => t.phase === 'tow' || t.phase === 'ease')) {
      const q = stuckVehicle.body.rotation(), upY = 1 - 2 * (q.x * q.x + q.z * q.z)
      const liquid = this.terrain.liquidHeightAt?.(s.x, s.z)
      const wet = liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(s.x, s.z) <= liquid + 0.3
      r.freeFor = upY > 0.75 && !wet && (r.kind === 'flipped' || moved > 3.5) ? r.freeFor + DECIDE : 0
      if (r.freeFor >= 1) { this.finish(r, true); return }
    }
    // The backstop: minutes of real attempts and no progress at all.
    const patience = rescuePatience.value
    if (patience > 0 && this.time - r.progressAt > patience * 60 && r.attempts > 0) {
      const caller = [...r.rescuers.keys()][0]
      if (caller !== undefined) this.onEvent({ kind: 'calloff', bot: caller, stuck: r.stuck })
      this.stats.calledOff++
      this.finish(r, false)
      return
    }
    // Rescuers that finished: success ends the rescue; one out of ideas rests, another tries.
    for (const [id, tow] of r.rescuers) {
      if (tow.phase === 'done') { this.finish(r, true); return }
      if (tow.phase === 'failed') {
        r.rescuers.delete(id); this.release(id); r.rested.set(id, this.time + REST_S)
        r.attempts++; this.stats.attempts++
        this.onEvent({ kind: 'swap', bot: id, stuck: r.stuck })
      }
    }
    // A rescuer that is itself in trouble (bogged or upside down) lets go cleanly and says so;
    // it becomes a rescue of its own, and the next decision sends someone else.
    for (const [id, tow] of r.rescuers) {
      const v = this.vehicle(id)
      if (!v || tow.finished) continue
      const p = v.body.translation(), q = v.body.rotation()
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
      const liquid = this.terrain.liquidHeightAt?.(p.x, p.z)
      const wheeled = v.kind !== 'hovercraft' && v.kind !== 'jet'
      const bogged = wheeled && liquid != null && Number.isFinite(liquid) && this.terrain.heightAt(p.x, p.z) < liquid - 0.5
      const trouble = bogged || upY < 0.3 ? (this.troubleOf.get(id) ?? 0) + DECIDE : 0
      this.troubleOf.set(id, trouble)
      if (trouble < 3) continue
      tow.abort(); r.rescuers.delete(id); this.release(id); r.rested.set(id, this.time + REST_S); this.troubleOf.delete(id)
      r.attempts++
      this.onEvent({ kind: 'handoff', bot: id, stuck: r.stuck })
    }
    // People: one who comes close, one who hooks the stuck vehicle (a rescuer like any other).
    for (const pid of this.net.people()) {
      if (pid === r.stuck) continue
      const cord = this.net.playerCord?.(pid)
      if (cord && !cord.flying && cord.to === r.stuck && !r.hooked.has(pid)) {
        r.hooked.add(pid); r.playersNear.add(pid); r.progressAt = Math.max(r.progressAt, this.time - 30)
        this.onEvent({ kind: 'player.hooked', player: pid, stuck: r.stuck })
      }
      const pv = this.vehicle(pid)
      if (!pv || r.playersNear.has(pid)) continue
      const q = pv.body.translation()
      if (Math.hypot(q.x - s.x, q.z - s.z) < 10) { r.playersNear.add(pid); this.onEvent({ kind: 'player.came', player: pid, stuck: r.stuck }) }
    }
    // Send help: one at first, a second after the first pull fails, a third after several.
    const wanted = Math.min(MAX_RESCUERS, r.attempts === 0 ? 1 : r.attempts < 4 ? 2 : 3)
    if (r.rescuers.size < wanted) this.recruit(r, wanted)
    // Nobody at all can come: a person nearby may hook it; otherwise the old way, with a line.
    if (!r.rescuers.size && !r.person && !this.helpersExist(r.stuck)) {
      if (r.aloneSince < 0) r.aloneSince = this.time
      if (!r.hooked.size && this.time - r.aloneSince > (this.askPerson(r, s) ? PERSON_WAIT_S : 0)) { this.finish(r, false); return }
    } else r.aloneSince = -1
    // A person nearby once a pull has failed, or while nobody is coming: a hand, asked once.
    if (!r.person && !r.asked && (r.attempts > 0 || !r.rescuers.size) && elapsed > 6) this.askPerson(r, s)
    // Remarks from the stuck bot: pointed while nobody comes, patient and then less so while
    // the rescue grinds on without progress.
    // A person still hooked on counts as someone working on it.
    let personPulling = false
    for (const pid of r.hooked) { const c = this.net.playerCord?.(pid); if (c && !c.flying && c.to === r.stuck) personPulling = true }
    const working = r.rescuers.size > 0 || personPulling
    if (!r.person && this.time - r.pointedAt > (working ? WAITING_S : 14)) {
      if (!working) { r.pointedAt = this.time; this.onEvent({ kind: 'pointed', stuck: r.stuck }) }
      else if (this.time - r.progressAt > WAITING_S) { r.pointedAt = this.time; this.onEvent({ kind: 'waiting', stuck: r.stuck, minutes: elapsed / 60 }) }
    }
  }

  /** Ask a person near the stuck bot for a hand, once per rescue and rarely per person. */
  private askPerson(r: Rescue, s: { x: number; z: number }): boolean {
    if (r.asked) return true
    for (const pid of this.net.people()) {
      if (pid === r.stuck || this.time - (this.askedAt.get(pid) ?? -Infinity) < ASK_PERSON_S) continue
      const pv = this.vehicle(pid)
      if (!pv) continue
      const q = pv.body.translation()
      if (Math.hypot(q.x - s.x, q.z - s.z) > ASK_RANGE) continue
      r.asked = true; this.askedAt.set(pid, this.time)
      this.onEvent({ kind: 'player.ask', player: pid, stuck: r.stuck })
      return true
    }
    return false
  }

  private recruit(r: Rescue, max = 1): void {
    const stuckVehicle = this.vehicle(r.stuck)
    if (!stuckVehicle) return
    const s = stuckVehicle.body.translation()
    const candidates: Candidate[] = []
    for (let i = 0; i < this.bots.brainList.length; i++) {
      const id = BOT_ID_BASE + i, brain = this.bots.brainList[i], v = this.bots.vehicles[i]
      if (id === r.stuck || r.rescuers.has(id) || !v?.body.isValid()) continue
      if ((r.declined.get(id) ?? -Infinity) > this.time || (r.rested.get(id) ?? -Infinity) > this.time) continue
      const voice = VOICES[voiceFor(this.identity(id))]
      const p = v.body.translation()
      const free = brain.mind && !this.rescues.has(id) && !this.rescuing(id) && brain.directive?.kind !== 'control' && !brain.raceGoal
      // Loyalty binds fully to a player who asked for this bot; merely trailing the host, half.
      // (In a room with one person every bot trails the host, and with full loyalty nobody went.)
      const asked = this.escorting(id) !== null
      candidates.push({ id, distance: Math.hypot(p.x - s.x, p.z - s.z), loyalty: asked ? voice.loyalty : voice.loyalty * 0.5, withPlayer: this.withPlayer(id) !== null, able: Boolean(free), eager: voice.id === 'intern', floats: v.kind === 'hovercraft' || v.kind === 'jet' })
    }
    const situation = { stuckFor: this.time - r.since, helpers: r.rescuers.size, tag: this.net.mode === MODE_TAG, enabled: Boolean(botRescue.value), liquid: r.kind === 'bogged' }
    const going = chooseRescuers(candidates, situation, undefined, max)
    const sent: number[] = []
    for (const id of going) if (this.dispatch(r, id, stuckVehicle)) sent.push(id)
    // Those torn between their player and the stuck bot say so, going or staying. A bot says
    // it is going only once it has actually been sent.
    for (const c of candidates) {
      if (!c.able || !torn(c, situation)) continue
      const goes = sent.includes(c.id)
      if (!goes && going.includes(c.id)) continue
      this.onEvent({ kind: 'conflict', bot: c.id, stuck: r.stuck, player: this.withPlayer(c.id), going: goes })
      if (!goes) r.declined.set(c.id, this.time + ASK_AGAIN_S)
    }
    // A later helper joining a rescue already under way says so.
    // (With nobody else on it, the newcomer simply starts; its 'start' line comes when it fires.)
    if (r.attempts > 0) for (const id of sent) {
      const others = [...r.rescuers.keys()].filter((o) => o !== id)
      if (others.length) this.onEvent({ kind: 'join', bot: id, stuck: r.stuck, others })
    }
  }

  private dispatch(r: Rescue, id: number, stuckVehicle: Vehicle): boolean {
    const brain = this.brain(id), v = this.vehicle(id)
    if (!brain || !v) return false
    const pilot = createPilot(v, this.terrain)
    if (!pilot) return false
    const s = stuckVehicle.body.translation()
    const list = this.tracks.get(r.stuck) ?? []
    const back = list.find((p) => this.time - p.t > TRACK) ?? list[0] ?? null
    const q = stuckVehicle.body.rotation()
    // Forward (-z) of the stuck vehicle on the ground.
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const dry = (x: number, z: number) => { const l = this.terrain.liquidHeightAt?.(x, z); return !(l != null && Number.isFinite(l) && this.terrain.heightAt(x, z) < l + 0.3) }
    let pull = pullDirection(r.kind, s, back, { x: fx, z: fz }, dry, (x, z) => this.terrain.heightAt(x, z))
    // Helpers pull from angles apart, so their cords do not tangle and their pulls differ;
    // later rescuers turn further round, a new idea each time.
    const k = r.rescuers.size + r.attempts
    if (k) { const a = (k % 2 ? 1 : -1) * 0.52 * Math.ceil(k / 2), c = Math.cos(a), sn = Math.sin(a); pull = { x: pull.x * c - pull.z * sn, z: pull.x * sn + pull.z * c } }
    const gear = this.gearFor(id, v)
    const tow = new TowRescue(v, stuckVehicle, this.terrain, gear, pilot, {
      kind: r.kind, pull, navigator: this.navigator ?? undefined,
      partnerComing: () => { for (const o of r.rescuers.values()) if (o !== tow && !o.finished && o.phase !== 'tow') return true; return false },
      onPhase: (phase, attempt) => {
        if (phase === 'fire' && attempt === 1) this.onEvent({ kind: 'start', bot: id, stuck: r.stuck })
        if (phase === 'approach' && attempt > 1) { r.attempts++; this.stats.attempts++; this.onEvent({ kind: 'retry', bot: id, stuck: r.stuck }) }
      },
    })
    r.rescuers.set(id, tow)
    brain.directive = { kind: 'control', step: (dt: number, input: InputState) => { tow.step(dt, input); return !tow.finished } }
    return true
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

  /** End a rescue without a word: the vehicle left, or was recovered as lost. */
  private end(r: Rescue): void {
    for (const [id, tow] of r.rescuers) { tow.abort(); this.release(id) }
    this.rescues.delete(r.stuck)
    const brain = r.person ? undefined : this.brain(r.stuck)
    if (brain) { brain.holdRecovery = false; if (brain.directive?.kind === 'control') { brain.directive = null; brain.mind?.reset() } }
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
      // Credit only those who pulled: one still on its way did not rescue anybody.
      const by = [...r.rescuers].filter(([, tow]) => tow.pulled).map(([id]) => id)
      this.onEvent({ kind: 'freed', stuck: r.stuck, by, players: [...new Set([...r.hooked, ...(by.length ? r.playersNear : [])])], count: this.count.get(r.stuck) ?? 1 })
    } else {
      this.stats.gaveUp++
      // The old self-rescue now happens: its timers are long past their limits.
      if (!r.person) {
        if (brain) this.selfRescue.set(r.stuck, { until: this.time + SELF_RESCUE_S, recoveries: brain.rescues })
        this.onEvent({ kind: 'giveup', stuck: r.stuck })
        brain?.recover()
      }
    }
  }

  private clear(): void {
    for (const r of [...this.rescues.values()]) {
      for (const [id, tow] of r.rescuers) { tow.abort(); this.release(id) }
      const brain = r.person ? undefined : this.brain(r.stuck)
      if (brain) { brain.holdRecovery = false; if (brain.directive?.kind === 'control') brain.directive = null }
    }
    this.rescues.clear()
    for (const id of this.quiet.keys()) { const brain = this.brain(id); if (brain && !this.rescues.has(id)) brain.holdRecovery = false }
    this.quiet.clear()
  }

  /**
   * The accident-prone bot, now and then, takes a bolder line: it heads for the nearest shore
   * and keeps going a few metres too far. Within reason: `bots.mishapsPerHour`, never closer
   * than four minutes apart, and never while a player has asked it along, or it is racing or
   * on another errand. A turn that comes due while it is busy waits for it.
   */
  private misbehave(): void {
    const names = this.bots.vehicles.map((_, i) => this.net.displayName(BOT_ID_BASE + i))
    if (!names.length) return
    if (!this.clumsyName || !names.includes(this.clumsyName)) {
      // The clumsiest voice present; ties go to the first.
      let best = -1
      names.forEach((n, i) => { const c = VOICES[voiceFor(this.identity(BOT_ID_BASE + i))].clumsy; if (c > best) { best = c; this.clumsyName = n } })
      this.mishaps = new MishapSchedule(this.clumsyName ?? 'clumsy', this.time, () => botMishaps.value)
    }
    if (!this.mishaps?.due(this.time)) return
    const i = names.indexOf(this.clumsyName!)
    const id = BOT_ID_BASE + i, brain = this.bots.brainList[i], v = this.bots.vehicles[i]
    if (!brain?.mind || brain.directive || brain.raceGoal || this.rescues.has(id) || this.rescuing(id) || this.escorting(id) !== null) return
    const p = v.body.translation()
    const spot = this.troubleNear(p.x, p.z)
    if (!spot) { this.mishaps.later(this.time, 20); return }
    this.mishaps.happened(this.time)
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

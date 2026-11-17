/**
 * Puts the banter director (Director.ts) in the game. Only the client that simulates the
 * bots (the host) runs it: it reads the real game state, the director decides, and the lines
 * go to the room as the bots' chat, so every player sees the same conversation.
 *
 * Cost: `update` adds a few seconds and returns on almost every frame. Twice a second it
 * samples each bot and player (a translation, a velocity and a height lookup each); once a
 * second the director thinks. Nothing here runs per physics step.
 */
import type { Game, System } from '../../core/Game'
import type { Vehicle } from '../../vehicles/Vehicle'
import { BOT_ID_BASE, MODE_TAG } from '../../../shared/protocol'
import { worldLavaAltitude } from '../../../shared/params'
import { liveBots } from '../../net/bots'
import type { ChatChannel } from '../../net/chat'
import type { BotBrain, BotTerrain } from '../BotBrain'
import { canDrive, followYou, topThrottle } from '../params'
import { pointsOfInterest, type PointOfInterest } from '../nav'
import { BanterDirector, type BanterBot, type BanterPlayer, type Directive } from './Director'
import { cloudCoverage } from '../../world/sky/skyParams'
import { terrainLook } from '../../world/terrain/settings'
import { HostRescue } from '../rescue/HostRescue'
import type { BotGearHooks } from '../gear'
import type { Navigator } from '../pilot/types'
import { params } from '../../../shared/params'

/** What the bridge needs from networking. NetClient satisfies it. */
export interface BanterNet {
  readonly isHost: boolean
  readonly connected: boolean
  readonly id: number
  readonly mode: number
  readonly chat: ChatChannel
  readonly players: ReadonlyMap<number, { id: number; kind: string; bot?: boolean }>
  displayName(id: number): string
  /** A bot's hidden role, for its voice. */
  botRole?(id: number): string
  vehicleOf(id: number): Vehicle | undefined
  readonly botGearHooks: BotGearHooks
  botCord(id: number): { flying: boolean; to: number | null } | null
}

export interface BanterBots {
  readonly vehicles: readonly Vehicle[]
  readonly brainList: readonly BotBrain[]
  readonly navigator?: Navigator
}

const LOOKS = ['volcanic', 'desert', 'alpine', 'island', 'icy', 'obsidian', 'badlands', 'lunar', 'swampy']
const FEATURE_PHRASES: Record<string, [string, string]> = {
  vent: ['the lava vent', 'the hot spring'], peak: ['the peak', 'the peak'], summit: ['the summit', 'the summit'],
  shore: ['the lava shore', 'the shore'], 'road-end': ['the end of the road', 'the end of the road'],
  'road-mid': ['the road', 'the road'], spawn: ['the landing pad', 'the landing pad'],
}
const SAMPLE = 0.5
const THINK = 1

interface Track { air: number; idle: number; flipped: number }

export class HostBanter implements System {
  director: BanterDirector | null = null
  /** Bots rescuing each other (src/bots/rescue); runs with chatter on or off. */
  rescue: HostRescue | null = null
  private sampleTime = 0
  private thinkTime = 0
  private readonly tracks = new Map<number, Track>()
  private botViews: BanterBot[] = []
  private playerViews: BanterPlayer[] = []
  private pois: PointOfInterest[] | null = null
  private readonly unsubscribe: () => void
  private hour = 12
  /** Time spent in update, ms, for the cost report. */
  readonly cost = { calls: 0, ms: 0 }

  constructor(
    private readonly game: Game,
    private readonly terrain: BotTerrain,
    private readonly net: BanterNet,
    private readonly bots: BanterBots,
    private readonly environment?: { readonly hour: number },
    private readonly onLine?: (bot: number, name: string, text: string) => void,
  ) {
    terrain.onRegenerate?.(() => { this.pois = null })
    // People's lines reach the director; it decides whether the bots answer or act.
    this.unsubscribe = net.chat.onHear((line) => {
      if (!line.bot && !line.system && this.director && this.net.isHost) this.director.hear(line.from, line.text)
    })
  }

  update(dt: number): void {
    const t0 = performance.now()
    this.sampleTime += dt; this.thinkTime += dt
    if (this.sampleTime < SAMPLE) return
    const elapsed = this.sampleTime
    this.sampleTime = 0
    const net = this.net
    if (!this.net.connected || !this.net.isHost) { this.director = null; this.rescue?.dispose(); this.rescue = null; this.tracks.clear(); return }
    this.director ??= new BanterDirector(this.world(), this.hooks(), { seed: `${this.net.id}:${Date.now()}`, onLine: this.onLine })
    this.rescue ??= new HostRescue(this.terrain, {
      get isHost() { return net.isHost }, get connected() { return net.connected }, get mode() { return net.mode },
      vehicleOf: (id) => net.vehicleOf(id), get botGearHooks() { return net.botGearHooks }, botCord: (id) => net.botCord(id),
      displayName: (id) => net.displayName(id), botRole: (id) => net.botRole?.(id) ?? '', people: () => [...net.players.values()].filter((p) => !p.bot).map((p) => p.id),
    }, this.bots, this.bots.navigator ?? null, (e) => this.director?.rescue(e), (bot) => this.withPlayer(bot))
    this.rescue.update(elapsed)
    this.sample(elapsed)
    if (this.thinkTime >= THINK) { this.thinkTime = 0; this.director.tick() }
    this.cost.calls++; this.cost.ms += performance.now() - t0
  }

  dispose(): void { this.unsubscribe(); this.rescue?.dispose() }

  /** The player a bot is with: one who asked it, or the host it trails by default when close. */
  private withPlayer(bot: number): number | null {
    const asked = this.director?.playerOf(bot) ?? null
    if (asked !== null) return asked
    const brain = this.bots.brainList[bot - BOT_ID_BASE]
    const host = this.net.vehicleOf(this.net.id)
    if (!brain || !host || brain.mood !== 'chase') return null
    const a = brain.vehicle.body.translation(), b = host.body.translation()
    return Math.hypot(a.x - b.x, a.z - b.z) < 50 ? this.net.id : null
  }

  private sample(dt: number): void {
    this.hour = this.environment?.hour ?? this.hour
    const lava = worldLavaAltitude.value
    const lavaSea = Math.round(Number(params.get('world.seaKind')?.value ?? 0)) === 0
    const brains = this.bots.brainList
    const views: BanterBot[] = []
    for (const [id, v] of liveBots(this.bots.vehicles, this.game.world)) {
      const brain = brains[id - BOT_ID_BASE]
      if (!brain) continue
      const p = v.body.translation(), vel = v.body.linvel()
      const track = this.track(id, v, dt)
      const trouble = brain.trouble
      const sight = brain.mind?.sightKind ?? null
      const dest = brain.mind?.activity.destination
      views.push({
        id, name: this.net.displayName(id), role: this.net.botRole?.(id), x: p.x, y: p.y, z: p.z, speed: Math.hypot(vel.x, vel.z),
        activity: brain.mind?.activity.kind ?? brain.mood, caption: brain.mind?.caption ?? 'driving about',
        stuckFor: trouble.stuck, flippedFor: Math.max(trouble.flipped, track.flipped), bogFor: trouble.bog, airFor: track.air, resets: brain.rescues,
        nearLava: lavaSea && p.y - lava < 2.5 && p.y - lava > -1,
        sight: sight && dest && Math.hypot(dest.x - p.x, dest.z - p.z) < 30 ? sight : null,
      })
    }
    this.botViews = views
    const players: BanterPlayer[] = []
    for (const info of this.net.players.values()) {
      if (info.bot) continue
      const v = this.net.vehicleOf(info.id)
      if (!v || !v.body.isValid()) continue
      const p = v.body.translation(), vel = v.body.linvel()
      const track = this.track(info.id, v, dt)
      players.push({ id: info.id, name: this.net.displayName(info.id), x: p.x, y: p.y, z: p.z, speed: Math.hypot(vel.x, vel.z), airFor: track.air, idleFor: track.idle, kind: info.kind.replace('buggy-classic', 'buggy').replace('buggy-syn3h', 'buggy'), flippedFor: track.flipped, stuckFor: 0 })
    }
    this.playerViews = players
    // A chasing bot that reaches its player has tagged them.
    for (const b of views) {
      const brain = brains[b.id - BOT_ID_BASE]
      const d = brain?.directive
      if (d?.kind !== 'chase') continue
      const q = d.leader.body.translation()
      if (Math.hypot(q.x - b.x, q.z - b.z) < 6) this.director?.caught(b.id)
    }
  }

  /** Seconds in the air, sitting still and upside down, accumulated per vehicle. */
  private track(id: number, v: Vehicle, dt: number): Track {
    let t = this.tracks.get(id)
    if (!t) this.tracks.set(id, (t = { air: 0, idle: 0, flipped: 0 }))
    const p = v.body.translation(), vel = v.body.linvel(), q = v.body.rotation()
    const ground = this.terrain.heightAt(p.x, p.z)
    t.air = p.y - ground > 2.6 ? t.air + dt : 0
    t.idle = Math.hypot(vel.x, vel.y, vel.z) < 0.8 ? t.idle + dt : 0
    // The body's up vector's y component: 1 - 2(x^2 + z^2).
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
    t.flipped = upY < 0.2 ? t.flipped + dt : 0
    return t
  }

  private world() {
    const self = this
    return {
      now: () => this.game.time,
      bots: () => self.botViews,
      players: () => self.playerViews,
      hour: () => self.hour,
      planet: () => LOOKS[Math.round(terrainLook.value)] ?? 'small',
      sea: () => (Math.round(Number(params.get('world.seaKind')?.value ?? 0)) === 0 ? 'lava' as const : 'water' as const),
      cloudy: () => cloudCoverage.value > 0.55,
      feature: (x: number, z: number) => {
        self.pois ??= pointsOfInterest(self.terrain)
        const water = Math.round(Number(params.get('world.seaKind')?.value ?? 0)) === 1
        let best: PointOfInterest | null = null, d = 45
        for (const poi of self.pois) {
          if (poi.kind === 'road-mid') continue
          const dist = Math.hypot(poi.x - x, poi.z - z)
          if (dist < d) { d = dist; best = poi }
        }
        if (!best) return null
        const phrase = FEATURE_PHRASES[best.kind]?.[water ? 1 : 0] ?? 'this spot'
        return { kind: best.kind, phrase }
      },
    }
  }

  private hooks() {
    return {
      say: (bot: number, text: string) => this.net.chat.sendAsBot(bot, text),
      allows: (what: 'follow' | 'drive') => canDrive.value && topThrottle.value > 0 && (what === 'drive' || followYou.value > 0),
      tagOn: () => this.net.mode === MODE_TAG,
      direct: (bot: number, d: Directive | null) => this.direct(bot, d),
      helpPlayer: (player: number) => this.rescue?.helpPlayer(player) ?? false,
    }
  }

  private direct(botId: number, d: Directive | null): boolean {
    const brain = this.bots.brainList[botId - BOT_ID_BASE]
    if (!brain?.mind) return false
    // A rescue in progress owns the bot; chat requests wait for it.
    if (brain.directive?.kind === 'control') return false
    if (!d) { brain.directive = null; return true }
    const until = brain.clock + d.seconds
    if (d.kind === 'stay') { brain.directive = { kind: 'stay', until }; return true }
    const leader = d.kind === 'pursueBot' ? this.net.vehicleOf(d.bot) : this.net.vehicleOf(d.player)
    if (!leader || !leader.body.isValid()) return false
    switch (d.kind) {
      case 'follow': brain.directive = { kind: 'follow', leader, until }; return true
      case 'chase': case 'pursueBot': brain.directive = { kind: 'chase', leader, until }; return true
      case 'avoid': brain.directive = { kind: 'avoid', threat: leader, until }; return true
      case 'goto': {
        const p = leader.body.translation()
        brain.directive = { kind: 'goto', x: p.x, y: p.y, z: p.z, radius: 9, until }
        return true
      }
    }
  }
}

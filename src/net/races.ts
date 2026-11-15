import type { ClientMessage, RaceState } from '../../shared/protocol'
import type { BotRaceCandidate, BotRaceHooks } from '../bots/races'

export interface RaceRole { id: number; host: boolean; connected: boolean }
export interface RacePresentation {
  /** Actual local play/lobby state, supplied by the composition root. */
  isDriving(): boolean
  setRace?(snapshot: Readonly<RaceState> | null, roomNow: () => number, role: Readonly<RaceRole>): void
}
export interface RaceBots {
  setRaces?(hooks: BotRaceHooks | null): void
  applyRace?(snapshot: RaceState | null): void
}

/** Network lifecycle only. The bot director decides races; the UI only presents snapshots. */
export class RaceBridge {
  snapshot: RaceState | null = null
  private presentation: RacePresentation | null = null
  private installed: RaceBots | null = null
  private readyKey = ''
  private roleKey = ''
  private readonly hooks: BotRaceHooks

  constructor(private readonly ctx: {
    now(): number
    role(): RaceRole
    synced(): boolean
    bots(): RaceBots | null
    candidates(): readonly BotRaceCandidate[]
    send(message: ClientMessage): void
  }) {
    this.hooks = { now: ctx.now, candidates: () => this.driving ? ctx.candidates() : [], publish: race => {
      const role = ctx.role()
      if (role.connected && role.host) ctx.send({ type: 'race', race })
    } }
  }

  get driving(): boolean { return this.presentation?.isDriving() === true }
  configure(presentation: RacePresentation): void { this.presentation = presentation; this.update(); this.present() }

  update(): void {
    const role = this.ctx.role()
    const ready = role.connected ? `${role.id}:${this.driving}` : ''
    if (ready !== this.readyKey) {
      this.readyKey = ready
      if (role.connected) this.ctx.send({ type: 'race-ready', driving: this.driving })
    }
    const bots = role.connected && role.host && this.ctx.synced() && this.presentation ? this.ctx.bots() : null
    if (bots !== this.installed) {
      this.installed?.setRaces?.(null)
      this.installed = bots
      bots?.setRaces?.(this.hooks)
      bots?.applyRace?.(this.snapshot)
    }
    const key = `${role.id}:${role.host}:${role.connected}`
    if (key !== this.roleKey) { this.roleKey = key; this.present() }
  }

  receive(snapshot: RaceState | null): void {
    // WebSocket delivery is ordered. A lower revision can be a rejection correction for
    // an optimistic host proposal, so only the director knows whether it is stale.
    this.snapshot = snapshot
    this.installed?.applyRace?.(snapshot)
    this.present()
  }

  leave(): void {
    const role = this.ctx.role()
    if (role.connected && this.snapshot?.participants.some(p => p.id === role.id && p.status === 'racing')) {
      this.ctx.send({ type: 'race-leave', id: this.snapshot.id })
    }
  }

  cancel(): void {
    const role = this.ctx.role(), race = this.snapshot
    if (role.connected && role.host && race && (race.phase === 'countdown' || race.phase === 'running')) {
      this.ctx.send({ type: 'race', race: { ...race, revision: race.revision + 1, phase: 'cancelled', winnerId: null, reason: 'Host cancelled' } })
    }
  }

  disconnect(): void {
    this.readyKey = ''; this.roleKey = ''
    this.installed?.setRaces?.(null); this.installed = null
    this.snapshot = null
    this.present()
  }

  private present(): void { this.presentation?.setRace?.(this.snapshot, this.ctx.now, this.ctx.role()) }
}

import { ChatBucket } from '../shared/chat'
import { MAX_JSON_BYTES, type ServerMessage } from '../shared/protocol'
import { cleanVoiceSignal } from '../shared/voice'
import type { Peer } from './room'

const VOICE_PARTICIPANTS = 2
// Allow trickled candidates to arrive in a burst, with a separate sustained voice limit.
const VOICE_BURST = 32
const VOICE_REFILL_S = 0.1

interface VoicePlayer {
  info: { id: number }
  heldUntil: number
  voiceReady: boolean
  voiceBudget: ChatBucket | null
}

function sendTo(peer: Peer, message: ServerMessage): void {
  peer.send(JSON.stringify(message))
}

/** A relay sees only the human connections in its own room. */
export class RoomVoice {
  constructor(
    private readonly players: ReadonlyMap<Peer, VoicePlayer>,
    private readonly allowed: () => boolean,
    private readonly now: () => number,
  ) {}

  enable(peer: Peer, player: VoicePlayer): void {
    if (player.voiceReady || !this.allowed() || !this.takeVoiceBudget(player)) return
    const readyCount = [...this.players.values()].filter(member => member.voiceReady).length
    if (readyCount < VOICE_PARTICIPANTS) this.setReady(peer, player, true)
    else sendTo(peer, { type: 'voice-full' })
  }

  disable(peer: Peer, player: VoicePlayer): void {
    this.setReady(peer, player, false)
  }

  /** Restore consent for the same live socket after hibernation. */
  restoreReady(player: VoicePlayer, ready: boolean): void {
    player.voiceReady = ready && this.allowed()
  }

  disableAll(): void {
    for (const [peer, player] of this.players) this.setReady(peer, player, false)
  }

  private takeVoiceBudget(player: VoicePlayer): boolean {
    const now = this.now()
    player.voiceBudget ??= new ChatBucket(VOICE_BURST, VOICE_REFILL_S, now)
    return player.voiceBudget.take(now)
  }

  private setReady(peer: Peer, player: VoicePlayer, enabled: boolean): void {
    if (player.voiceReady === enabled) return
    player.voiceReady = enabled
    peer.setVoiceReady?.(enabled)
    for (const [otherPeer, other] of this.players) {
      if (other === player || !other.voiceReady) continue
      sendTo(otherPeer, { type: 'voice-ready', from: player.info.id, enabled })
      if (enabled) sendTo(peer, { type: 'voice-ready', from: other.info.id, enabled: true })
    }
  }

  relay(player: VoicePlayer, to: unknown, raw: unknown): void {
    if (!player.voiceReady || !this.allowed() || !this.takeVoiceBudget(player) || !Number.isInteger(to)) return
    for (const [peer, recipient] of this.players) {
      if (recipient.info.id !== to || recipient === player || !recipient.voiceReady || recipient.heldUntil) continue
      const signal = cleanVoiceSignal(raw)
      if (!signal) return
      const frame = JSON.stringify({ type: 'voice-signal', from: player.info.id, signal } satisfies ServerMessage)
      if (frame.length <= MAX_JSON_BYTES) peer.send(frame)
      return
    }
  }
}

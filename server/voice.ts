import { ChatBucket } from '../shared/chat'
import { MAX_JSON_BYTES, type ServerMessage } from '../shared/protocol'
import { cleanVoiceSignal, DEFAULT_VOICE_CHANNEL, isVoiceChannel, type VoiceChannel } from '../shared/voice'
import type { Peer } from './room'

const VOICE_PARTICIPANTS = 2
// Allow trickled candidates to arrive in a burst, with a separate sustained voice limit.
const VOICE_BURST = 32
const VOICE_REFILL_S = 0.1

interface VoicePlayer {
  info: { id: number }
  heldUntil: number
  voiceReady: boolean
  voiceChannel: VoiceChannel
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

  /** Restore consent and channel for the same live socket after hibernation. */
  restoreState(player: VoicePlayer, ready: boolean, channel: unknown): void {
    player.voiceReady = ready && this.allowed()
    player.voiceChannel = player.voiceReady && isVoiceChannel(channel) ? channel : DEFAULT_VOICE_CHANNEL
  }

  setChannel(peer: Peer, player: VoicePlayer, channel: unknown): void {
    if (!player.voiceReady || !this.allowed() || !isVoiceChannel(channel) || player.voiceChannel === channel) return
    if (!this.takeVoiceBudget(player)) return
    player.voiceChannel = channel
    peer.setVoiceState?.(true, channel)
    for (const [otherPeer, other] of this.players) {
      if (other !== player && other.voiceReady) this.sendChannel(otherPeer, player)
    }
  }

  private sendChannel(peer: Peer, speaker: VoicePlayer): void {
    sendTo(peer, { type: 'voice-channel', from: speaker.info.id, channel: speaker.voiceChannel })
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
    if (!enabled) player.voiceChannel = DEFAULT_VOICE_CHANNEL
    peer.setVoiceState?.(enabled, player.voiceChannel)
    for (const [otherPeer, other] of this.players) {
      if (other === player || !other.voiceReady) continue
      sendTo(otherPeer, { type: 'voice-ready', from: player.info.id, enabled })
      if (enabled) {
        sendTo(peer, { type: 'voice-ready', from: other.info.id, enabled: true })
        this.sendChannel(otherPeer, player)
        this.sendChannel(peer, other)
      }
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

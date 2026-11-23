export { voiceOn } from './params'

/** Accept a canonical room slug from the server's welcome. */
export function voiceEligible(room: string): boolean {
  return /^[a-z0-9_-]{1,32}$/.test(room) && room !== 'lobby'
}

export type VoiceSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | {
      type: 'candidate'
      candidate: string
      sdpMid?: string | null
      sdpMLineIndex?: number | null
      usernameFragment?: string | null
    }

export const MAX_VOICE_SDP_BYTES = 6_144
export const MAX_VOICE_CANDIDATE_BYTES = 1_024
const encoder = new TextEncoder()

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length <= maxBytes && encoder.encode(value).length <= maxBytes
}

function optionalText(value: unknown, maxBytes: number): value is string | null | undefined {
  return value == null || boundedText(value, maxBytes)
}

/** Rebuild the message so only recognized signaling fields can reach another player. */
export function cleanVoiceSignal(raw: unknown): VoiceSignal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { type, sdp, candidate, sdpMid, sdpMLineIndex, usernameFragment } = raw as Record<string, unknown>
  if (type === 'offer' || type === 'answer') {
    if (!boundedText(sdp, MAX_VOICE_SDP_BYTES) || !/^v=0\r?\n/.test(sdp)) return null
    return { type, sdp }
  }
  if (type !== 'candidate' || !boundedText(candidate, MAX_VOICE_CANDIDATE_BYTES)) return null
  if (candidate !== '' && !candidate.startsWith('candidate:')) return null
  if (!optionalText(sdpMid, 64) || !optionalText(usernameFragment, 256)) return null
  if (sdpMLineIndex != null && (typeof sdpMLineIndex !== 'number' || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 65535)) return null
  return { type, candidate, sdpMid, sdpMLineIndex, usernameFragment }
}

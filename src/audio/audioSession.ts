function browserSession(): { type: string } | undefined {
  return (globalThis.navigator as (Navigator & { audioSession?: { type: string } }) | undefined)?.audioSession
}

let captureCount = 0
let gameType = 'auto'

function applyType(type: string) {
  const session = browserSession()
  if (session && session.type !== type) {
    try { session.type = type } catch { /* Older browsers can reject unsupported types. */ }
  }
}

export function declareAudioSession(playing: boolean): void {
  gameType = playing ? 'playback' : 'auto'
  applyType(captureCount ? 'play-and-record' : gameType)
}

/** WebKit rejects microphone capture in a playback-only session, even with permission. */
export function beginMicrophoneSession(): () => void {
  if (!captureCount) gameType = browserSession()?.type ?? gameType
  captureCount++
  applyType('play-and-record')
  let released = false
  return () => {
    if (released) return
    released = true
    if (--captureCount === 0) applyType(gameType)
  }
}

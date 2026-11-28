/** Hold the current gain before replacing its fade. Firefox ESR lacks the native hold. */
export function holdGain(gain: AudioParam, now: number): void {
  if (typeof gain.cancelAndHoldAtTime === 'function') {
    gain.cancelAndHoldAtTime(now)
    return
  }
  const current = gain.value
  gain.cancelScheduledValues(now)
  gain.setValueAtTime(current, now)
}

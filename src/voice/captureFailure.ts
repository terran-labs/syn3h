const failureText = {
  NotAllowedError: 'Microphone permission denied, dismissed or blocked. Check this site’s microphone setting in Safari.',
  NotFoundError: 'No microphone found.',
  NotReadableError: 'The microphone is in use or the system refused it.',
  AbortError: 'The microphone is in use or the system refused it.',
  OverconstrainedError: 'The microphone cannot provide the requested settings.',
  SecurityError: 'Microphone capture is blocked in this browser context. Open the HTTPS link in Safari.',
  TypeError: 'Microphone capture is unavailable here. Check HTTPS and open the link directly in Safari.',
  'Capture API unavailable': 'This browser has no microphone capture API. Open the HTTPS link directly in Safari.',
  'WebRTC unavailable': 'This browser cannot make a voice connection.',
  'Game audio unavailable': 'The game audio output could not start.',
  'No live track': 'Capture returned without a live microphone track.',
  'Track ended': 'The system stopped the microphone.',
  InvalidStateError: 'The page is inactive or its audio session cannot capture. Check Voice diagnostics.',
  Error: 'Microphone capture failed.',
  UnknownError: 'Microphone capture failed.',
} as const

export type CaptureFailure = keyof typeof failureText

/** Only recognized names cross into diagnostics. Browser messages can contain device labels. */
export function failureName(error: unknown): CaptureFailure {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined
  return typeof name === 'string' && Object.hasOwn(failureText, name) ? name as CaptureFailure : 'UnknownError'
}

export function describeFailure(reason: CaptureFailure): string {
  return `${failureText[reason]} (${reason})`
}

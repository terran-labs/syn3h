/**
 * Screenshots from the pause screen (the owner, 19 November 2026: "You should have a screenshot
 * button, and you should have an S keyboard shortcut for it ... for community submissions of
 * all the gorgeous views we're building").
 *
 * The picture is the game view alone, at the canvas's full backing resolution: Game.snapshot
 * draws one frame with the paused camera and copies it into a 2D canvas in the same task, so
 * neither backend needs preserveDrawingBuffer. The page's interface is never in the canvas, so
 * nothing has to be hidden for the shot. Nothing is uploaded: the file goes to the share sheet
 * (phones, where files can be shared) or a download, and nowhere else.
 */

/** What a key does on the pause screen. Only while paused; in play none of these apply. */
export type PausedKeyAction = 'shot' | 'resume' | null
/** The keys that drive. While paused, all but S resume; S takes the screenshot. */
export const DRIVE_KEYS: ReadonlySet<string> = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
export const SHOT_KEY = 'KeyS'

/**
 * The pause screen's keys. S is reverse and brake while driving, so it is a shortcut only while
 * the player's own pause holds, never on a held key's repeat and never inside a text field;
 * outside that it is nothing here and drives as always.
 */
export function pausedKeyAction(code: string, state: { paused: boolean; repeat: boolean; typing: boolean }): PausedKeyAction {
  if (!state.paused || state.repeat || state.typing) return null
  if (code === SHOT_KEY) return 'shot'
  return DRIVE_KEYS.has(code) ? 'resume' : null
}

/** Lower case, letters and digits joined by single hyphens: "Zansaeth" and "Badlands" become "zansaeth-badlands". */
function slug(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** syn3h-zansaeth-badlands-20261119-2010.png: the world, its planet, and the local time to the minute. */
export function shotFileName(world: string, planet: string, at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`
  return `${['syn3h', slug(world), slug(planet)].filter(Boolean).join('-')}-${stamp}.png`
}

/**
 * Something drawn onto the picture before it is encoded, such as a wordmark and the world's
 * name in a corner. None ships until the owner chooses one; the hook is here so it can.
 */
export type ShotMark = (context: CanvasRenderingContext2D, width: number, height: number) => void

/** Encode the copied frame as a PNG, with a mark drawn on first if there is one. toBlob encodes off the main thread. */
export function encodeShot(frame: HTMLCanvasElement, mark?: ShotMark): Promise<Blob | null> {
  if (mark) { const context = frame.getContext('2d'); if (context) mark(context, frame.width, frame.height) }
  return new Promise(resolve => frame.toBlob(blob => resolve(blob), 'image/png'))
}

export type ShotOutcome = 'shared' | 'saved' | 'cancelled' | 'blocked'

/** The picture as a file the share sheet can take, or null where files cannot be shared. */
export function shareableShot(blob: Blob, name: string): File | null {
  if (typeof File === 'undefined' || typeof navigator.share !== 'function') return null
  const file = new File([blob], name, { type: 'image/png' })
  return navigator.canShare?.({ files: [file] }) ? file : null
}

/**
 * Open the share sheet with the file. Safari opens it only within a short time of the tap that
 * asked; when the encode outlasts that, it refuses (NotAllowedError) and this says 'blocked',
 * so the caller can offer a second tap that shares at once, the file already made.
 */
export async function shareShot(file: File): Promise<ShotOutcome> {
  try { await navigator.share({ files: [file] }); return 'shared' }
  catch (error) {
    const name = (error as DOMException)?.name
    return name === 'AbortError' ? 'cancelled' : name === 'NotAllowedError' ? 'blocked' : 'cancelled'
  }
}

/** Save the picture as a download. */
export function downloadShot(blob: Blob, name: string): ShotOutcome {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name; link.style.display = 'none'
  document.body.append(link); link.click(); link.remove()
  // The download has its own copy once started; give the browser a moment before letting go.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'saved'
}

/**
 * Hand the picture to the player: the share sheet on touch screens where the browser can share
 * files (a download is awkward on a phone), otherwise a download. A dismissed sheet is
 * cancelled, not an error. A sheet the browser refused for lack of a fresh tap is 'blocked'.
 */
export async function deliverShot(blob: Blob, name: string, preferShare: boolean): Promise<{ outcome: ShotOutcome; file: File | null }> {
  const file = preferShare ? shareableShot(blob, name) : null
  if (file) return { outcome: await shareShot(file), file }
  return { outcome: downloadShot(blob, name), file: null }
}

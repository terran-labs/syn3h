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

export type ShotOutcome = 'shared' | 'saved' | 'cancelled'

/**
 * Hand the picture to the player: the share sheet on touch screens where the browser can share
 * files (a download is awkward on a phone), otherwise a download. A share the player dismisses
 * is cancelled, not an error; a share the browser refuses falls back to the download.
 */
export async function deliverShot(blob: Blob, name: string, preferShare: boolean): Promise<ShotOutcome> {
  if (preferShare && typeof File !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], name, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return 'shared' }
      catch (error) { if ((error as DOMException)?.name === 'AbortError') return 'cancelled' }
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name; link.style.display = 'none'
  document.body.append(link); link.click(); link.remove()
  // The download has its own copy once started; give the browser a moment before letting go.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'saved'
}

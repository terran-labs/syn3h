/**
 * What kind of device a page runs on, in a few coarse words: the one copy for launch analytics
 * (src/net/analytics.ts, the session's device class) and the players card (the roster's short
 * label). Pure: no browser globals are read at import time, so the room server can import the
 * label list to allowlist what clients send, and tests can pass any user agent.
 *
 * Deliberately coarse. A label or class says what kind of thing it is, never which one: no OS
 * versions, no browser versions, and iPhone and iPad models are never guessed. deviceModel is
 * the only finer field (Android's own model name, for display only), and analytics does not
 * record it.
 */

/** Words for the players card and the allowlist for what a client may send. */
export const DEVICE_LABELS = ['iPhone', 'iPad', 'Android phone', 'Android tablet', 'Mac', 'Windows', 'Linux', 'ChromeOS', 'Device'] as const
export type DeviceLabel = (typeof DEVICE_LABELS)[number]
export type DeviceClass = 'phone' | 'tablet' | 'desktop'

/** A label a client sent, if it is one of ours. */
export function cleanDeviceLabel(v: unknown): DeviceLabel | undefined {
  return typeof v === 'string' && (DEVICE_LABELS as readonly string[]).includes(v) ? (v as DeviceLabel) : undefined
}

interface NavLike {
  userAgent?: string
  maxTouchPoints?: number
  userAgentData?: { mobile?: boolean; platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }> }
}
const nav = (): NavLike => (typeof navigator === 'undefined' ? {} : (navigator as unknown as NavLike))
const coarsePointer = (): boolean => {
  try { return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches } catch { return false }
}

/** Phone, tablet or desktop, from the user agent and touch. iPadOS's desktop user agent is a tablet. */
export function deviceClass(ua: string = nav().userAgent ?? '', coarse = coarsePointer(), maxTouch = nav().maxTouchPoints ?? 0): DeviceClass {
  if (/iPhone|iPod|Windows Phone|Android.+Mobile|Mobile.+Firefox/.test(ua)) return 'phone'
  if (/iPad|Android|Tablet|Silk/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'tablet'
  return coarse && maxTouch > 1 ? 'tablet' : 'desktop'
}

/** The short display word for this device (DEVICE_LABELS). */
export function deviceLabel(ua: string = nav().userAgent ?? '', maxTouch = nav().maxTouchPoints ?? 0): DeviceLabel {
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux|X11/.test(ua)) return 'Linux'
  return 'Device'
}

const MODEL = /^[A-Za-z0-9][A-Za-z0-9 +()-]{1,23}$/

/**
 * Android's own model name ("Pixel 9"), for display on the players card only: asked of the
 * browser (User-Agent Client Hints), never guessed, never for iPhone or iPad, and undefined
 * unless it is a short plain name. Launch analytics does not record it.
 */
export async function deviceModel(n: NavLike = nav()): Promise<string | undefined> {
  try {
    if (!/Android/.test(n.userAgent ?? '') || !n.userAgentData?.getHighEntropyValues) return undefined
    const model = (await n.userAgentData.getHighEntropyValues(['model'])).model?.trim()
    return model && MODEL.test(model) ? model : undefined
  } catch {
    return undefined
  }
}

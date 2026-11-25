/**
 * The device this page runs on: its class (phone, tablet, desktop), a label from the shared list
 * (shared/device.ts) and, where the browser volunteers one, a model. One module for the roster
 * and for analytics.
 *
 * What a browser can truly tell, and nothing more:
 * - iPhone and iPad never reveal their model, and iPadOS Safari even calls itself a Mac: a "Mac"
 *   with more than one touch point is an iPad. No model is guessed from the screen size.
 * - Android Chrome gives a model only through the high-entropy client hint
 *   (userAgentData.getHighEntropyValues(['model'])), so it is asked for there and nowhere else.
 * - Desktops give an operating system family.
 * Pure functions with no browser globals at import; each defaults to navigator when called bare.
 */
import { cleanDeviceModel, type DeviceClass, type DeviceLabel } from '../../shared/device'
export { DEVICE_LABELS, cleanDeviceLabel, cleanDeviceModel, type DeviceClass, type DeviceLabel } from '../../shared/device'

interface NavLike { userAgent?: string; maxTouchPoints?: number; userAgentData?: { mobile?: boolean; platform?: string; getHighEntropyValues?(hints: string[]): Promise<{ model?: string }> } }
const nav = (): NavLike => typeof navigator === 'undefined' ? {} : navigator as unknown as NavLike
const coarsePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** Phone, tablet or desktop, synchronously (analytics sends it with the hello). */
export function deviceClassSync(ua = nav().userAgent ?? '', coarse = coarsePointer(), maxTouch = nav().maxTouchPoints ?? 0): DeviceClass {
  if (/iPhone|iPod|Windows Phone|Android.+Mobile|Mobile.+Firefox/.test(ua)) return 'phone'
  if (/iPad|Android|Tablet|Silk/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'tablet'
  return coarse && maxTouch > 1 ? 'tablet' : 'desktop'
}

/** The label from the shared list, synchronously. */
export function deviceLabelSync(ua = nav().userAgent ?? '', coarse = coarsePointer(), maxTouch = nav().maxTouchPoints ?? 0): DeviceLabel {
  const cls = deviceClassSync(ua, coarse, maxTouch)
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'iPad'
  if (/Android/.test(ua)) return cls === 'phone' ? 'Android phone' : 'Android tablet'
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Linux|X11/.test(ua)) return 'Linux PC'
  return cls === 'phone' ? 'Phone' : cls === 'tablet' ? 'Tablet' : 'Computer'
}

/** A model, only where the browser volunteers it: Android, through client hints. Never guessed. */
export async function deviceModel(n: NavLike = nav()): Promise<string | undefined> {
  if (!/Android/.test(n.userAgent ?? '') || !n.userAgentData?.getHighEntropyValues) return undefined
  try { return cleanDeviceModel((await n.userAgentData.getHighEntropyValues(['model'])).model) } catch { return undefined }
}

/** Everything at once: class and label at once, a model when one comes. */
export async function detectDevice(n: NavLike = nav()): Promise<{ class: DeviceClass; label: DeviceLabel; model?: string }> {
  const ua = n.userAgent ?? '', touch = n.maxTouchPoints ?? 0
  const model = await deviceModel(n)
  return { class: deviceClassSync(ua, coarsePointer(), touch), label: deviceLabelSync(ua, coarsePointer(), touch), ...(model ? { model } : {}) }
}

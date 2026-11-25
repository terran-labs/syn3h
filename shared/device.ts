/**
 * What device a player is on, in words a browser can honestly support (the owner, 25 November
 * 2026: "the device they're playing on" beside each name). Shared by the roster label
 * (feat/player-info-and-eject) and the analytics device rows (feat/analytics-device).
 *
 * Pure and server-safe: the room imports it to keep only these words from what a client sends,
 * never free text. The browser side that chooses them is src/core/device.ts.
 */
export const DEVICE_LABELS = ['iPhone', 'iPad', 'Mac', 'Windows PC', 'Linux PC', 'Chromebook', 'Android phone', 'Android tablet', 'Phone', 'Tablet', 'Computer'] as const
export type DeviceLabel = typeof DEVICE_LABELS[number]
export type DeviceClass = 'phone' | 'tablet' | 'desktop'

/** One of DEVICE_LABELS, or nothing. */
export const cleanDeviceLabel = (x: unknown): DeviceLabel | undefined => typeof x === 'string' && (DEVICE_LABELS as readonly string[]).includes(x) ? x as DeviceLabel : undefined

/**
 * A model a browser volunteered (Android Chrome's client hints, "Pixel 9"), for display only:
 * letters, digits, spaces and + ( ) -, at most 24 characters, or nothing. Never used to group
 * anyone in analytics.
 */
export function cleanDeviceModel(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined
  const s = x.trim()
  return /^[A-Za-z0-9][A-Za-z0-9 +()-]{1,23}$/.test(s) ? s : undefined
}

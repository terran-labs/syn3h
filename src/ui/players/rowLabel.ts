/**
 * What the Players card says about where a player is and what they play on, and how
 * much of it fits (the owner, 25 November 2026: "iPhone 18 Pro • Texas, USA ... this could
 * easily be shortened to iPhone • USA"). Pure: no DOM, so the rules are tested directly.
 *
 * Privacy rule: the label is built from two place fields only, the first-level region and the
 * country, so nothing finer can reach the screen even if a roster carried it. The server never
 * sends more; this keeps that true on our side too. A browser cannot know an iPhone's model, so
 * the device word is whatever honest label the server sends (deviceModel ?? deviceLabel).
 */

/** The roster fields this file reads (shared/protocol.ts PlayerInfo, all optional). */
export interface PlayerWhereabouts {
  /** ISO 3166-1 alpha-2, for example "US". Absent when the player hides their location. */
  country?: string
  /** First-level region, for example "Texas". Never finer. */
  region?: string
  /** A coarse device word ("iPhone", "Mac", "Android phone"). */
  deviceLabel?: string
  /** Only when the browser volunteers it (Android client hints), for example "Pixel 9". */
  deviceModel?: string
}

/** Countries people habitually name by their short form; everything else by its English name. */
const SHORT_COUNTRIES: Record<string, string> = { US: 'USA', GB: 'UK', AE: 'UAE' }
let regionNames: Intl.DisplayNames | null | undefined

/** "USA", "UK", "Germany"; null for anything that is not a two-letter code. */
export function countryName(code: string | undefined): string | null {
  const upper = code?.trim().toUpperCase()
  if (!upper || !/^[A-Z]{2}$/.test(upper)) return null
  if (SHORT_COUNTRIES[upper]) return SHORT_COUNTRIES[upper]
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { regionNames = null }
  }
  try { return regionNames?.of(upper) ?? upper } catch { return upper }
}

/** A short single-line piece of text from the wire: trimmed, no control characters, capped. */
function clean(text: string | undefined, max = 32): string {
  return (text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** The device word shown: the model when the browser offered one, otherwise the label. */
export function deviceName(who: PlayerWhereabouts): string {
  return clean(who.deviceModel) || clean(who.deviceLabel)
}

/** "Texas, USA" (full) or "USA" (short); empty when the location is hidden or unknown. */
export function placeName(who: PlayerWhereabouts, full = true): string {
  const country = countryName(who.country)
  if (!country) return ''
  const region = full ? clean(who.region, 40) : ''
  return region && region !== country ? `${region}, ${country}` : country
}

export const LABEL_SEPARATOR = ' • '

/**
 * The row label at each level, longest first, without duplicates:
 * ["iPhone • Texas, USA", "iPhone • USA"]. A row with nothing to say gets [].
 */
export function rowLabels(who: PlayerWhereabouts): string[] {
  const device = deviceName(who)
  const levels = [placeName(who, true), placeName(who, false)].map(place => [device, place].filter(Boolean).join(LABEL_SEPARATOR))
  return levels.filter((text, index) => text && levels.indexOf(text) === index)
}

/**
 * Which label level fits a row, or -1 for none. The name always wins: a label is shown only
 * when the name, the label and the fixed parts (states, speaker, vehicle) all fit whole.
 * `labelWidths` are the measured widths of rowLabels(), longest first.
 */
export function labelLevel(available: number, nameWidth: number, fixedWidth: number, labelWidths: readonly number[], gap = 8): number {
  const room = available - nameWidth - fixedWidth - gap
  return labelWidths.findIndex(width => width <= room)
}

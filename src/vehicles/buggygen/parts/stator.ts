import type * as THREE from 'three'
import { Mesh } from './kit'

/**
 * The hub motor's stator: a short wing across the hub, its span along Z, the wheel axle along
 * X. In section (across the axle) it is a lens, thickest at the hub and thinning to almost
 * nothing at the two open faces of the wheel. Toward each tip the section turns into a bow tie:
 * thin in the middle, flaring at the faces into two horns, and the tip is cut by the rotor
 * ring's inner cylinder, so it nearly touches the ring all round its end. The last stretch of
 * each tip is chrome; that is where the motor glow and sparks sit (LoadedBuggySkin STATOR_TIP).
 *
 * Frame: as LoadedBuggySkin uses the loaded `RimSimple`, recentred on its bounding box.
 */
export const STATOR = {
  /** Half the hub width along the axle, at the root and at the tip horns. */
  rootHalfWidth: .2, tipHalfWidth: .236,
  /** Half thickness at the hub centre and how far out it has thinned to nothing (span, m). */
  rootThick: .096, taperSpan: .32,
  /** Tip section: half thickness in the middle and at the horns. */
  tipMid: .036, tipHorn: .145,
  /** Span where the section starts turning into the tip's bow tie, and where it is complete. */
  turnFrom: .08, turnTo: .33,
  /** Rotor ring cylinder that trims the horns; chrome begins at this span. */
  ring: .347, chromeFrom: .3,
  /** The tip is hollowed between the horns: its middle stops at this span. */
  tipCentre: .246, tipHollowFrom: .2,
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export function buildStator(detail: 0 | 1 | 2): { part: 'stator'; role: string; geometry: THREE.BufferGeometry }[] {
  const s = STATOR
  const around = detail === 0 ? 20 : detail === 1 ? 12 : 8
  const half = detail === 0 ? 9 : detail === 1 ? 5 : 3
  const metal = new Mesh(), chrome = new Mesh()
  /** Half thickness at axle position x and span z, before the section's rounding. */
  const thick = (x: number, z: number, a: number) => {
    const u = Math.min(1, Math.abs(x) / a)
    const root = Math.max(.006, s.rootThick * (1 - (z / s.taperSpan) ** 2)) * (1 - .9 * u ** 4)
    const tip = s.tipMid + (s.tipHorn - s.tipMid) * smooth(.35, .85, u)
    return root + (tip - root) * smooth(s.turnFrom, s.turnTo, z)
  }
  // Span stations from tip to tip, denser toward the tips where the shape changes.
  const spans = Array.from({ length: 2 * half + 1 }, (_, k) => s.ring * Math.sin(Math.PI / 2 * (k - half) / half))
  const ringAt = (z: number, m: Mesh) => {
    const az = Math.abs(z), a = s.rootHalfWidth + (s.tipHalfWidth - s.rootHalfWidth) * smooth(s.turnFrom, s.ring, az)
    return Array.from({ length: around }, (_, k) => {
      const t = 2 * Math.PI * k / around, x = a * Math.cos(t), y = Math.sign(Math.sin(t)) * thick(x, az, a) * Math.sqrt(Math.max(0, 1 - (x / a) ** 8))
      // The tip is trimmed by the rotor ring: no point lies outside its cylinder.
      // Between the horns the tip is hollowed, so the span is remapped toward a concave end.
      const u = Math.abs(x) / a
      const end = Math.min(Math.sqrt(Math.max(0, s.ring ** 2 - y * y)), s.tipCentre + (s.ring - s.tipCentre) * smooth(.4, 1, u))
      const zz = az <= s.tipHollowFrom ? az : s.tipHollowFrom + (az - s.tipHollowFrom) / (s.ring - s.tipHollowFrom) * (end - s.tipHollowFrom)
      return m.vert(x, y, Math.sign(z) * zz)
    })
  }
  let prev: number[] = [], prevChrome = false
  spans.forEach((z, k) => {
    const isChrome = Math.abs(z) > s.chromeFrom, m = isChrome ? chrome : metal
    const ring = ringAt(z, m)
    // A ring shared across a role change is repeated, so each role keeps its own edge.
    if (k) m.skin(prevChrome === isChrome ? prev : ringAt(spans[k - 1], m), ring)
    if (k === 0 || k === spans.length - 1) {
      // Close the tip with a fan on the ring cylinder.
      const c = chrome.vert(0, 0, Math.sign(z) * s.tipCentre)
      for (let j = 0; j < around; j++) if (k) chrome.tri(ring[j], ring[(j + 1) % around], c); else chrome.tri(ring[(j + 1) % around], ring[j], c)
    }
    prev = ring; prevChrome = isChrome
  })
  return [{ part: 'stator', role: 'frame', geometry: metal.geometry() }, { part: 'stator', role: 'chrome', geometry: chrome.geometry() }]
}

export const STATOR_NUMBERS = Object.keys(STATOR).length

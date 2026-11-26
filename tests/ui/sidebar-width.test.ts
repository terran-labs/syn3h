/**
 * The sidebar's width persists on this device and always fits the window. Bugs these catch: a
 * saved width lost on the next visit, a saved width wider than a smaller window allows (the
 * game hidden behind the column), and a throwing or blocked storage crashing the start.
 */
import { expect, it } from 'vitest'
import { DEFAULT_WIDTH, MIN_WIDTH, SIDEBAR_WIDTH_KEY, clampWidth, initialWidth, readWidth, saveWidth, widthLimits } from '../../src/ui/sidebarWidth'

function memory(): Storage {
  const data = new Map<string, string>()
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), removeItem: k => void data.delete(k), clear: () => data.clear(), key: () => null, get length() { return data.size } }
}
const WIDE = 1600

it('restores the saved width on the next visit', () => {
  const storage = memory(), { min, max } = widthLimits(WIDE)
  const chosen = Math.round((min + max) / 2)
  saveWidth(chosen, storage)
  expect(initialWidth(WIDE, storage)).toBe(chosen)
})

it('fits a saved width to a smaller window, and gives it back in a larger one', () => {
  const storage = memory()
  saveWidth(widthLimits(WIDE).max, storage)
  const small = 900
  expect(initialWidth(small, storage)).toBeLessThanOrEqual(widthLimits(small).max)
  expect(initialWidth(small, storage)).toBeGreaterThanOrEqual(widthLimits(small).min)
  expect(initialWidth(WIDE, storage)).toBe(widthLimits(WIDE).max)
})

it('uses the default when storage throws, is missing or holds nonsense, and never throws', () => {
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  expect(() => saveWidth(400, throwing)).not.toThrow()
  expect(readWidth(throwing)).toBeNull()
  expect(initialWidth(WIDE, throwing)).toBe(clampWidth(DEFAULT_WIDTH, WIDE))
  const junk = memory(); junk.setItem(SIDEBAR_WIDTH_KEY, 'wide')
  expect(initialWidth(WIDE, junk)).toBe(clampWidth(DEFAULT_WIDTH, WIDE))
  // A storage getter that itself throws (blocked third-party storage).
  const holder = Object.defineProperty({}, 'localStorage', { get() { throw new Error('denied') }, configurable: true })
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', Object.getOwnPropertyDescriptor(holder, 'localStorage')!)
  try { expect(readWidth()).toBeNull(); expect(() => saveWidth(400)).not.toThrow() }
  finally { if (saved) Object.defineProperty(globalThis, 'localStorage', saved); else delete (globalThis as { localStorage?: unknown }).localStorage }
})

// Bug: a tablet's default column shrunk to 45% of its width (334 px on a 744 px iPad) by the cap
// meant only to limit widening.
it('always allows the default width, on a tablet as on a laptop', () => {
  for (const viewport of [744, 1024, 1280]) {
    const { min, max } = widthLimits(viewport)
    expect(DEFAULT_WIDTH).toBeGreaterThanOrEqual(min)
    expect(DEFAULT_WIDTH).toBeLessThanOrEqual(max)
    expect(clampWidth(DEFAULT_WIDTH, viewport)).toBe(DEFAULT_WIDTH)
  }
})

// Bug: a wide sidebar covering the centred play HUD (the bottom stack, the world name, the
// readouts). The room left beside the HUD caps the width, but never below the default.
it('never grows past the room beside the centred HUD, and the room never shrinks it below the default', () => {
  const room = DEFAULT_WIDTH + 40
  expect(clampWidth(10_000, WIDE, room)).toBe(room)
  expect(widthLimits(WIDE, room).max).toBe(room)
  expect(clampWidth(10_000, WIDE, 0)).toBe(DEFAULT_WIDTH)
  expect(clampWidth(DEFAULT_WIDTH, WIDE, 0)).toBe(DEFAULT_WIDTH)
  expect(clampWidth(0, WIDE, 0)).toBe(MIN_WIDTH)
})

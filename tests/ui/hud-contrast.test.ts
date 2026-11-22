/**
 * HUD text sits on the world, not on a panel. Bugs caught: a text colour too dark to read at
 * night, or a token edit that drops the shadow under floating text altogether. How strong that
 * shadow is over a bright sky is the owner's call (22 November 2026: lighter, no hard dark ring),
 * so its strength is not pinned here. Colours are read from the stylesheet, not pinned.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/ui/exploration.css', import.meta.url), 'utf8')
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim() ?? ''
const rgb = (text: string): [number, number, number, number] => {
  const hex = /^#([0-9a-f]{6})$/i.exec(text)
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as [number, number, number, number]
  const m = /rgb\((\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\)/.exec(text)!
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
}
const over = (top: number[], bottom: number[]) => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3]))
const luminance = (c: number[]) => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

it('keeps HUD text readable over black, with a dark shadow under floating text', () => {
  for (const name of ['--s3-ink', '--s3-dim', '--s3-accent-2']) {
    const text = rgb(token(name))
    expect(contrast(over(text, [0, 0, 0, 1]), [0, 0, 0]), `${name} over black`).toBeGreaterThanOrEqual(4.5)
  }
  // The readouts and the left column use the shared floating-text shadow.
  expect(token('--hud-under')).toBe('var(--float-under)')
  const layers = token('--float-under').split(/,(?![^(]*\))/).map(layer => rgb(layer.replace(/^[^r]*/, '')))
  expect(layers.length).toBeGreaterThan(0)
  for (const [r, g, b, a] of layers) { expect(Math.max(r, g, b)).toBeLessThan(40); expect(a).toBeGreaterThan(0) }
})

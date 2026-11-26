// What "back to default" restores (src/ui/inspector/defaults.ts). The rows themselves are
// checked in the browser by reset-defaults.mjs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultOf, differs } from '../../src/ui/inspector/defaults'
import { defaultTint } from '../../src/ui/glassMaterial'
import { glassStyle, params } from '../../shared/params'

describe('a reset restores the true default', () => {
  afterEach(() => { vi.unstubAllGlobals(); params.set(glassStyle.def.id, glassStyle.def.default) })
  // Bug: a reset that puts every setting back to its declaration, even where the game starts it elsewhere.
  it('is the registry default for an ordinary setting', () => {
    for (const p of params.all()) if (!['hud.surfaceCoverage', 'chat.overlay'].includes(p.def.id)) expect(defaultOf(p.def)).toBe(p.def.default)
    expect(defaultOf({ id: 'paint.gloss', default: 0.42 })).toBe(0.42)
  })
  // Bug: Tint reset to one number while each glass style has its own measured tint.
  it("is the glass style's own tint for Tint", () => {
    for (const style of [0, 1, 2]) {
      params.set(glassStyle.def.id, style)
      expect(defaultOf({ id: 'hud.surfaceCoverage', default: 25 })).toBe(defaultTint(style))
    }
  })
  // Bug: chat over the game switched back on for a phone, where it is off by default.
  it('follows the device for chat over the game', () => {
    const media = (coarse: boolean) => (query: string) => ({ matches: query.includes('coarse') ? coarse : !coarse })
    vi.stubGlobal('matchMedia', media(true))
    expect(defaultOf({ id: 'chat.overlay', default: true })).toBe(false)
    vi.stubGlobal('matchMedia', media(false))
    expect(defaultOf({ id: 'chat.overlay', default: true })).toBe(true)
  })
  // Bug: a value restored from storage as 0.30000000000000004 showing as changed forever.
  it('treats a value a hair from its default as the default', () => {
    expect(differs(0.1 + 0.2, 0.3)).toBe(false)
    expect(differs(0.32, 0.3)).toBe(true)
    expect(differs(true, false)).toBe(true)
    expect(differs(1, undefined)).toBe(false)
  })
})

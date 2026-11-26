/**
 * The Players card's row label, eject stops and moderation words. Each test names the bug it
 * catches; layout, focus and disabled controls are proved in a browser (tests/ui/player-panel.mjs).
 */
import { describe, expect, it } from 'vitest'
import { VEHICLE_KINDS } from '../../shared/protocol'
import { countryName, labelLevel, placeName, rowLabels } from '../../src/ui/players/rowLabel'
import { vehicleGlyph } from '../../src/ui/players/icons'
import { BANISH_STOPS, stopAt, stopForKey } from '../../src/ui/players/EjectDialog'
import { moderationWords } from '../../src/ui/players/PlayerPanel'

describe('row label', () => {
  it('never shows anything finer than region and country (a city or street would leak where someone lives)', () => {
    const who = { country: 'US', region: 'Texas', city: 'Austin', postal: '78701', latitude: 30.27, deviceLabel: 'iPhone' } as Parameters<typeof rowLabels>[0]
    const all = rowLabels(who).join(' ')
    expect(all).not.toMatch(/Austin|78701|30\.27/)
    expect(rowLabels(who)).toEqual(['iPhone • Texas, USA', 'iPhone • USA'])
  })

  it('with location hidden shows the device and no place at all (sharing off must hide the place)', () => {
    expect(rowLabels({ deviceLabel: 'Mac' })).toEqual(['Mac'])
    expect(rowLabels({ region: 'Texas', deviceLabel: 'Mac' })).toEqual(['Mac']) // a region alone is never shown
    expect(placeName({ region: 'Texas' })).toBe('')
    expect(rowLabels({})).toEqual([])
  })

  it('shows the honest device word, the model only when the browser offered one', () => {
    expect(rowLabels({ deviceLabel: 'Android phone', deviceModel: 'Pixel 9', country: 'DE', region: 'Bavaria' })[0]).toBe('Pixel 9 • Bavaria, Germany')
  })

  it('rejects junk from the wire instead of printing it (a forged country code must not become text)', () => {
    expect(countryName('<b>')).toBeNull()
    expect(countryName('usa')).toBeNull()
    expect(rowLabels({ deviceLabel: 'Mac\u0000\n', country: 'GB' })).toEqual(['Mac • UK'])
  })

  it('degrades full, then short, then nothing as width shrinks, and never squeezes the name', () => {
    const name = 80, fixed = 40, widths = [120, 70]
    const levels = [400, 250, 200, 190, 100].map(width => labelLevel(width, name, fixed, widths))
    expect(levels).toEqual([0, 0, 1, -1, -1])
    // Monotonic: a narrower row never shows a longer label than a wider one.
    for (let w = 400; w > 0; w--) {
      const here = labelLevel(w, name, fixed, widths), wider = labelLevel(w + 1, name, fixed, widths)
      expect(here === -1 || (wider !== -1 && wider <= here)).toBe(true)
      // Whatever is shown fits whole beside the whole name.
      if (here >= 0) expect(name + fixed + 8 + widths[here]).toBeLessThanOrEqual(w)
    }
  })
})

it('every vehicle kind a room can report has a silhouette (a missing icon leaves a hole in the column)', () => {
  for (const kind of VEHICLE_KINDS) expect(vehicleGlyph(kind), kind).not.toBeNull()
})

describe('banish slider', () => {
  it('has the five stops the owner named, starting at none', () => {
    expect(BANISH_STOPS.map(stop => stop.words)).toEqual(['None', '5 minutes', '30 minutes', '24 hours', 'Permanently'])
    expect(BANISH_STOPS[0].seconds).toBe(0)
  })

  it('keys move one stop and Home and End jump, never past the ends', () => {
    expect(stopForKey(0, 'ArrowLeft')).toBe(0)
    expect(stopForKey(0, 'ArrowRight')).toBe(1)
    expect(stopForKey(4, 'ArrowRight')).toBe(4)
    expect(stopForKey(2, 'Home')).toBe(0)
    expect(stopForKey(2, 'End')).toBe(4)
    expect(stopForKey(2, 'a')).toBeNull()
  })

  it('a drag snaps to the nearest stop, clamped to the track', () => {
    expect([-1, 0, 0.12, 0.13, 0.5, 0.9, 2].map(stopAt)).toEqual([0, 0, 0, 1, 2, 4, 4])
  })
})

it('a refused control always says why (a silent disabled button reads as broken)', () => {
  for (const reason of ['public-world', 'not-host', 'target-creator', 'unknown'] as const) {
    for (const control of ['mute', 'eject', 'traits'] as const) expect(moderationWords(reason, control)).not.toBe('')
  }
  expect(moderationWords('public-world', 'mute')).toBe("Only Mira's creator can, in a public world.")
})

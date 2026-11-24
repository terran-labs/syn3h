import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIELD_SWITCHES, SWITCH_NAMES, fieldSwitchNames, fieldSwitchTable, isOn } from '../../src/core/fieldSwitches'
import { flashSwitchNames, readFlashSwitches } from '../../src/core/flashSwitches'

// The field switch list is the one list of link switches. Bugs caught: a switch the address
// turns on that no row shows, a row whose box disagrees with its link, a switch the copied report
// or the README leaves out.
const fromAddress = FIELD_SWITCHES.filter(f => f.key !== 'gpuTrace')
const link = (key: string) => key === 'gfx' ? 'gfx=2' : (() => { const f = FIELD_SWITCHES.find(g => g.key === key)!; return `${f.name}=${f.value}` })()

describe('the field switch list', () => {
  it('reads every switch from its own link, and only that one', () => {
    for (const f of fromAddress) {
      const s = readFlashSwitches(`?${link(f.key)}`)
      const on = fromAddress.filter(g => isOn(g.key, s)).map(g => g.key)
      // ?post=off implies Flat glass (flashSwitches.ts).
      expect(on).toEqual(f.key === 'postOff' ? ['postOff', 'uiFlat'] : [f.key])
    }
  })
  it('names in the report exactly what the link switches name', () => {
    for (const f of fromAddress) {
      const s = readFlashSwitches(`?${link(f.key)}`)
      expect(fieldSwitchNames(s).sort()).toEqual(flashSwitchNames(s).sort())
    }
    const all = readFlashSwitches('?' + fromAddress.filter(f => !['postOff', 'shadows1'].includes(f.key)).map(f => link(f.key)).join('&'))
    expect(fieldSwitchNames(all).sort()).toEqual(flashSwitchNames(all).sort())
  })
  it('is the README table, word for word, and rewrites only its own names in a link', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    const table = /<!-- field-switches:begin[^>]*-->\n([\s\S]*?)\n<!-- field-switches:end -->/.exec(readme)?.[1]
    expect(table).toBe(fieldSwitchTable())
    expect(new Set(SWITCH_NAMES)).toEqual(new Set(FIELD_SWITCHES.map(f => f.name)))
  })
})

describe('the copied link', () => {
  it('keeps an address switch that only shares a name with one of the list', async () => {
    const { linkWithSwitches } = await import('../../src/core/fieldSwitches')
    expect(linkWithSwitches('https://mira.cc/?post=0&room=r')).toBe('https://mira.cc/?post=0&room=r')
  })
})

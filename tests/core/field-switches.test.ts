import { describe, expect, it } from 'vitest'
import { FIELD_SWITCHES, SWITCH_NAMES, fieldSwitchNames, fieldSwitchTable, isOn, linkOf } from '../../src/core/fieldSwitches'
import { flashSwitchNames, readFlashSwitches } from '../../src/core/flashSwitches'

// The field switch list is the one list of link switches. Bugs caught: a switch the address
// turns on that no row shows, a row whose box disagrees with its link, a switch the copied report
// or the documentation table leaves out.
describe('the field switch list', () => {
  it('reads every switch from its own link, and only that one', () => {
    for (const f of FIELD_SWITCHES.filter(f => f.key !== 'webgl')) {
      const s = readFlashSwitches(`?${linkOf(f)}`)
      const on = FIELD_SWITCHES.filter(g => g.key !== 'webgl' && isOn(g.key, s)).map(g => g.key)
      // ?post=off implies Flat glass (flashSwitches.ts).
      expect(on).toEqual(f.key === 'postOff' ? ['postOff', 'uiFlat'] : [f.key])
    }
  })
  it('names in the report exactly what the link switches name', () => {
    const all = readFlashSwitches('?' + FIELD_SWITCHES.filter(f => f.key !== 'webgl' && f.key !== 'postOff').map(linkOf).join('&'))
    expect(fieldSwitchNames(all).sort()).toEqual(flashSwitchNames(all).sort())
    for (const f of FIELD_SWITCHES.filter(f => f.key !== 'webgl')) {
      const s = readFlashSwitches(`?${linkOf(f)}`)
      expect(fieldSwitchNames(s).sort()).toEqual(flashSwitchNames(s).sort())
    }
  })
  it('documents every switch, and every name it rewrites in a link', () => {
    const table = fieldSwitchTable()
    for (const f of FIELD_SWITCHES) expect(table).toContain(`\`?${linkOf(f)}\``)
    expect(new Set(SWITCH_NAMES)).toEqual(new Set(FIELD_SWITCHES.map(f => f.name)))
  })
})

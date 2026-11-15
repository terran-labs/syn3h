import { expect, it } from 'vitest'
import { params } from '../../shared/params'
import '../../src/bots/params'

it('uses tag beam wording in every player-visible bot label', () => {
  const labels = params.all().filter(p => p.def.group === 'Bots')
  expect(labels.find(p => p.def.id === 'bots.tagBeams')?.def.label).toBe('Bots use tag beams')
  const banned = /\b(fire[ds]?|firing|shoot(s|ing)?|shots?|lasers?|weapons?|hits?|kill(s|ed|ing)?|eliminat(e|ed|ion)|die[ds]?|dying|death|destroy(s|ed)?|dead)\b/i
  expect(labels.filter(p => banned.test(p.def.label) || banned.test(p.def.group)).map(p => p.def.id)).toEqual([])
})

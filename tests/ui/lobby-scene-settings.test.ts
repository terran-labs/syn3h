import { expect, it } from 'vitest'
import { params } from '../../shared/params'
import { IdlePulse, idlePeriodMax, idlePeriodMin, seeded, SWELL } from '../../src/ui/galaxy/idlePulse'

it('applies edited planet pulse periods at the next breath', () => {
  const previous = [idlePeriodMin.value, idlePeriodMax.value] as const
  const setBounds = (min: number, max: number) => {
    params.set(idlePeriodMin.def.id, min)
    params.set(idlePeriodMax.def.id, max)
  }
  try {
    const long = idlePeriodMin.def.max!, short = idlePeriodMin.def.min!
    setBounds(long, long)
    const seed = 42, random = seeded(seed)
    random() // The planet's position within the configured range.
    const firstEnd = long * (1 - random())
    const nextFactor = 0.8 + 0.4 * random()
    const pulse = new IdlePulse(seed, 1)
    const before = pulse.at(0)

    setBounds(short, short)
    expect(pulse.at(0)).toEqual(before)
    expect(pulse.at(firstEnd + short * nextFactor * SWELL / 2)[0]).toBeCloseTo(1)
  } finally {
    setBounds(...previous)
  }
})

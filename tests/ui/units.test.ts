import { afterEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { distanceText, heightUnit, heightValue, IMPERIAL, imperialForLocale, METRIC, speedUnit, speedValue, wholeNumber } from '../../src/ui/units'
import { altitudeAboveSea } from '../../src/ui/altitude'
import { snapSeaLevel } from '../../src/world/seaLevel'
import { terrainDry } from '../../src/world/terrain/settings'

// A wrong conversion or a mixed pair (mph beside metres) is what a player would call a bug.
describe('display units', () => {
  it('converts speed and height together for each system', () => {
    expect(speedValue(10, METRIC)).toBeCloseTo(36, 6)
    expect(speedValue(-10, IMPERIAL)).toBeCloseTo(22.369, 3)
    expect(heightValue(100, METRIC)).toBe(100)
    expect(heightValue(-30.48, IMPERIAL)).toBeCloseTo(-100, 6)
    expect([speedUnit(METRIC), heightUnit(METRIC)]).toEqual(['km/h', 'm'])
    expect([speedUnit(IMPERIAL), heightUnit(IMPERIAL)]).toEqual(['mph', 'ft'])
    expect([distanceText(350, METRIC), distanceText(1250, METRIC), distanceText(100, IMPERIAL), distanceText(1609.344, IMPERIAL)]).toEqual(['350 m', '1.3 km', '328 ft', '1.0 mi'])
  })
  it('shows below sea level with a minus sign and never "-0"', () => {
    expect(wholeNumber(-12.4)).toBe('−12')
    expect(wholeNumber(-0.3)).toBe('0')
    expect(wholeNumber(NaN)).toBe('0')
  })
  it('defaults to imperial only where it is the everyday system', () => {
    expect([imperialForLocale('en-US'), imperialForLocale('en'), imperialForLocale('en-GB'), imperialForLocale('de-DE'), imperialForLocale(undefined)]).toEqual([true, true, false, false, false])
  })
})

describe('altitude', () => {
  afterEach(() => { params.set('world.lavaAltitude', 0); params.set(terrainDry.def.id, 0); snapSeaLevel() })
  it('is zero at the sea surface and negative below it', () => {
    params.set('world.lavaAltitude', 12); snapSeaLevel()
    expect(altitudeAboveSea(12)).toBe(0)
    expect(altitudeAboveSea(7)).toBe(-5)
    expect(altitudeAboveSea(112)).toBe(100)
  })
  it('measures a dry world from the terrain datum', () => {
    params.set('world.lavaAltitude', -80); params.set(terrainDry.def.id, 1); snapSeaLevel()
    expect(altitudeAboveSea(0)).toBe(0)
  })
})

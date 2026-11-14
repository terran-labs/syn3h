import { describe, expect, it } from 'vitest'
import { sanitizeVehicleChoice } from '../../src/ui/VehicleChoice'
describe('saved vehicle choices', () => {
  it('keeps supported models and hexadecimal colours', () => {
    expect(sanitizeVehicleChoice({ vehicleKind: 'buggy-syn3h', bodyColor: '#ab3456', accentColor: '#FFEEAA' })).toEqual({ vehicleKind: 'buggy-syn3h', bodyColor: '#ab3456', accentColor: '#FFEEAA' })
  })
  it('recovers safely from malformed or obsolete preferences', () => {
    expect(sanitizeVehicleChoice({ bodyColor: 'red', accentColor: '<script>' })).toEqual(sanitizeVehicleChoice(null))
  })
})

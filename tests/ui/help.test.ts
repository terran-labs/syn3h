import { describe, expect, it } from 'vitest'
import { vehicleHelp, touchHelp } from '../../src/ui/VehicleHelp'
import { sanitizeVehicleChoice } from '../../src/ui/VehicleChoice'
describe('vehicle controls', () => {
  it('keeps jet and hovercraft choices and describes their different axes', () => {
    for (const vehicleKind of ['jet', 'hovercraft'] as const) expect(sanitizeVehicleChoice({ vehicleKind }).vehicleKind).toBe(vehicleKind)
    expect(vehicleHelp('jet').join(' ')).toContain('Q / E: yaw')
    expect(vehicleHelp('hovercraft').join(' ')).not.toContain('wings')
    expect(touchHelp('jet')).toContain('THR')
    expect(vehicleHelp('buggy')).toEqual(vehicleHelp('buggy-syn3h'))
  })
})

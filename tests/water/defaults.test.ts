import { expect, it } from 'vitest'
import { params } from '../../shared/params'
import { applyWaterQuery, waterWaves } from '../../src/world/water/params'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { waterUnderwater } from '../../src/world/water/underwater'
import { waterRipples } from '../../src/world/water/ripples'
import { waterSpray } from '../../src/world/water/spray'
import { applyPlanet } from '../../src/world/planets'

it('enables water on ordinary entry while retaining explicit off and planet recipes', () => {
  const flags = [waterWaves, waterSinking, waterUnderwater, waterRipples, waterSpray]
  for (const flag of flags) expect(flag.def.default).toBe(true)
  const saved = params.snapshot('all')
  try {
    applyPlanet('volcanic', 7)
    applyWaterQuery('')
    expect(params.get('world.seaKind')?.value).toBe(0)
    for (const flag of flags) params.set(flag.def.id, false)
    applyPlanet('alpine', 7)
    applyWaterQuery('')
    expect(params.get('world.seaKind')?.value).toBe(1)
    for (const flag of flags) expect(flag.value).toBe(false)
  } finally { params.applySnapshot(saved) }
})

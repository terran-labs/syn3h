import { describe, expect, it } from 'vitest'
import { MAX_PLANT_HEIGHT, coverHeights } from '../../src/world/terrain/groundcover'
import { KIND_ALPINE, KIND_DESERT, KIND_VOLCANIC } from '../../src/world/terrain/settings'

describe('ground cover height', () => {
  it('keeps every plant on every kind of world under the cap', () => {
    const report: string[] = []
    for (const [name, kind] of [['volcanic', KIND_VOLCANIC], ['desert', KIND_DESERT], ['alpine', KIND_ALPINE]] as const) {
      coverHeights(kind).forEach((l, i) => {
        report.push(`${name} ${i}: tallest ${l.tallest.toFixed(2)} m, capped ${l.capped.toFixed(2)} m`)
        expect(l.capped).toBeLessThanOrEqual(MAX_PLANT_HEIGHT + 1e-6)
      })
    }
    process.stdout.write(`cover heights: ${report.join('; ')}\n`)
  })
})

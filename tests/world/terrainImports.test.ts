import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))

describe('terrain module initialization', () => {
  for (const entry of ['roads', 'lava', 'forest', 'generate']) {
    it(`initializes when ${entry} is imported first`, () => {
      // A fresh native ESM graph catches TDZ errors that a transformed test module cache
      // can hide. In particular, a bot may import road constants before the generator.
      const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
        await import('./src/world/terrain/${entry}.ts');
        const roads = await import('./src/world/terrain/roads.ts');
        const lava = await import('./src/world/terrain/lava.ts');
        const forest = await import('./src/world/terrain/forest.ts');
        console.log(JSON.stringify([
          roads.FORD_DEPTH, roads.ROAD_WIDTH, roads.ROAD_FLAT_HALF,
          roads.ROAD_SHOULDER, roads.MAX_GRADE, lava.ROAD_CLEARANCE, forest.ROAD_CLEARANCE,
        ]));
      `], { cwd: root, encoding: 'utf8', timeout: 15000 })
      expect(JSON.parse(output.trim())).toEqual([0.35, 11, 9.5, 12, 0.2, 35.1, 14.5])
    }, 20000)
  }
})

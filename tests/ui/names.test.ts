import { expect, it } from 'vitest'
import { generateName } from '../../src/ui/data/names'
import { loadingMessages } from '../../src/ui/data/loadingMessages'
it('repeats seeded labels and keeps kinds separate', () => {
  const names = new Set<string>()
  for (let i = 0; i < 1000; i++) {
    const name = generateName(`room:12:${i}`, 'bot')
    expect(name).toBe(generateName(`room:12:${i}`, 'bot'))
    expect(name).toMatch(/^[A-Za-z ]+$/); expect(name.length).toBeLessThanOrEqual(32)
    names.add(name)
  }
  expect(names.size).toBeGreaterThan(990)
  expect(generateName(123, 'player')).not.toBe(generateName(123, 'world'))
})
it('keeps loading copy short and unique', () => {
  expect(loadingMessages).toHaveLength(40)
  expect(new Set(loadingMessages).size).toBe(40)
  expect(loadingMessages.every(s => s.length <= 65)).toBe(true)
})

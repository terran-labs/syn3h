import { expect, it } from 'vitest'
import { generateName } from '../../src/ui/data/names'
it('repeats seeded labels and keeps kinds separate', () => {
  expect(generateName('room:12:7', 'bot')).toBe('Borirek Hull Intern')
  expect(generateName(123, 'player')).toBe('Kativek')
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

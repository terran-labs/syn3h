/**
 * The loading veil's fun lines. Bugs these catch: the same joke twice in a row, a phase that
 * shows nothing or never moves on to the general list, a host's own list being ignored, a
 * line too long for a 320 px phone, and index.html's inline first lines drifting out of the
 * reviewed list (they appear before any module, so nothing else checks them).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadingMessages, phaseMessages, pickLoadingLine } from '../../src/ui/data/loadingMessages'

/** A deterministic stand-in for Math.random. */
const sequence = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }

describe('loading lines', () => {
  it('never shows the same line twice in a row', () => {
    for (const phase of [undefined, 'device', 'physics', 'renderer', 'world', 'ready', 'unknown']) {
      const random = sequence(7), shown = new Set<string>()
      let previous: string | undefined
      for (let i = 0; i < 200; i++) {
        const line = pickLoadingLine({ phase, general: loadingMessages, previous, shown, random })
        expect(line).not.toBe(previous); expect(line).toBeTruthy()
        shown.add(line); previous = line
      }
    }
    // Even when the only choice left is the one showing, given anything else to show.
    expect(pickLoadingLine({ general: ['a', 'b'], previous: 'a', random: () => 0.999 })).toBe('b')
  })
  it('uses the phase pool first, then falls back to the general list', () => {
    const random = sequence(3), shown = new Set<string>(), pool = phaseMessages.world
    let previous: string | undefined
    const seen: string[] = []
    for (let i = 0; i < pool.length + 5; i++) { previous = pickLoadingLine({ phase: 'world', general: loadingMessages, previous, shown, random }); shown.add(previous); seen.push(previous) }
    expect(new Set(seen.slice(0, pool.length))).toEqual(new Set(pool))
    for (const line of seen.slice(pool.length)) expect(loadingMessages).toContain(line)
    // A line that says loading is finished never shows while it is not.
    expect(loadingMessages).not.toContain('Sky attached. Ground attached. Off you go.')
    // A phase with no pool of its own goes straight to the general list.
    expect(loadingMessages).toContain(pickLoadingLine({ phase: 'toString', general: loadingMessages, random }))
  })
  it("respects a host's own list, markup and all, as plain strings", () => {
    const custom = ['<b>Bold claim</b>', 'Plain claim']
    for (let i = 0; i < 20; i++) expect(custom).toContain(pickLoadingLine({ general: custom, previous: custom[i % 2], random: sequence(i + 1) }))
    expect(pickLoadingLine({ general: custom, previous: 'Plain claim' })).toBe('<b>Bold claim</b>')
  })
  it('keeps every line short, unique and complete', () => {
    const all = [...new Set([...loadingMessages, ...Object.values(phaseMessages).flat()])]
    expect(new Set(loadingMessages).size).toBe(loadingMessages.length)
    expect(new Set(all).size).toBe(all.length)
    for (const line of all) { expect(line.length, line).toBeLessThanOrEqual(60); expect(line, line).toMatch(/^[A-Z].*\.$/) }
    for (const phase of ['device', 'physics', 'renderer', 'world', 'ready']) expect(phaseMessages[phase]?.length, phase).toBeGreaterThan(3)
  })
  it("index.html's inline first lines come from the reviewed lists", () => {
    const html = readFileSync('index.html', 'utf8')
    const lists = [...html.matchAll(/^\s*a = (\[.*\]);$/gm)].map(match => JSON.parse(match[1]) as string[])
    expect(lists).toHaveLength(1)
    for (const line of lists[0]) expect(loadingMessages).toContain(line)
    expect(html).toContain(`<p class="boot-status" aria-hidden="true">${lists[0][0]}</p>`)
    // The ten-second line is written by the veil's script, and is never read aloud as it ticks.
    expect(html).toContain('<p class="boot-still" aria-hidden="true"></p>')
  })
  it('names the real step for every phase the game reports', async () => {
    const { phaseSteps } = await import('../../src/ui/LoadingScreen')
    const reported = [...readFileSync('src/core/Game.ts', 'utf8').matchAll(/reportLoading\('(\w+)'/g), ...readFileSync('src/core/quality.ts', 'utf8').matchAll(/reportLoading\('(\w+)'/g)].map(m => m[1])
    expect(reported.length).toBeGreaterThan(3)
    for (const phase of reported) expect(phaseSteps[phase], phase).toBeTruthy()
  })
})

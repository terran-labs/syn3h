/**
 * During a move between rooms the veil says only the move's own lines. Bug caught (v26.11.2501
 * train, under load): "Trying the main world." then "Checking which way is down." then the
 * outcome; the general loading line in index.html's markup showed before its veil script said the
 * move's line, and LoadingScreen could write a host's lines over a move line.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mayShowLoadingLine } from '../../src/ui/LoadingScreen'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
/** index.html's head bootstrap (the script that marks the document as loading), run against fakes. */
function runHead(note: object | null) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('root.dataset.boot = "loading"'))!
  const dataset: Record<string, string> = {}
  const root = { dataset, style: { setProperty() {} } }
  const store = { getItem: (k: string) => (k === 'mira.roomMove' && note ? JSON.stringify(note) : null) }
  new Function('document', 'sessionStorage', 'location', 'window', 'requestAnimationFrame', 'matchMedia', script)(
    { documentElement: root }, store, { search: '' }, {}, () => 0, () => ({ matches: false }))
  return dataset
}

describe('the veil during a move', () => {
  it('holds the veil and keeps the status line hidden from the first paint when a move opened the page', () => {
    const d = runHead({ reason: 'returning', asked: 'lobby', hops: 0, at: Date.now() })
    expect('roomMove' in d).toBe(true); expect('moveUnsaid' in d).toBe(true)
    expect(html).toMatch(/html\[data-move-unsaid\] \.boot-status \{ visibility: hidden !important; \}/)
    // The body's veil script says the line and lifts the hiding in the same statement.
    expect(html).toMatch(/s\.textContent = line;[^\n]*delete root\.dataset\.moveUnsaid;/)
  })
  it('leaves an ordinary page alone: no note, an old note, or an unknown reason', () => {
    for (const note of [null, { reason: 'full', asked: 'lobby', hops: 1, at: Date.now() - 200_000 }, { reason: 'other', asked: 'lobby', hops: 1, at: Date.now() }]) {
      const d = runHead(note)
      expect('roomMove' in d).toBe(false); expect('moveUnsaid' in d).toBe(false)
    }
  })
  it('lets no general loading line be written while a move holds the veil', () => {
    expect(mayShowLoadingLine({ hasAttribute: (n: string) => n === 'data-room-move' })).toBe(false)
    expect(mayShowLoadingLine({ hasAttribute: () => false })).toBe(true)
  })
})

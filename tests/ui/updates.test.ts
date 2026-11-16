import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref, type Inline } from '../../src/ui/updates/markdown'
import { bareVersion, compareVersions, isNewer, latestVersion } from '../../src/ui/updates/version'
import { buildFeed, parseNotes } from '../../tools/release-feed.mjs'

const flat = (nodes: readonly Inline[]): string => nodes.map(n => n.t === 'text' || n.t === 'code' ? n.v : flat(n.c)).join('')
const links = (nodes: readonly Inline[]): (string | null)[] => nodes.flatMap(n => n.t === 'link' ? [n.href] : n.t === 'strong' || n.t === 'em' ? links(n.c) : [])

describe('release notes Markdown', () => {
  it('keeps raw HTML as text, never as markup', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(blocks.map(b => b.t)).toEqual(['p', 'p'])
    expect(blocks[0].t === 'p' && flat(blocks[0].c)).toBe('<script>alert(1)</script>')
  })
  it('drops unsafe link targets but keeps their text', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example/']) {
      const inline = parseInline(`[click](${bad})`)
      expect(links(inline)).toEqual([null])
      expect(flat(inline)).toBe('click')
    }
    expect(safeHref('https://www.syn3h.com/?v=26.11.1602')).toBe('https://www.syn3h.com/?v=26.11.1602')
    expect(safeHref('/brand/licenses/')).toBe('/brand/licenses/')
  })
  it('reads the shapes the notes use', () => {
    const blocks = parseMarkdown('### Fixes\n\n- One `?webgl=1`\n- **Two** and *three*\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| [x](https://a.example) | y |\n\nLive at https://www.syn3h.com/.')
    expect(blocks.map(b => b.t)).toEqual(['h', 'ul', 'ol', 'table', 'p'])
    const [, ul, , table, p] = blocks
    expect(ul.t === 'ul' && ul.items.map(flat)).toEqual(['One ?webgl=1', 'Two and three'])
    expect(table.t === 'table' && links(table.rows[0][0])).toEqual(['https://a.example'])
    // A bare address links without the sentence's full stop.
    expect(p.t === 'p' && links(p.c)).toEqual(['https://www.syn3h.com/'])
  })
})

describe('versions', () => {
  it('orders calendar versions by date and release of the day', () => {
    expect(isNewer('v26.11.1603', '26.11.1602')).toBe(true)
    expect(isNewer('26.11.1602', 'v26.11.1603')).toBe(false)
    expect(isNewer('26.11.1603', '26.11.1603')).toBe(false)
    expect(isNewer('26.12.100', '26.11.1603')).toBe(true)
    expect(isNewer('27.1.100', '26.12.3100')).toBe(true)
    expect(compareVersions('26.11.1518', '26.11.1600')).toBeLessThan(0)
    expect(latestVersion(['26.11.1503', '26.11.1603', 'junk', '26.11.1518'])).toBe('26.11.1603')
  })
  it('never calls a dev build label newer or older', () => {
    expect(bareVersion('release-41-g0b1c2d3')).toBeNull()
    expect(isNewer('26.11.1603', 'release-41-g0b1c2d3')).toBe(false)
  })
})

describe('the release feed', () => {
  it('takes the summary and the notes from a notes file', () => {
    const { summary, notes } = parseNotes('(AI Generated)\n\n## Syn3h v26.11.1602\n\nCords follow crests.\n\nPublic release at 4:18am.\n\n### The story so far\n\nText.')
    expect(summary).toBe('Cords follow crests.')
    expect(notes).toBe('### The story so far\n\nText.')
  })
  it('lists production releases with notes, newest first', () => {
    const { releases } = buildFeed()
    expect(releases.length).toBeGreaterThan(0)
    const versions = releases.map(r => r.version)
    expect([...versions].sort((a, b) => compareVersions(b, a))).toEqual(versions)
    for (const r of releases) { expect(r.summary).not.toBe(''); expect(r.notes).not.toMatch(/AI Generated/) }
  })
})

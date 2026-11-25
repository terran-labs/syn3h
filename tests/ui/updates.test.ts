import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref, type Inline } from '../../src/ui/updates/markdown'
import { EMPTY_LINE, parseFeed, planUpdates, versionDay } from '../../src/ui/updates/days'
import { FEED_URL, VERSIONS_URL } from '../../src/ui/updates/feed'
import { bareVersion, compareVersions, isNewer, latestVersion } from '../../src/ui/updates/version'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFeed, notesSummary, parseDigest, requireDigest, SUMMARY_MAX } from '../../tools/release-feed.mjs'

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
    expect(safeHref('https://mira.cc/?v=26.11.1602')).toBe('https://mira.cc/?v=26.11.1602')
    expect(safeHref('/brand/licenses/')).toBe('/brand/licenses/')
  })
  it('reads the shapes the notes use', () => {
    const blocks = parseMarkdown('### Fixes\n\n- One `?webgl=1`\n- **Two** and *three*\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| [x](https://a.example) | y |\n\nLive at https://mira.cc/.')
    expect(blocks.map(b => b.t)).toEqual(['h', 'ul', 'ol', 'table', 'p'])
    const [, ul, , table, p] = blocks
    expect(ul.t === 'ul' && ul.items.map(flat)).toEqual(['One ?webgl=1', 'Two and three'])
    expect(table.t === 'table' && links(table.rows[0][0])).toEqual(['https://a.example'])
    // A bare address links without the sentence's full stop.
    expect(p.t === 'p' && links(p.c)).toEqual(['https://mira.cc/'])
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
  it('takes the summary line from a published notes file', () => {
    expect(notesSummary('(AI Generated)\n\n## Mira v26.11.1602\n\nCords follow crests.\n\nPublic release at 4:18am.\n\n### The story so far\n\nText.')).toBe('Cords follow crests.')
  })
  it('accepts a digest only in its shape: a short summary, then two to five bullets', () => {
    expect(parseDigest('Cords drape over hills\n\n- One.\n- Two.').problems).toEqual([])
    expect(parseDigest('Cords\n\n- One.').problems.join()).toMatch(/two to five/)
    expect(parseDigest(`${'x'.repeat(SUMMARY_MAX)}\n\n- One.\n- Two.`).problems.join()).toMatch(/under 70/)
    expect(parseDigest('Cords\n\nThirty diagnostic cases.\n- One.\n- Two.').problems.join()).toMatch(/every line/)
  })
  it('shows players the digest, links the full notes, and never the published notes', () => {
    const { releases } = buildFeed()
    expect(releases.length).toBeGreaterThan(0)
    const versions = releases.map(r => r.version)
    expect([...versions].sort((a, b) => compareVersions(b, a))).toEqual(versions)
    for (const r of releases) {
      expect(r.summary.length).toBeLessThan(SUMMARY_MAX)
      expect(r.digest).toMatch(/^- /)
      expect(r.url).toBe(`https://github.com/terran-labs/syn3h/releases/tag/v${r.version}`)
      expect(Object.keys(r)).not.toContain('notes')
    }
  })
  it('refuses to build a release that has no player digest', () => {
    const repo = mkdtempSync(join(tmpdir(), 'mira-feed-'))
    mkdirSync(join(repo, 'release-notes', 'player'), { recursive: true })
    expect(() => requireDigest('26.11.1699', repo)).toThrow(/No player digest for v26\.11\.1699/)
    writeFileSync(join(repo, 'release-notes', 'player', 'v26.11.1699.md'), 'Short\n\n- One.\n- Two.\n')
    expect(() => requireDigest('v26.11.1699', repo)).not.toThrow()
  })
  it('lists the version being released first, before history has its row', () => {
    // release.sh writes the history row after the deploy: the build's own feed must not wait for it.
    const repo = mkdtempSync(join(tmpdir(), 'mira-feed-'))
    mkdirSync(join(repo, 'release-notes', 'player'), { recursive: true })
    mkdirSync(join(repo, 'release-notes', 'releases'), { recursive: true })
    writeFileSync(join(repo, 'release-notes', 'history.tsv'), 'v26.11.1605\tm-a\tabc1234\t2026-11-16 12:23 PST\tproduction\n')
    writeFileSync(join(repo, 'release-notes', 'releases', 'v26.11.1605.md'), '## Mira v26.11.1605\n\nOlder.\n')
    writeFileSync(join(repo, 'release-notes', 'player', 'v26.11.1605.md'), 'Older\n\n- One.\n- Two.\n')
    writeFileSync(join(repo, 'release-notes', 'player', 'v26.11.1607.md'), 'Boxes become buggies again\n\n- One.\n- Two.\n')
    const { releases } = buildFeed(repo, 12, 'v26.11.1607', new Date('2026-11-16T22:30:00Z'))
    expect(releases.map(r => r.version)).toEqual(['26.11.1607', '26.11.1605'])
    expect(releases[0]).toMatchObject({ summary: 'Boxes become buggies again', date: '2026-11-16 14:30 PST' })
    expect(releases[0].digest).toMatch(/^- One\./)
    // Once history has the row, its own date is used and the version is listed once.
    writeFileSync(join(repo, 'release-notes', 'history.tsv'), 'v26.11.1605\tm-a\tabc1234\t2026-11-16 12:23 PST\tproduction\nv26.11.1607\tm-b\tdef5678\t2026-11-16 14:41 PST\tproduction\n')
    writeFileSync(join(repo, 'release-notes', 'releases', 'v26.11.1607.md'), '## Mira v26.11.1607\n\nNewer.\n')
    const again = buildFeed(repo, 12, 'v26.11.1607', new Date('2026-11-16T23:59:00Z')).releases
    expect(again.map(r => r.version)).toEqual(['26.11.1607', '26.11.1605'])
    expect(again[0].date).toBe('2026-11-16 14:41 PST')
  })
})

describe('Updates grouped by day', () => {
  const rel = (version: string, date: string, summary = `Release ${version}`, extra: object = {}) =>
    ({ version, date, summary, digest: '- One.\n- Two.', url: 'https://example.com/wrong', ...extra })
  const feed = {
    releases: [
      rel('26.11.2500', '2026-11-25 13:27 PST', 'Parallel universes'),
      rel('26.11.2405', '2026-11-24 22:01 PST', 'Headlights light the ground'),
      rel('26.11.2400', '2026-11-24 00:36 PST', 'A darker backdrop'),
      rel('26.11.2308', '2026-11-23 23:37 PST'),
    ],
  }

  it('groups by the Pacific day in the version, never the date text or the viewer\'s zone', () => {
    // Bug: v26.11.2400, cut at 00:36 Pacific, filed under 23 November for a player in New York
    // or 24 November vs 25 for one in Tokyo. The version alone decides; the date string is
    // deliberately contradictory here and must not move it.
    const shifted = parseFeed({ releases: [rel('26.11.2400', '2026-11-23 21:36 PST'), rel('26.11.2308', '2026-11-24 02:37 PST')] })
    const days = planUpdates(shifted, null).days
    expect(days.map(d => [d.key, d.releases.map(r => r.release.version)])).toEqual([
      ['2026-11-24', ['26.11.2400']], ['2026-11-23', ['26.11.2308']],
    ])
    expect(planUpdates(parseFeed(feed), null).days.map(d => d.label)).toEqual(['25 November', '24 November', '23 November'])
    expect(versionDay('26.12.3107')?.key).toBe('2026-12-31')
  })

  it('marks the day that holds the running version, and only that day', () => {
    // Bug: "You are playing this" on the newest day when the player is on an older release.
    const days = planUpdates(parseFeed(feed), '26.11.2400').days
    expect(days.map(d => d.playing)).toEqual([false, true, false])
    expect(days[1].releases.filter(r => r.playing).map(r => r.release.version)).toEqual(['26.11.2400'])
    // A beta the player is on marks the day of the production release that contains it.
    const withBeta = parseFeed({ releases: [rel('26.11.2602', '2026-11-26 10:00 PST', 'P', { betas: [rel('26.11.2601', '2026-11-26 09:00 PST')] })] })
    expect(planUpdates(withBeta, '26.11.2601').days[0].playing).toBe(true)
  })

  it('links every release, beta and change to its own page on GitHub', () => {
    // Bug: every row linking the newest tag, or a feed's stale url sending a player elsewhere.
    const body = { releases: [...feed.releases, rel('26.11.2602', '2026-11-26 10:00 PST', 'P', {
      betas: [rel('26.11.2601', '2026-11-26 09:00 PST')],
      changes: [{ title: 'Water', commit: 'abc1234' }, { title: 'Bad', commit: 'javascript:alert(1)' }],
    })] }
    const entries = planUpdates(parseFeed(body), null).days.flatMap(d => d.releases).flatMap(r => [r, ...r.betas])
    expect(entries).toHaveLength(6)
    for (const r of entries) expect(r.href).toBe(`https://github.com/terran-labs/syn3h/releases/tag/v${r.release.version}`)
    expect(entries[0].changes).toEqual([
      { title: 'Water', href: 'https://github.com/terran-labs/syn3h/commit/abc1234' }, { title: 'Bad', href: null },
    ])
  })

  it('shows a plain line for an empty or malformed feed instead of a broken sheet', () => {
    for (const body of [null, 'nonsense', {}, { releases: 'x' }, { releases: [] }, { releases: [null, 7, { version: 'release-41-g0b1c2d3' }, { summary: 'no version' }] }]) {
      expect(planUpdates(parseFeed(body), '26.11.2500')).toEqual({ days: [], empty: EMPTY_LINE })
    }
    // Half-broken entries still render as releases with what they have.
    const partial = planUpdates(parseFeed({ releases: [{ version: '26.11.2500' }] }), null)
    expect(partial.days[0].releases[0].release).toMatchObject({ version: '26.11.2500', summary: '', digest: '', date: '' })
  })

  it('opens the newest day and its newest release, and keeps the rest closed', () => {
    // Bug: What's new opening on a closed list, or on an old day.
    const days = planUpdates(parseFeed(feed), null).days
    expect(days.map(d => d.expanded)).toEqual([true, false, false])
    expect(days.flatMap(d => d.releases).filter(r => r.open).map(r => r.release.version)).toEqual(['26.11.2500'])
  })

  it('reads the live feeds from the address the page came from, so beta never points at production', () => {
    // Bug: a beta.mira.cc player told to update and sent to mira.cc.
    for (const url of [FEED_URL, VERSIONS_URL]) expect(url).toMatch(/^\/[^/]/)
  })
})

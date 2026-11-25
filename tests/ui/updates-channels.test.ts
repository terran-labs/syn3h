// The Updates feed's channels (tools/release-feed.mjs, ops/RELEASE.md). Bugs caught: a beta's
// feed that leaves its own version out or calls it production; a beta that failed the owner's
// test listed as a release, or lost; a promoted release that keeps a stale "beta" mark or drops
// the betas built before it.
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFeed } from '../../tools/release-feed.mjs'

function repoWith(history: string, betas: string) {
  const repo = mkdtempSync(join(tmpdir(), 'mira-feed-channels-'))
  for (const dir of ['player', 'releases']) mkdirSync(join(repo, 'release-notes', dir), { recursive: true })
  writeFileSync(join(repo, 'release-notes', 'history.tsv'), history)
  writeFileSync(join(repo, 'release-notes', 'betas.tsv'), betas)
  for (const v of ['26.11.1605', '26.11.1606', '26.11.1607']) {
    writeFileSync(join(repo, 'release-notes', 'player', `v${v}.md`), `Words for ${v}\n\n- One.\n- Two.\n`)
    writeFileSync(join(repo, 'release-notes', 'releases', `v${v}.md`), `## Mira v${v}\n\nNotes.\n`)
  }
  return repo
}
const PROD_1605 = 'v26.11.1605\tm-a\tabc1234\t2026-11-16 12:23 PST\tproduction\n'
const BETAS = '# header\nv26.11.1606\tm-b\tbbb1111\t2026-11-16 13:00 PST\t20261116-130000-bbb1111\nv26.11.1607\tm-c\tccc2222\t2026-11-16 14:00 PST\t20261116-140000-ccc2222\n'

describe('Updates feed channels', () => {
  it("a beta's feed lists its own version first as a beta, with the failed beta before it", () => {
    const feed = buildFeed(repoWith(PROD_1605, BETAS), 60, 'v26.11.1607', new Date('2026-11-16T22:30:00Z'))
    expect(feed.build).toBe('26.11.1607')
    expect(feed.releases.map(r => [r.version, r.channel])).toEqual([['26.11.1607', 'beta'], ['26.11.1605', 'production']])
    expect(feed.releases[0].date).toBe('2026-11-16 14:00 PST')
    expect(feed.releases[0].betas?.map(b => b.version)).toEqual(['26.11.1606'])
    expect(feed.releases[0].betas?.[0]).toMatchObject({ summary: 'Words for 26.11.1606', url: 'https://github.com/terran-labs/syn3h/blob/main/release-notes/releases/v26.11.1606.md' })
    expect(feed.releases[1].betas).toBeUndefined()
  })
  it('once promoted, the same version is production and keeps the betas built before it', () => {
    const history = PROD_1605 + 'v26.11.1607\tm-c\tccc2222\t2026-11-16 15:10 PST\tproduction\n'
    const feed = buildFeed(repoWith(history, BETAS), 60, undefined, new Date('2026-11-16T23:30:00Z'))
    expect(feed.build).toBeUndefined()
    expect(feed.releases.map(r => [r.version, r.channel])).toEqual([['26.11.1607', 'production'], ['26.11.1605', 'production']])
    expect(feed.releases[0].date).toBe('2026-11-16 15:10 PST')
    expect(feed.releases[0].betas?.map(b => b.version)).toEqual(['26.11.1606'])
  })
  it('a feed with no betas file is the production list it always was', () => {
    const repo = repoWith(PROD_1605, '')
    const feed = buildFeed(repo, 60, undefined, new Date('2026-11-16T23:30:00Z'))
    expect(feed.releases.map(r => [r.version, r.channel, r.betas])).toEqual([['26.11.1605', 'production', undefined]])
  })
})

/**
 * Protocol rule 12: the dashboard opens with a link to every viewable page. This fails when
 * an HTML entry page exists at the repository root and the link block does not name it, so a
 * new lab page cannot ship without appearing on the dashboard.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'

it('every HTML entry page on trunk is in the dashboard link block', () => {
  const status = JSON.parse(readFileSync('dashboard/status.json', 'utf8')) as {
    links: { group: string; items: { title: string; url: string; page?: string }[] }[]
  }
  const linked = new Set(status.links.flatMap((g) => g.items.map((i) => i.page)).filter(Boolean))
  const pages = readdirSync('.').filter((f) => f.endsWith('.html'))
  expect(pages.length).toBeGreaterThan(0)
  for (const page of pages) expect(linked.has(page), `${page} is missing from dashboard/status.json links`).toBe(true)
  for (const g of status.links) for (const i of g.items) expect(i.url, i.title).toMatch(/^https:\/\//)
})

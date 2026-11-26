/**
 * Link previews are fetched by crawlers that run no scripts and resolve no relative paths. The
 * card itself is built, not tracked (tools/brand/share-card.mjs); tools/check-shipped-assets.mjs
 * checks the built one exists at the declared size.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { pointAtCard, SOURCE_NAME } from '../../tools/brand/share-card.mjs'

const tag = (html: string, name: string) => new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html)?.[1] ?? ''

it('share card tags carry full https addresses on one origin', () => {
  const html = readFileSync('index.html', 'utf8')
  const page = new URL(tag(html, 'og:url'))
  expect(page.protocol).toBe('https:')
  for (const name of ['og:image', 'twitter:image']) {
    const image = new URL(tag(html, name))
    expect(image.origin, name).toBe(page.origin)
    expect(image.pathname, name).toBe(`/brand/${SOURCE_NAME}`)
  }
})

it('the build points both tags at the built card and keeps their absolute form', () => {
  const built = pointAtCard(readFileSync('index.html', 'utf8'), 'share-0123abcd.png')
  for (const name of ['og:image', 'twitter:image']) expect(tag(built, name), name).toBe('https://mira.cc/brand/share-0123abcd.png')
  expect(() => pointAtCard('<html></html>', 'share-0123abcd.png')).toThrow()
})

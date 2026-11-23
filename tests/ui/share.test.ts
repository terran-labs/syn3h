/** Link previews are fetched by crawlers that run no scripts and resolve no relative paths. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('share card tags carry full https addresses on one origin', () => {
  const html = readFileSync('index.html', 'utf8')
  const tag = (name: string) => new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html)?.[1] ?? ''
  const page = new URL(tag('og:url'))
  expect(page.protocol).toBe('https:')
  for (const name of ['og:image', 'twitter:image']) {
    const image = new URL(tag(name))
    expect(image.origin, name).toBe(page.origin)
    expect(image.pathname, name).toBe('/brand/mira-share.png')
  }
})

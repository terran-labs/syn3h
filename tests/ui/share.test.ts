/** Link previews are fetched by crawlers that run no scripts and resolve no relative paths. */
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('share card tags carry full https addresses on one origin, naming a card that ships', () => {
  const html = readFileSync('index.html', 'utf8')
  const tag = (name: string) => new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html)?.[1] ?? ''
  const page = new URL(tag('og:url'))
  expect(page.protocol).toBe('https:')
  for (const name of ['og:image', 'twitter:image']) {
    const image = new URL(tag(name))
    expect(image.origin, name).toBe(page.origin)
    // The card is in public/ at that path and is the size the tags declare (a crawler's 404 or a
    // wrong size shows no preview). Its name changes with every redraw (tools/lobby-captures.mjs).
    const file = `public${image.pathname}`
    expect(existsSync(file), `${name}: ${file}`).toBe(true)
    const png = readFileSync(file)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], name).toEqual([Number(tag('og:image:width')), Number(tag('og:image:height'))])
  }
})

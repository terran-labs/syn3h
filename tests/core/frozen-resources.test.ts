import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createFrozenResourceResolver } from '../../src/core/frozenResources'
import { creditsHtml } from '../../src/ui/data/credits'
import { LobbyAddress } from '../../src/ui/LobbyAddress'

const root = 'https://www.syn3h.com'
const frozen = createFrozenResourceResolver(`${root}/?v=26.11.1519`)

describe('frozen production resources', () => {
  it('retains the immutable entry version after lobby query and hash removal', () => {
    const location = { href: `${root}/?v=26.11.1519&room=test#entry` }
    const resolve = createFrozenResourceResolver(location.href).resolve
    const history = { state: null, replaceState(_state: unknown, _unused: string, url?: string | URL | null) {
      location.href = String(url)
    } }
    new LobbyAddress(location, history).showLobby()
    expect(location.href).toBe(`${root}/`)
    expect(resolve('/models/tank.glb')).toBe('/v/26.11.1519/models/tank.glb')
  })

  it.each(['?v=26.11.1519', '?v=%20v26.11.1519%20', '/v/26.11.1519/', '/v/26.11.1519/?v=v26.11.1519'])('accepts the server version grammar: %s', suffix => {
    const entry = suffix.startsWith('/') ? root + suffix : root + '/' + suffix
    expect(createFrozenResourceResolver(entry).version).toBe('26.11.1519')
  })

  it.each(['?v=', '?v=latest', '?v=1.2', '?v=1.2.3/other', '?v=1.2.3&v=1.2.4', '/v/bad/', '/v/', '/v/1.2.3/?v=1.2.4'])('rejects malformed or conflicting selectors: %s', suffix => {
    expect(() => createFrozenResourceResolver(root + (suffix.startsWith('/') ? suffix : '/' + suffix))).toThrow()
  })

  it('keeps existing frozen paths idempotent and refuses another resource version', () => {
    const path = '/v/26.11.1519/models/buggy.glb?detail=1#mesh'
    expect(frozen.resolve(path)).toBe(path)
    expect(frozen.resolve(frozen.resolve('/models/buggy.glb'))).toBe('/v/26.11.1519/models/buggy.glb')
    expect(() => frozen.resolve('/v/26.11.1518/models/buggy.glb')).toThrow()
    expect(() => frozen.resolve('/v/bad/models/buggy.glb')).toThrow()
    expect(() => frozen.resolve('/models/../ws')).toThrow()
  })

  it('leaves external and network URLs untouched', () => {
    for (const url of ['https://cdn.example/models/a.glb', '//cdn.example/models/a.glb', 'data:model/gltf-binary;base64,AA', 'blob:https://syn3h.com/id', 'wss://syn3h.com/ws', '/ws?room=test', '/presence', '/status', '/api/room', 'models/dev.glb']) {
      expect(frozen.resolve(url)).toBe(url)
    }
    expect(createFrozenResourceResolver(root + '/').resolve('/models/buggy.glb')).toBe('/models/buggy.glb')
  })

  it('pins every production model and preserves a missing resource path without fallback', () => {
    for (const path of ['/models/tank.glb', '/models/tanktread.glb', '/models/buggy.glb', '/models/buggy-boxarm.glb', '/models/missing.glb']) {
      expect(frozen.resolve(path)).toBe('/v/26.11.1519' + path)
    }
  })

  it('covers all ten production licence anchors without changing external credits links', () => {
    const hrefs = [...creditsHtml.matchAll(/href="([^"]+)"/g)].map(match => match[1]!)
    const licences = hrefs.filter(href => href.startsWith('/brand/licenses/'))
    expect(licences.map(href => href.split('/').at(-1))).toEqual([
      'three.txt', 'qr.txt', 'rapier.txt', 'tweakpane.txt', 'lato.txt',
      'roboto-apache.txt', 'roboto-notice.txt', 'barlow.txt', 'marked.txt', 'ws.txt',
    ])
    for (const href of licences) expect(frozen.resolve(href)).toBe('/v/26.11.1519' + href)
    for (const href of hrefs.filter(href => !licences.includes(href))) expect(frozen.resolve(href)).toBe(href)
  })

  it('wires the policy before vehicle construction and at both model-loading sites', () => {
    const source = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
    const main = source('src/main.ts')
    expect(main.indexOf('initializeFrozenResources(location.href)')).toBeLessThan(main.indexOf('const game = new Game'))
    expect(source('src/vehicles/skins/VehicleModel.ts')).toContain('loadAsync(frozenResourceURL(url))')
    const buggy = source('src/vehicles/skins/LoadedBuggySkin.ts')
    expect(buggy).toContain("loadAsync(frozenResourceURL('/models/buggy.glb'))")
    expect(buggy).toContain('loadAsync(frozenResourceURL(BOX_ARM_BODY))')
    expect(source('src/ui/Shell.ts')).toContain('[data-panel="about"] a[href^="/brand/licenses/"]')
  })
})

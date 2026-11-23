/**
 * The old window hook names read through to the new ones until 22 December 2026. Bug caught: the
 * hosted check runs the previous release's checker, which read window.syn3hStartup on the Mira
 * build, found nothing, and reported no tap-to-playable figure for the release.
 */
import { afterAll, describe, expect, it } from 'vitest'

const page = {} as Record<string, unknown>
const before = (globalThis as { window?: unknown }).window
;(globalThis as { window?: unknown }).window = page
afterAll(() => { (globalThis as { window?: unknown }).window = before })

describe('legacy window names', () => {
  it('syn3h, syn3hNet and syn3hStartup read the hooks the game assigns later', async () => {
    await import('../../src/core/legacyWindowNames')
    expect(page.syn3hStartup).toBeUndefined()
    const startup = { tapMs: 1 }, game = {}, net = {}
    Object.assign(page, { miraStartup: startup, mira: game, miraNet: net })
    expect(page.syn3hStartup).toBe(startup)
    expect(page.syn3h).toBe(game)
    expect(page.syn3hNet).toBe(net)
  })
})

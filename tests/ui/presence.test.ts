import { afterEach, describe, expect, it, vi } from 'vitest'
import { PresenceFeed, populations, readPresence, populationLabel, PRESENCE_TTL } from '../../src/ui/galaxy/presence'
const now = 1_000_000
const payload = (byRecipe: unknown[] = [], generatedAt = now) => ({ version: 1, generatedAt, ttlMs: PRESENCE_TTL, byRecipe })
const row = (recipeId: string | null, players = 3, rooms = 2, oldestReportAt = now) => ({ recipeId, players, rooms, oldestReportAt })
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('public recipe populations', () => {
  it('keeps unknown distinct from fresh zero and never assigns legacy counts to a recipe', () => {
    expect(populations(null, ['volcanic'], now).get('volcanic')).toBeNull()
    expect(populations(readPresence(payload()), ['volcanic'], now).get('volcanic')).toEqual({ players: 0, rooms: 0 })
    const values = populations(readPresence(payload([row(null, 20), row('alpine')])), ['volcanic', 'alpine'], now)
    expect(values.get('volcanic')).toEqual({ players: 0, rooms: 0 })
    expect(populationLabel(values.get('alpine')!)).toBe('3 connected across 2 rooms')
    expect(populationLabel(null)).toBe('Population unknown')
  })
  it('uses the oldest report time, rejects expired payloads and does not renew on receipt', () => {
    const snapshot = readPresence(payload([row('alpine', 3, 2, now - 89_999)]))
    expect(populations(snapshot, ['alpine'], now).get('alpine')).not.toBeNull()
    expect(populations(snapshot, ['alpine'], now + 1).get('alpine')).toBeNull()
    expect(populations(readPresence(payload([], now - 90_000)), ['alpine'], now).get('alpine')).toBeNull()
    expect(populations(readPresence(payload([], now + 60_000)), ['alpine'], now).get('alpine')).toBeNull()
  })
  it('rejects malformed, duplicate and negative counts', () => {
    for (const value of [null, {}, payload([row('alpine', -1)]), payload([row('alpine'), row('alpine')]), payload([row('alpine', 1.5)]), payload([row('alpine', 3, 2, now + 1)])]) expect(readPresence(value)).toBeNull()
  })
  it('calls the browser fetch with its global receiver', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(response(payload([row('alpine')])))
    })
    vi.stubGlobal('fetch', fetcher)
    const changed = vi.fn(), feed = new PresenceFeed(['alpine'], changed)
    feed.setActive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(changed.mock.lastCall![0].get('alpine')).toEqual({ players: 3, rooms: 2 })
    feed.dispose()
  })
  it('polls only when active, with one request in flight and abort on hide', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    let resolve!: (response: Response) => void
    const fetcher = vi.fn((_url: unknown, _init: unknown) => new Promise<Response>(done => { resolve = done }))
    const changed = vi.fn(), feed = new PresenceFeed(['alpine'], changed, fetcher as typeof fetch)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).not.toHaveBeenCalled()
    feed.setActive(true); feed.setActive(true)
    await vi.advanceTimersByTimeAsync(9000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const signal = (fetcher.mock.calls[0][1] as RequestInit).signal!
    feed.setActive(false)
    expect(signal.aborted).toBe(true)
    resolve(response(payload([row('alpine')], Date.now())))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1) // Initial unknown only; aborted response cannot revive counts.
    feed.dispose()
  })
  it('expires a report before the next poll and publishes unknown on failure', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fetcher = vi.fn().mockResolvedValueOnce(response(payload([row('alpine', 3, 2, now - 85_000)]))).mockResolvedValue(response({}, false))
    const changed = vi.fn(), feed = new PresenceFeed(['alpine'], changed, fetcher)
    feed.setActive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(changed.mock.lastCall![0].get('alpine')).toEqual({ players: 3, rooms: 2 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(changed.mock.lastCall![0].get('alpine')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(changed.mock.lastCall![0].get('alpine')).toBeNull()
    feed.dispose()
  })
})

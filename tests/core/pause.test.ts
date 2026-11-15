import { describe, expect, it, vi } from 'vitest'
import { PauseState, type PauseReason } from '../../src/core/pause'

describe('pause state', () => {
  it('runs only when no reason to pause holds', () => {
    const p = new PauseState()
    expect([p.paused, p.reason]).toEqual([false, null])
    p.pause('hidden'); expect([p.paused, p.reason]).toEqual([true, 'hidden'])
    p.pause('user'); expect([p.paused, p.reason]).toEqual([true, 'user'])
    p.resume('hidden'); expect([p.paused, p.reason]).toEqual([true, 'user'])
    p.resume('user'); expect([p.paused, p.reason]).toEqual([false, null])
  })

  it('a hidden page never clears or overrides the player\'s own pause', () => {
    const p = new PauseState(), seen: [boolean, PauseReason | null][] = []
    p.subscribe((paused, reason) => seen.push([paused, reason]))
    // Pause, switch tabs, come back: still paused by the player, and nothing is announced
    // for the tab switch because neither the state nor its reason changed.
    p.pause('user'); p.pause('hidden'); p.resume('hidden')
    expect(seen).toEqual([[true, 'user']])
    p.resume('user')
    expect(seen.at(-1)).toEqual([false, null])
  })

  it('hide while running, pause while hidden, then show: the reason is announced, not a resume', () => {
    const p = new PauseState(), seen: [boolean, PauseReason | null][] = []
    p.subscribe((paused, reason) => seen.push([paused, reason]))
    p.pause('hidden'); p.pause('user'); p.resume('hidden'); p.resume('user')
    expect(seen).toEqual([[true, 'hidden'], [true, 'user'], [false, null]])
  })

  it('is idempotent and cannot be left stuck by repeated or unmatched calls', () => {
    const p = new PauseState(), listener = vi.fn()
    p.subscribe(listener)
    p.resume('user'); p.resume('hidden')
    expect(listener).not.toHaveBeenCalled()
    p.pause('hidden'); p.pause('hidden'); p.pause('hidden')
    expect(listener).toHaveBeenCalledTimes(1)
    p.resume('hidden')
    expect(p.paused).toBe(false)
  })

  it('tells every listener even when one throws, and unsubscribes cleanly', () => {
    const p = new PauseState(), later = vi.fn(), gone = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    p.subscribe(() => { throw new Error('audio refused') })
    const off = p.subscribe(gone); p.subscribe(later); off()
    p.pause('user')
    expect(later).toHaveBeenCalledWith(true, 'user'); expect(gone).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

/**
 * Launch analytics in the browser (src/net/analytics.ts). Each test names the bug it catches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anonymousId, cleanRef, CRASHES_PER_PAGE, deviceClass, entryRef, EVENTS_PER_PAGE, reportCrash, reportEvent,
  setReportTransport, stackHash, topFrames,
} from '../../src/net/analytics'
import { LobbyAddress } from '../../src/ui/LobbyAddress'

afterEach(() => vi.unstubAllGlobals())
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }

describe('anonymous id and campaign tag', () => {
  // Bug: no id (or a new id every page) breaking unique and returning counts.
  it('makes one random id and keeps it', () => {
    const s = memory()
    const first = anonymousId(s)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(anonymousId(s)).toBe(first)
  })

  // Bug: blocked storage throwing into the join, instead of a session with no id.
  it('has no id, and does not throw, when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('SecurityError') } }
    expect(anonymousId(blocked)).toBe('')
    const forgetful = { getItem: () => null, setItem: () => {} }
    expect(anonymousId(forgetful)).toBe('')
  })

  // Bug: a URL, a name or anything else typed into ?ref= reaching the dataset.
  it('keeps only a short lower-case campaign tag, read once per tab', () => {
    expect(cleanRef('Email')).toBe('email')
    for (const bad of ['https://evil.example/', 'a b', 'x'.repeat(25), '<script>', 'ünicode']) expect(cleanRef(bad)).toBe('')
    const tab = memory()
    expect(entryRef('?ref=discord&room=x', tab as unknown as Storage)).toBe('discord')
    expect(entryRef('?ref=email', tab as unknown as Storage)).toBe('discord') // the first load's tag stays for the tab
    expect(entryRef('', memory() as unknown as Storage)).toBe('')
  })

  // Bug: ?ref= left in the bar, carried by an invite, or changing the room.
  it('removes ?ref= from the address bar and from what a reload or invite uses', () => {
    let href = 'https://mira.cc/?ref=email&room=friends&v=26.11.2500'
    const history = { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { href = String(url) } }
    const address = new LobbyAddress({ href } as Location, history as unknown as History)
    expect(new URL(href).searchParams.has('ref')).toBe(false)
    expect(address.playURL().searchParams.has('ref')).toBe(false)
    expect(address.playURL().searchParams.get('room')).toBe('friends')
  })

  it('tells phones, tablets and desktops apart', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', true, 5)).toBe('phone')
    expect(deviceClass('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari', true, 5)).toBe('phone')
    expect(deviceClass('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', true, 5)).toBe('tablet')
    expect(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', true, 5)).toBe('tablet') // iPadOS desktop UA
    expect(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome', false, 0)).toBe('desktop')
  })
})

describe('crash and health reports', () => {
  // Bug: a crash loop sending a request per frame.
  it('sends at most CRASHES_PER_PAGE crashes, one per distinct stack, and EVENTS_PER_PAGE events', () => {
    const sent: string[] = []
    setReportTransport((b) => { sent.push(b) })
    for (let i = 0; i < 1000; i++) reportCrash('error', new Error('same'))
    expect(sent).toHaveLength(1)
    for (let i = 0; i < 1000; i++) { const e = new Error('boom ' + i); e.stack = `Error\n at f${i} (x.js:${i}:1)`; reportCrash('error', e) }
    expect(sent).toHaveLength(CRASHES_PER_PAGE)
    for (let i = 0; i < 1000; i++) reportEvent('ws_fail', i)
    expect(sent).toHaveLength(CRASHES_PER_PAGE + EVENTS_PER_PAGE)
  })

  // Bug: a query string, a room name or another origin's script inside a crash report.
  it('sends a structured crash: error name, reduced message, our own frames, the key in the address', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:3000', search: '' })
    const sent: { body: string; key: string }[] = []
    setReportTransport((body, key) => { sent.push({ body, key }) })
    const e = new TypeError('failed loading https://mira.cc/assets/index-a1.js?room=secret-room#x for "Quentin"')
    e.stack = 'TypeError: failed\n    at go (http://localhost:3000/assets/index-a1.js?v=1:10:20)\n    at x (https://evil.example/y.js:1:1)\n    at run (http://localhost:3000/assets/b.js:3:4)'
    reportCrash('physics_wasm', e)
    const body = JSON.parse(sent[0].body)
    expect(body.name).toBe('TypeError')
    expect(body.message).not.toContain('secret-room')
    expect(body.message).not.toContain('Quentin')
    expect(body.frames).toBe('/assets/index-a1.js:10:20 < /assets/b.js:3:4')
    expect(body.stack).toBe(stackHash('physics_wasm\n' + e.stack))
    expect(sent[0].key).toMatch(/^[0-9a-f]{16,32}$/)
    expect(body.key).toBeUndefined()
  })

  it('reporting never throws, even with a failing transport', () => {
    setReportTransport(() => { throw new Error('offline') })
    expect(() => reportCrash('error', new Error('x'))).not.toThrow()
    expect(() => reportEvent('physics_retry', 1)).not.toThrow()
    expect(topFrames('no frames here', 'http://localhost:3000')).toBe('')
  })
})

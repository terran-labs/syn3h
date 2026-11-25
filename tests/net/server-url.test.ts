import { afterEach, expect, it, vi } from 'vitest'
import { serverUrl } from '../../src/net/Connection'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('uses the HTTP page proxy rather than a different room server', () => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_SERVER_URL', undefined)
  vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:8846', hostname: '127.0.0.1' })
  expect(serverUrl('two people')).toBe('ws://127.0.0.1:8846/ws?room=two%20people')
})
it('preserves an explicit development room endpoint', () => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_SERVER_URL', 'ws://127.0.0.1:8847/ws')
  vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:8846' })
  expect(serverUrl('room')).toBe('ws://127.0.0.1:8847/ws?room=room')
})
it('always uses secure same-origin sockets on HTTPS', () => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_SERVER_URL', 'ws://127.0.0.1:8847')
  vi.stubGlobal('location', { protocol: 'https:', host: 'example.test:32796' })
  expect(serverUrl('room')).toBe('wss://example.test:32796/ws?room=room')
})
it('adds public overflow parameters after the room, leaving the plain address unchanged', () => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_SERVER_URL', undefined)
  vi.stubGlobal('location', { protocol: 'https:', host: 'mira.cc' })
  expect(serverUrl('lobby', {})).toBe('wss://mira.cc/ws?room=lobby')
  expect(serverUrl('lobby', { assign: '1', prefer: 'lobby-2' })).toBe('wss://mira.cc/ws?room=lobby&assign=1&prefer=lobby-2')
})

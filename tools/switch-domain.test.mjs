// The move to mira.cc must reach every form of the old address, and nothing else: not the
// workers.dev address the release falls back to, not a page of the old website, not a line kept on
// purpose. Running it twice must change nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { switchDomain } from './switch-domain.mjs'

test('every form of the old address moves to mira.cc, and nothing else', () => {
  const before = String.raw`https://www.syn3h.com/?v=26.11.1503 wss://www.syn3h.com/ws https://syn3h.com/?room=a /www\.syn3h\.com\// https://syn3h.af-4e7.workers.dev/ www.syn3h.com/backstory.html`
  const after = String.raw`https://mira.cc/?v=26.11.1503 wss://mira.cc/ws https://mira.cc/?room=a /mira\.cc\// https://syn3h.af-4e7.workers.dev/ www.syn3h.com/backstory.html`
  assert.equal(switchDomain(before).text, after)
  assert.equal(switchDomain(after).text, after)
  assert.equal(switchDomain('curl https://www.syn3h.com/ # rename-keep').text, 'curl https://www.syn3h.com/ # rename-keep')
})

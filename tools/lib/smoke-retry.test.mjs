import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STEP_RETRIES, isBrowserCrash, isTransportConsoleError, retryDecision, uncleanSince } from './smoke-retry.mjs'

const drop = { code: 1006, reason: '', clean: false, wasOpen: true, at: 5000 }

test('only unclean closes inside the step window count as drops', () => {
  const closes = [{ ...drop, at: 1000 }, drop, { code: 4003, reason: 'replaced', clean: true, wasOpen: true, at: 6000 }]
  assert.deepEqual(uncleanSince(closes, 2000), [drop])
  assert.deepEqual(uncleanSince(undefined, 0), [])
})

test('a failed step with a drop in its window runs once more', () => {
  assert.equal(retryDecision({ failed: true, drops: [drop], retried: false, retriesUsed: 0 }), 'retry')
})

test('a failed step with no drop in its window fails at once', () => {
  assert.equal(retryDecision({ failed: true, drops: [], retried: false, retriesUsed: 0 }), 'fail')
})

test('a step that fails again after its retry fails', () => {
  assert.equal(retryDecision({ failed: true, drops: [drop], retried: true, retriesUsed: 1 }), 'fail')
})

test('retries are bounded for the run: past the limit the network is too unstable to verify', () => {
  assert.equal(retryDecision({ failed: true, drops: [drop], retried: false, retriesUsed: MAX_STEP_RETRIES }), 'unstable')
})

test('a build without close diagnostics, or a step that cannot rerun, never retries', () => {
  assert.equal(retryDecision({ failed: true, drops: [drop], retried: false, retriesUsed: 0, supported: false }), 'fail')
  assert.equal(retryDecision({ failed: true, drops: [drop], retried: false, retriesUsed: 0, retryable: false }), 'fail')
  assert.equal(retryDecision({ failed: false, drops: [drop], retried: false, retriesUsed: 0 }), 'pass')
})

test('a crashed page is a browser crash; game, network and timeout failures are not', () => {
  assert.equal(isBrowserCrash('page.waitForFunction: Target crashed '), true)
  assert.equal(isBrowserCrash('Error: Page crashed'), true)
  assert.equal(isBrowserCrash('page.waitForFunction: Timeout 30000ms exceeded.'), false)
  assert.equal(isBrowserCrash('{"ramsA":0,"ramsB":0}'), false)
  assert.equal(isBrowserCrash('closed 1006'), false)
  assert.equal(isBrowserCrash(undefined), false)
})

test('a failed WebSocket handshake to the room address is transport; other console errors are not', () => {
  const base = 'https://syn3h.af-4e7.workers.dev/'
  const seen = "WebSocket connection to 'wss://syn3h.af-4e7.workers.dev/ws?room=smoke1794863958373-6177e21732ce' failed: Error during WebSocket handshake: net::ERR_CONNECTION_RESET at https://syn3h.af-4e7.workers.dev/assets/index-7XVEda6E.js"
  assert.equal(isTransportConsoleError(seen, base), true)
  assert.equal(isTransportConsoleError(seen.replace('syn3h.af-4e7.workers.dev/ws', 'elsewhere.example/ws'), base), false)
  assert.equal(isTransportConsoleError('TypeError: Cannot read properties of undefined (reading \'vehicle\') at https://syn3h.af-4e7.workers.dev/assets/index-7XVEda6E.js', base), false)
  assert.equal(isTransportConsoleError("Failed to load resource: the server responded with a status of 404 () at https://syn3h.af-4e7.workers.dev/assets/index-Bur40FVQ.css", base), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STEP_RETRIES, retryDecision, uncleanSince } from './smoke-retry.mjs'

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

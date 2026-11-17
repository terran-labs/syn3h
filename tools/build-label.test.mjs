import test from 'node:test'
import assert from 'node:assert/strict'
import { devLabel } from './build-label.mjs'

// The lobby showed "m-boxfix-1607-60-g0e1d1f6a", cut off on phones. A development label is short.
test('a development build shows dev and the short commit', () => {
  assert.equal(devLabel('m-boxfix-1607-60-g0e1d1f6a\n'), 'dev · 0e1d1f6')
  assert.equal(devLabel('release-31-59-gdb2df380-dirty'), 'dev · db2df38')
  assert.equal(devLabel('db2df380'), 'dev · db2df38')
  assert.equal(devLabel(''), 'dev')
})
test('a checkout on a release tag shows the release', () => {
  assert.equal(devLabel('26.11.1609'), '26.11.1609')
  assert.equal(devLabel('v26.11.1609'), 'v26.11.1609')
})

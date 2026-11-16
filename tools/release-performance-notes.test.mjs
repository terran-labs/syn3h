import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHistory, kindLine } from './lib/release-version.mjs'
import { renderNotes, draftNotes, requiresPerformance } from './release-notes.mjs'
const history = parseHistory(readFileSync(new URL('../release-notes/history.tsv', import.meta.url), 'utf8'))
const baseline = history.find(row => row.version === 'v26.11.1518')
const historical = readFileSync(new URL('../release-notes/releases/v26.11.1518.md', import.meta.url), 'utf8')
const next = { ...baseline, version: 'v26.11.1519' }
const nextNotes = historical.replaceAll('v26.11.1518', next.version).replace(kindLine(baseline), kindLine(next))
test('accepted historical notes remain renderable without retrospective performance', () => {
  assert.equal(requiresPerformance(baseline), false)
  assert.match(renderNotes(historical, baseline), /^\(AI Generated\)/)
})
test('next production release cannot omit Performance', () => {
  assert.equal(requiresPerformance(next), true)
  assert.throws(() => renderNotes(nextNotes, next), /need "### Performance"/)
})
test('new production draft includes an unresolved Performance section', () => {
  const draft = draftNotes(next, 'release-22', 'candidate', [])
  assert.match(draft, /### Performance/)
  assert.throws(() => renderNotes(draft, next), /TODO/)
})

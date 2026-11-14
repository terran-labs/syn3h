import { expect, it } from 'vitest'
import { matchAnnouncement, raceScores, type MatchState } from '../../src/ui/MatchHud'
const state: MatchState = { mode: 'koth', holderName: 'Nolitek', holderIsYou: true, contested: false, scores: [], target: 60, winner: null }
it('announces transitions once and prioritizes the winner', () => {
  expect(matchAnnouncement(null, state)).toBe('You hold the hill!')
  expect(matchAnnouncement(state, { ...state })).toBeNull()
  expect(matchAnnouncement(state, { ...state, contested: true })).toBe('Hill contested!')
  expect(matchAnnouncement(state, { ...state, contested: true, winner: 'Nolitek' })).toBe('Nolitek wins!')
  expect(matchAnnouncement({ ...state, winner: 'Nolitek' }, { ...state, winner: 'Nolitek' })).toBeNull()
  expect(matchAnnouncement(state, { ...state, mode: 'tag' })).toBeNull()
})
it('keeps the local player in a compact race without mutating input', () => {
  const scores = Array.from({ length: 8 }, (_, i) => ({ name: `Pilot ${i}`, score: 8 - i, you: i === 7 }))
  expect(raceScores(scores).map(row => row.name)).toEqual(['Pilot 0', 'Pilot 1', 'Pilot 2', 'Pilot 7'])
  expect(scores).toHaveLength(8)
})

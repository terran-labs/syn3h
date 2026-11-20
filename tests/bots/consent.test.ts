/**
 * Stop requests (src/bots/play/consent.ts). Bugs caught: a person who says stop and keeps being
 * grabbed (a miss); ordinary chat ending the games (a false trigger), which matters less.
 */
import { describe, expect, it } from 'vitest'
import { isPlayAgain, isStopRequest } from '../../src/bots/play/consent'

// Stops at any time: only about being grabbed or bothered.
const ANYTIME = [
  'leave me alone', 'leave me alone please', 'go away', 'back off', 'get off me', 'let me go', 'let go of me', 'unhook me', 'put me down',
  'stop grabbing me', 'hey stop grabbing me', 'stop pulling me', 'quit grabbing', "don't grab me", 'no grabbing!', 'LEAVE ME ALONE',
]
// Stops only during a play or within a minute of one: outside, these go to the banter's own rules.
const IN_WINDOW = [
  'stop', 'STOP', 'stop it', 'Stop it!!', 'stop that', 'please stop', 'pls stop', 'quit it', 'quit', 'cut it out', 'knock it off',
  'get off', 'let go', 'enough', "that's enough", 'thats enough', 'no more', 'not now', 'not funny', "don't", 'dont', "please don't",
  'no', 'No!', 'nope', 'nah', 'noooo', 'no thanks', 'stahp', 'ok stop now', 'bots stop', 'Temolin stop', 'no problem, but stop',
  'can you stop', 'can you guys stop', 'I said stop', 'ugh', 'ow', 'hey!', 'argh', 'why', 'wtf', 'so annoying', ':(', '😠', 'nooo why',
]
const NOT_STOPS = [
  "don't stop!", 'never stop', "can't stop laughing", "won't stop me", 'no way that was cool', 'no problem', 'no worries',
  'this is fun', 'ha ha', 'again!', 'lol', 'nice one', 'where is the volcano', 'stopwatch', 'the bus stop', 'non-stop fun',
  "don't worry about it", 'knows', 'nobody', 'notable', 'unstoppable', 'quite good', 'enoughly',
]

describe('stop requests', () => {
  it.each(ANYTIME)('"%s" is a stop request, any time', (line) => {
    expect(isStopRequest(line)).toBe(true)
    expect(isStopRequest(line, true)).toBe(true)
  })
  it.each(IN_WINDOW)('"%s" is a stop request in a play window, and left to the banter outside one', (line) => {
    expect(isStopRequest(line, true)).toBe(true)
    expect(isStopRequest(line)).toBe(false)
  })
  it.each(NOT_STOPS)('"%s" is not, outside a play window', (line) => {
    expect(isStopRequest(line)).toBe(false)
  })
})

describe('coming back', () => {
  it.each(['you can play again', 'ok you can grab me', 'okay grab me', 'you can play with me again', 'play with me', 'grab me again'])('"%s" invites the bots back', (line) => {
    expect(isPlayAgain(line)).toBe(true)
  })
  it.each(["don't grab me", 'never play with me', 'stop', 'grabbing is rude'])('"%s" does not', (line) => {
    expect(isPlayAgain(line)).toBe(false)
  })
})

/**
 * Stop requests (src/bots/play/consent.ts). Bugs caught: a person who says stop and keeps being
 * grabbed (a miss); ordinary chat ending the games (a false trigger), which matters less.
 */
import { describe, expect, it } from 'vitest'
import { isStopRequest } from '../../src/bots/play/consent'

const STOPS = [
  'stop', 'STOP', 'stop it', 'Stop it!!', 'stop that', 'please stop', 'pls stop', 'quit it', 'quit', 'cut it out', 'knock it off',
  'leave me alone', 'leave me alone please', 'go away', 'back off', 'get off me', 'get off', 'let go', 'let me go', 'let go of me',
  'unhook me', 'put me down', 'enough', "that's enough", 'thats enough', 'no more', 'not now', 'not funny', "don't", 'dont', "please don't",
  'no', 'No!', 'nope', 'nah', 'noooo', 'no thanks', 'stahp', 'ok stop now', 'bots stop', 'Temolin stop', 'no problem, but stop',
  'hey stop grabbing me', 'stop pulling me', 'can you stop', 'can you guys stop', 'I said stop',
]
const NOT_STOPS = [
  "don't stop!", 'never stop', "can't stop laughing", "won't stop me", 'no way that was cool', 'no problem', 'no worries',
  'this is fun', 'ha ha', 'again!', 'lol', 'nice one', 'where is the volcano', 'stopwatch', 'the bus stop', 'non-stop fun',
  "don't worry about it", 'knows', 'nobody', 'notable', 'unstoppable', 'quite good', 'enoughly',
]
const UNHAPPY = ['ugh', 'ow', 'hey!', 'argh', 'why', 'wtf', 'so annoying', ':(', '😠', 'nooo why']

describe('stop requests', () => {
  it.each(STOPS)('"%s" is a stop request, any time', (line) => {
    expect(isStopRequest(line)).toBe(true)
    expect(isStopRequest(line, true)).toBe(true)
  })
  it.each(NOT_STOPS)('"%s" is not, outside a play window', (line) => {
    expect(isStopRequest(line)).toBe(false)
  })
  it.each(UNHAPPY)('"%s" counts during a play window only', (line) => {
    expect(isStopRequest(line, true)).toBe(true)
  })
})

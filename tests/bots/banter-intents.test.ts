/**
 * Players' requests read from loose chat. Each list is phrasings a player might really type,
 * including typos and word order; ORDINARY is chat that merely contains the words.
 */
import { describe, expect, it } from 'vitest'
import { type IntentKind, parseIntent } from '../../src/bots/banter/intents'

const BOTS = [
  { id: 65280, name: 'Temolin Dust Clerk' },
  { id: 65281, name: 'Detodak Rust Auditor' },
  { id: 65282, name: 'Fanirek Cone Marshal' },
]

export const PHRASINGS: Record<IntentKind, string[]> = {
  follow: ['follow me', 'Hey, you guys follow me', 'folow me!!', 'FOLLOW ME', 'everyone follow me', 'temolin follow me', 'come with me', 'follow me pls', 'bots, follow', 'this way guys', 'tag along', 'follow my lead', 'with me guys', 'form up on me', 'Hey you guys, follow me', 'follow', 'cmon follow me plz'],
  come: ['come here', 'over here!', 'get over here', 'come over here guys', 'cmere', 'come to me', 'Temolin come here', 'everyone come back', 'here guys', 'regroup', 'come back pls', 'find me', 'come over'],
  stop: ['stop', 'wait', 'wait for me', 'stay', 'stay there', 'hold on', 'hold up', 'freeze!', 'Stop!!!', 'temolin stop', 'everyone stop', 'wait up guys', 'park', 'stay put', "don't move"],
  scatter: ['go away', 'leave me alone', 'scatter!', 'shoo', 'get lost', 'back off', 'give me some space', 'stop following me', 'buzz off bots', 'move along', 'leave me be', 'disperse'],
  chase: ['chase me', 'catch me if you can', 'play tag?', "let's play tag", 'tag', 'wanna play tag', 'come get me', 'try to catch me', 'tag me', 'chase me guys', 'cant catch me', 'temolin chase me'],
  flee: ["you're it", 'tag your it', 'youre it!', "i'm coming for you", 'run from me', "i'm gonna get you", 'Temolin you are it', 'tag, you are it', 'i will catch you', 'catch you'],
  race: ['race me', "let's race", 'race you to the top', 'wanna race', 'race!', 'first one to the summit wins', 'race to the vent', 'beat me to the shore', 'temolin race me', 'race me bots', 'lets race guys', 'i will race you'],
  look: ['look at this', 'check this out', 'come look', 'come see', 'look what i found', 'you have to see this', 'look here', 'check it out guys', 'i found something', 'come and look', 'look over here', 'see this?'],
  help: ['help', "I'm stuck", 'help me', 'im stuck!!', 'stuck', 'rescue me', 'help im flipped', 'upside down help', 'get me out', 'pull me out', 'tow me', 'save me bots'],
  quiet: ['shut up', 'be quiet', 'shh', 'shhhh', 'hush', 'stop talking', 'zip it', 'pipe down', 'quiet down', 'stfu', 'too chatty', 'enough talking bots'],
  talk: ['talk to me', 'say something', 'you can talk again', 'tell me a joke', 'keep talking', 'chat with me', 'speak up', 'start talking', 'talk again', 'unmute', 'tell me something', 'say something guys'],
  who: ['who are you', 'who are you guys', "what's your name", 'who r u', 'introduce yourself', 'who is this', 'what are you', 'temolin who are you', 'who are the bots', 'whats your name', 'your name?', 'who is that'],
  what: ['what are you doing', 'wyd', 'what r u doing', 'whatcha doing', 'where are you going', 'what are you up to', 'sup', "what's up", 'how are you', 'temolin what are you doing', 'where are you', 'what are you all doing'],
  thanks: ['thanks', 'thank you', 'thx', 'ty', 'cheers', 'thanks guys', 'nice one', 'good job', 'well done', 'good bot', 'thank u temolin', 'appreciate it'],
  hello: ['hi', 'hello', 'hey', 'yo', 'hiya', 'howdy', 'hello bots', 'hi everyone', 'good morning', 'hey there', 'greetings', 'hi temolin'],
  bye: ['bye', 'goodbye', 'cya', 'see you', 'gtg', 'got to go', 'brb', 'good night', 'later guys', 'bye bots', 'peace out', 'farewell'],
  insult: ['you suck', 'stupid bots', 'dumb bot', 'useless', 'bad bot', 'you guys are trash', 'noob', 'lame', 'idiot', 'annoying', 'boring', 'worst bots ever'],
}

/** Ordinary chat between people that contains request words but asks the bots for nothing. */
export const ORDINARY = [
  "I'll follow up later", 'did you follow the news', 'I hope it helps my score', 'what a stop sign', 'that was a great race yesterday',
  'my sister used to have a buggy like this', 'the lava looks amazing tonight', 'anyone know how to fly the jet', 'I got the hovercraft working',
  'this planet is so pretty', 'lol', 'haha nice', 'ok', 'brb dinner', 'I keep falling off the cliff on the left side of the volcano',
  'do you play this on a phone', 'what server is this', 'how do I change my colour', 'the minimap is cool', 'nice jump',
  'I think the jet is the best vehicle honestly', 'can not believe how big the volcano is', 'my keyboard is sticky', 'is it night already',
  'I was looking at the sunset', 'who made this game', 'the race to the summit took forever last time I tried it with my cousin',
  'we should follow the road to the other side of the island later today', 'the clouds look like cotton', 'my internet is slow',
  'I left my coffee somewhere', 'tag mode is fun with more people around', 'the bots are funny', 'I think I found a bug in the map',
  'just got here', 'how long have you been playing', 'my buggy flipped twice', 'need to stop for dinner soon though ok', 'this is so relaxing',
  'I like the green colour', 'what time is it there', 'it took me ages to get up that hill', 'the shore is nice', 'the water here is really blue',
  'I love the sound of the engine', 'where did everyone go earlier today when I logged in', 'ha the bot fell in', 'my brother says hi', 'gg',
]

describe('player intents', () => {
  for (const [kind, lines] of Object.entries(PHRASINGS) as [IntentKind, string[]][]) {
    it(`recognises ${kind} from ${lines.length} phrasings`, () => {
      expect(lines.length).toBeGreaterThanOrEqual(10)
      const missed = lines.filter((l) => parseIntent(l, BOTS)?.kind !== kind)
      // A couple of very loose phrasings may go to a neighbouring intent; most must land.
      expect(missed.length, `missed: ${missed.map((m) => `${m} -> ${parseIntent(m, BOTS)?.kind}`).join('; ')}`).toBeLessThanOrEqual(1)
    })
  }

  it('rarely reads ordinary chat as a request', () => {
    const misread = ORDINARY.filter((l) => parseIntent(l, BOTS) !== null)
    const rate = misread.length / ORDINARY.length
    console.log(`false positive rate ${(rate * 100).toFixed(1)}% (${misread.length}/${ORDINARY.length}): ${misread.join(' | ')}`)
    expect(rate).toBeLessThanOrEqual(0.1)
  })

  it('addresses a bot by first name, part of it, a near miss or its job, and groups', () => {
    expect(parseIntent('Temolin, follow me', BOTS)).toMatchObject({ kind: 'follow', to: [65280] })
    expect(parseIntent('temo follow me', BOTS)).toMatchObject({ to: [65280] })
    expect(parseIntent('temolon stop', BOTS)).toMatchObject({ kind: 'stop', to: [65280] })
    expect(parseIntent('auditor come here', BOTS)).toMatchObject({ kind: 'come', to: [65281] })
    expect(parseIntent('you guys follow me', BOTS)).toMatchObject({ all: true, to: [] })
    expect(parseIntent('follow me', BOTS)).toMatchObject({ all: false, to: [] })
  })
})

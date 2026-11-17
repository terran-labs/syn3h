/**
 * What a player's chat line asks the bots to do. No language model: loose patterns over a
 * normalised line, tuned to recognise many phrasings and to leave ordinary chat alone.
 *
 * Recognition is two parts:
 *   addressee  a bot's name or part of it ("Temolin", "temo", "clerk"), a group ("you guys",
 *              "everyone", "bots"), or nobody (the director then picks who answers)
 *   intent     the first pattern that matches, most specific first
 *
 * A line that mentions a word but does not ask for anything ("I'll follow up later",
 * "stop sign") is left alone: patterns ask for the word to be used as a request (at the
 * start, after a name or "please", or with "me"/"us" after it).
 */

export type IntentKind =
  | 'follow' | 'come' | 'stop' | 'scatter' | 'chase' | 'flee' | 'race' | 'look' | 'help'
  | 'quiet' | 'talk' | 'who' | 'what' | 'thanks' | 'hello' | 'bye' | 'insult'

export interface Intent {
  kind: IntentKind
  /** Bot ids named in the line; empty when nobody in particular. */
  to: number[]
  /** "you guys", "everyone", "bots". */
  all: boolean
}

export interface NamedBot { id: number; name: string }

/** Common misspellings and chat shorthand, to their plain word. */
const TYPOS: Record<string, string> = {
  folow: 'follow', follw: 'follow', fallow: 'follow', foller: 'follow', folllow: 'follow', flw: 'follow', fllw: 'follow', followw: 'follow',
  plz: 'please', pls: 'please', plez: 'please', pleas: 'please',
  u: 'you', ya: 'you', yu: 'you', yall: 'you all', yous: 'you all', ur: 'your', r: 'are', m: 'am',
  im: 'i am', iam: 'i am', ima: 'i am going to', imma: 'i am going to', youre: 'you are', ure: 'you are',
  cmon: 'come on', commere: 'come here', cmere: 'come here', comere: 'come here', cum: 'come', kome: 'come', coem: 'come', ocme: 'come',
  hre: 'here', heer: 'here',
  lets: 'let us', letss: 'let us', wanna: 'want to', gonna: 'going to', gotta: 'got to',
  thx: 'thanks', ty: 'thanks', tnx: 'thanks', thanx: 'thanks', thnks: 'thanks', tysm: 'thanks', thank: 'thanks',
  stuk: 'stuck', stcuk: 'stuck',
  wyd: 'what are you doing', wru: 'where are you', hru: 'how are you', sup: 'whats up', wassup: 'whats up', whatsup: 'whats up',
  cya: 'bye', bai: 'bye', byee: 'bye', gtg: 'got to go', g2g: 'got to go', brb: 'be right back', ttyl: 'bye',
  hii: 'hi', hiii: 'hi', helo: 'hello', hallo: 'hello', heya: 'hey', hiya: 'hi', howdy: 'hello', yo: 'hey', oi: 'hey',
  raec: 'race', rcae: 'race', chse: 'chase', chace: 'chase',
  shh: 'shush', shhh: 'shush', shush: 'shush', stfu: 'shut up',
  ppl: 'people', evry1: 'everyone', every1: 'everyone', evryone: 'everyone', everone: 'everyone', guise: 'guys', gys: 'guys',
  dont: 'do not', cant: 'can not', wont: 'will not', whats: 'what is', wats: 'what is', wat: 'what', whos: 'who is', hows: 'how is', thats: 'that is',
  luk: 'look', lok: 'look', loook: 'look', chek: 'check', cheq: 'check', chk: 'check',
}

/** Lower case, accents and punctuation off, letters stretched for emphasis shortened. */
export function normalize(text: string): string {
  const words = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[''`]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => w.replace(/([a-z])\1{2,}/g, '$1$1'))
  return words.map((w) => TYPOS[w] ?? TYPOS[w.replace(/([a-z])\1/g, '$1')] ?? w).join(' ').replace(/\s+/g, ' ').trim()
}

const GROUP = /\b(you guys|you all|guys|everyone|everybody|all of you|bots|robots|gang|folks|crew|yall)\b/

// Each pattern runs on " <normalised line> " so \b works at both ends. Order matters: the
// first match wins, so specific phrases come before the words they contain.
const PATTERNS: [IntentKind, RegExp, RegExp?][] = [
  ['quiet', /\b(shut up|be quiet|quiet down|keep it down|pipe down|zip it|shush|hush|stop talking|stop chatting|less talking|enough talking|silence|stop spamming|too chatty|go quiet|no more chat)\b/],
  ['talk', /\b(talk to me|say something|you can talk|start talking|keep talking|chat with me|speak up|talk again|unmute|i miss your|tell me (a joke|something))\b/],
  ['scatter', /\b(go away|leave me alone|scatter|shoo|get lost|back off|buzz off|give me (some )?space|stop following|quit following|leave me be|go home|disperse|bug off|get away from me|move along)\b/, /\b(do not leave|dont leave|leave it|leave them|leaving soon|i leave|i will leave|i am leaving|left)\b/],
  ['flee', /\b(you are it|tag you are it|your it|tag your it|run away from me|run from me|i am coming for you|i am going to get you|i will catch you|i am it|im it|catch you)\b/],
  ['chase', /\b(chase me|catch me|play tag|tag me|lets play tag|let us play tag|wanna play tag|want to play tag|tag anyone|tag game|come get me|try (and|to) catch me|cant catch me|can not catch me|get me if you can|tag$)\b|^ ?tag\b/],
  ['race', /\b(race me|lets race|let us race|race you|wanna race|want to race|first one to|first to the|race to|i will race|beat me to|race$)\b|^ ?race\b/],
  ['look', /\b(look at this|look at that|look here|check (this|it|that) out|come (and |to )?(look|see)|come see|see this|you (have|got) to see|look what i found|over here look|i found something|found something|look over here|look$)\b/],
  ['help', /\b(help|i am stuck|stuck|unstick me|rescue me|save me|i am flipped|flipped over|upside down|i fell|get me out|pull me out|i can not move|tow me)\b/, /\b(no help|helpful|helps|helped|helping you|need no)\b/],
  ['follow', /(\bfollow (me|us|along|my lead|behind)\b|\b(come|follow) with me\b|\btag along\b|\bthis way\b|\bon me\b|\bwith me\b|\bafter me\b|\bkeep up\b|\bstay (close|with me)\b|\bfollow\s*$|^ ?follow\b|\bjoin me\b|\bconvoy\b|\bform up\b|\bfall in\b|\blead the way\b)/, /\b(follow up|follow you|following you|follow the|follow that|followed|follow through|follow your)\b/],
  ['come', /\b(come here|come over here|over here|get over here|come to me|come back|here guys|come on over|regroup|rally|to me|where i am|my location|find me|come over)\b/, /\b(come here often|over here now i am)\b/],
  ['stop', /^ ?(stop|wait|halt|freeze|stay|park|hold (on|up|it)|sit|stand still|do not move|dont move|hang on|pause|whoa|woah|easy)\b|\b(please stop|stop please|stop moving|stop driving|wait for me|wait up|stay there|stay here|stay put|hold position|everyone stop|bots stop|guys stop|wait guys|stop everyone)\b/],
  ['what', /\b(what are you (all )?(doing|up to)|what is up|whats up|where are you (all )?going|what (are )?you doing|whatcha doing|what doing|how are you|where are you|what are you all doing|what is everyone doing)\b/],
  ['who', /\b(who are you|who is this|what is your name|whats your name|who r you|introduce yourself|who are these|who are the bots|what are you\s*$|who is that|your name)\b/],
  ['thanks', /\b(thanks|thank you|cheers|much obliged|appreciate it|nice one|good job|well done|good bots?|great job)\b/],
  ['insult', /\b(you suck|suck|stupid|dumb|idiot|useless|trash|garbage|bad bots?|noob|lame|worst|annoying|you are bad|boring|hate you|go away losers?|loser)\b/],
  ['bye', /\b(bye|goodbye|good bye|see you|got to go|be right back|good night|goodnight|farewell|later guys|i am off|i am out|peace out|logging off)\b/],
  ['hello', /^ ?(hi|hello|hey|greetings|good (morning|afternoon|evening)|whats up|heyo|hey there|hi there|morning|evening|salutations)\b|\b(hello|hi|hey) (bots|guys|everyone|all|there)\b/],
]

/** Bot names said in the line: the first word of a name, four or more letters of it, or its job word. */
export function namedBots(norm: string, bots: readonly NamedBot[]): number[] {
  return matchNames(norm, bots).ids
}

/** The bots named, and the words that named them (removed before reading the request). */
function matchNames(norm: string, bots: readonly NamedBot[]): { ids: number[]; words: Set<string> } {
  const words = norm.split(' ')
  const ids: number[] = []
  const used = new Set<string>()
  for (const bot of bots) {
    const parts = bot.name.toLowerCase().split(/\s+/)
    const first = parts[0]
    const jobWords = parts.slice(1).filter((w) => w.length > 3)
    let hit = false
    for (const w of words) {
      const byName = w.length >= 4 && (first.startsWith(w) || (w.length >= first.length - 1 && near(w, first)))
      const byJob = jobWords.includes(w) || jobWords.some((j) => w === `${j}s`)
      if (byName || byJob) { hit = true; used.add(w) }
    }
    if (hit) ids.push(bot.id)
  }
  return { ids, words: used }
}

/** Equal, or one letter added, missing or changed. */
function near(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * Read a chat line. Null when it asks nothing of the bots. `bots` are the bots in the room
 * with their display names, for addressing.
 */
export function parseIntent(text: string, bots: readonly NamedBot[]): Intent | null {
  const norm = normalize(text)
  if (!norm || norm.length > 160) return null
  const { ids: to, words: names } = matchNames(norm, bots)
  // Remove the names before matching, so "Temolin, stop" reads as "stop".
  let body = ` ${norm.split(' ').filter((w) => !names.has(w)).join(' ')} `
  body = body.replace(/\b(please|hey|ok|okay|so|um|uh|now|just|can you|could you|would you|will you|lets|let us|and)\b/g, (m) => m === 'hey' ? m : ' ').replace(/\s+/g, ' ')
  const all = GROUP.test(` ${norm} `)
  body = ` ${body.trim()} `
  for (const [kind, yes, no] of PATTERNS) {
    if (!yes.test(body)) continue
    if (no?.test(body)) continue
    // Words that are requests only when said to the bots: an unaddressed long line that
    // merely contains them is ordinary chat.
    if (LOOSE.has(kind) && !to.length && !all && body.trim().split(' ').length > 6) continue
    return { kind, to, all }
  }
  return null
}

const LOOSE = new Set<IntentKind>(['race', 'chase', 'stop', 'help', 'insult', 'thanks', 'bye', 'hello', 'what', 'look', 'come', 'follow'])

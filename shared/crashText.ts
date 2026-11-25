/**
 * What a crash report may say, applied by the client before sending (src/net/analytics.ts)
 * and again by the server regardless (server/analytics.ts). An error message can carry a
 * player's name, a chat line, a private room's name or an address; the Welcome page promises
 * none of that is kept. So a crash record is structured, not free text:
 *
 *  - errorName: a short identifier like TypeError, else "Error".
 *  - message: quoted, bracketed and parenthesised text removed; any word holding "@", "://",
 *    "?", "#", "/" or "\" removed; digit runs longer than 4 collapsed; then only words from
 *    ERROR_WORDS (the vocabulary of browser and engine error messages) and short numbers are
 *    kept, every other word becoming "_". Nothing a person typed can survive that, whatever
 *    the client sent. The client also replaces the player's own name and room with
 *    placeholders first. At most MESSAGE_MAX characters of [A-Za-z0-9 .,:_'-].
 *  - frames: only our own bundle's same-origin paths (/assets/<name>.js or /src/... with
 *    :line:col); anything else is dropped, not scrubbed. At most three.
 */

export const MESSAGE_MAX = 120

/** Words that appear in browser, WebGPU, WebAssembly and network error messages. */
export const ERROR_WORDS: ReadonlySet<string> = new Set((
  'a an the of to in on at for from with by as is are was were be been has have had not no and or but if ' +
  'cannot can could can\'t couldn\'t doesn\'t isn\'t wasn\'t does do did will would should must may ' +
  'read write reading writing set setting get getting call calling properties property value values ' +
  'undefined null nan infinity object function functions type types range reference syntax internal eval uri error errors exception ' +
  'failed failure fail to execute executing load loading loaded fetch fetching import importing imported module modules script ' +
  'dynamically resolve resolved specifier network request response timeout timed out abort aborted operation operations ' +
  'device devices lost destroyed adapter gpu webgpu webgl webgl2 context contexts buffer buffers texture textures shader shaders ' +
  'pipeline pipelines compile compiled compilation create creating created validation invalid valid limit limits exceeded exceeds ' +
  'memory allocation allocate allocated out maximum minimum call stack size length array arrays index bounds offset ' +
  'unexpected token end input json parse parsing expected found missing required unknown unsupported supported ' +
  'wasm webassembly instance instantiate instantiation link linking runtime unreachable executed integer overflow divide division zero ' +
  'table element signature mismatch indirect uninitialized initialization before after access lexical declaration declared defined ' +
  'variable constant assignment iterable spread argument arguments constructor new class super private member field method ' +
  'permission denied quota storage security insecure blocked disabled enabled not-allowed notallowed ' +
  'websocket socket connection connect connecting closed close closing refused reset handshake ' +
  'promise rejected rejection resolve handler listener event events frame frames render rendering draw ' +
  'physics rapier world body bodies collider colliders vehicle audio worklet worker workers message messages ' +
  'too many much recursion deep depth nested circular structure convert converting bigint symbol string number boolean ' +
  'first second third last next previous current state status code reason because while during already still only ' +
  'this that it its which what when where there than then other another some any all each every ' +
  'lost_device placeholder _player_ _room_'
).split(' ').filter(Boolean))

/** A short error class name, else "Error". */
export function errorName(v: unknown): string {
  return typeof v === 'string' && /^[A-Z][A-Za-z]{2,30}$/.test(v) ? v : 'Error'
}

/** See the file comment. `known` replaces the client's own name and room with placeholders. */
export function reduceMessage(text: unknown, known: { name?: string; room?: string } = {}): string {
  if (typeof text !== 'string') return ''
  let s = text.slice(0, 2000)
  for (const [value, mark] of [[known.name, ' _player_ '], [known.room, ' _room_ ']] as const) {
    if (value && value.length >= 2) s = s.split(value).join(mark)
  }
  // Quoted and bracketed text, a few levels deep.
  for (let i = 0; i < 3; i++) s = s.replace(/'[^']*'|"[^"]*"|`[^`]*`|\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}|<[^<>]*>/g, ' ')
  const words = s.split(/\s+/).filter((w) => w && !/[@?#/\\]|:\/\//.test(w))
  const kept: string[] = []
  for (const raw of words) {
    const w = raw.replace(/\d{5,}/g, 'N').replace(/[^A-Za-z0-9.,:_'-]/g, '')
    const bare = w.replace(/[.,:]+$/, '')
    const ok = /^\d{1,4}$/.test(bare) || ERROR_WORDS.has(bare.toLowerCase())
    const token = ok ? w : '_' + (w.length > bare.length ? w.slice(bare.length) : '')
    if (token.startsWith('_') && !ok && kept.at(-1)?.startsWith('_') && !kept.at(-1)!.startsWith('_player_') && !kept.at(-1)!.startsWith('_room_')) continue
    kept.push(token)
  }
  return kept.join(' ').slice(0, MESSAGE_MAX).trim()
}

const FRAME = /^\/(?:assets\/[A-Za-z0-9._-]{1,80}\.js|src\/[A-Za-z0-9/._-]{1,160}\.(?:ts|js))(?::\d{1,7}){1,2}$/

/** Frames joined by " < ": only those of our own bundle's shape; at most three. */
export function cleanFrames(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.split(' < ').filter((f) => FRAME.test(f)).slice(0, 3).join(' < ')
}

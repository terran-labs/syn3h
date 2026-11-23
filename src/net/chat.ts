/**
 * The client's side of chat: what arrived, what to show, who is muted. No DOM, so it can be
 * tested on its own; the panel (src/ui/chat) draws it and the bots (src/bots/banter) listen.
 *
 * Display rules live here, not in the panel, so they hold for every view: muted players,
 * bot lines while "Hide bot chatter" is on, and everything while "Show chat" is off are
 * never shown. Listeners that act on lines (the bot simulator reading requests) still hear
 * people's lines whatever this screen shows, because the room, not this screen, owns chat.
 */
import { isBotId, type ServerMessage } from '../../shared/protocol'
import { chatHideBots, chatOn, chatShow, cleanChatText } from '../../shared/chat'

export interface ChatLine {
  /** Local sequence number, unique per page. */
  seq: number
  from: number
  name: string
  /** The speaker's vehicle tint, a CSS colour. */
  color: string
  bot: boolean
  text: string
  /** performance.now() when it arrived. */
  at: number
  /** Wall clock ms, for the hover timestamp. */
  wall: number
  /** Said by this player. */
  mine: boolean
  /** A note from this screen (refused, not delivered), not a line from the room. */
  system?: boolean
}

export interface ChatHost {
  /** Our own id, 0 before the welcome. */
  selfId(): number
  nameOf(id: number): string
  colorOf(id: number): string
  connected(): boolean
  send(msg: { type: 'chat'; text: string; bot?: number }): void
}

/** Lines kept for the scrollback. Older ones are forgotten: chat is not a record. */
const KEEP = 120
/** A sent line not echoed by the room within this long was not delivered (an older room). */
const ECHO_MS = 4000

export type ChatListener = (line: ChatLine) => void

export class ChatChannel {
  readonly lines: ChatLine[] = []
  /** Player ids muted on this screen, for this session. */
  readonly muted = new Set<number>()
  private readonly shown = new Set<ChatListener>()
  private readonly heard = new Set<ChatListener>()
  private readonly changed = new Set<() => void>()
  private seq = 0
  private awaitingEcho = 0
  private echoTimer: ReturnType<typeof setTimeout> | undefined
  private refusedUntil = 0

  constructor(private readonly host: ChatHost, private readonly now: () => number = () => performance.now()) {}

  /** Lines this screen shows, newest last. */
  visible(): ChatLine[] {
    return this.lines.filter((l) => this.shows(l))
  }

  /** Whether a line passes this screen's own rules (mute, hide bots, chat shown). */
  shows(line: ChatLine): boolean {
    if (line.system) return chatShow.value
    if (!chatShow.value) return false
    if (this.muted.has(line.from)) return false
    if (line.bot && chatHideBots.value) return false
    return true
  }

  /** Whether this player can type right now, and if not, why. */
  canSend(): { ok: true } | { ok: false; why: string } {
    if (!chatShow.value) return { ok: false, why: 'Chat is off in your settings' }
    if (!this.host.connected()) return { ok: false, why: 'Chat needs a room connection' }
    if (!chatOn.value) return { ok: false, why: 'The host turned chat off' }
    return { ok: true }
  }

  /** Send a line typed by this player. Returns false if it was not sent. */
  send(raw: string): boolean {
    const text = cleanChatText(raw)
    if (!text || !this.canSend().ok) return false
    if (this.now() < this.refusedUntil) { this.note('Slow down a little: one line every couple of seconds.'); return false }
    this.host.send({ type: 'chat', text })
    this.awaitingEcho++
    clearTimeout(this.echoTimer)
    this.echoTimer = setTimeout(() => {
      if (this.awaitingEcho > 0) this.note('That line did not reach the room. It may be running an older version without chat.')
      this.awaitingEcho = 0
    }, ECHO_MS)
    return true
  }

  /** Bot simulator only: say a line for bot `bot`. */
  sendAsBot(bot: number, text: string): void {
    this.host.send({ type: 'chat', text, bot })
  }

  /** Feed every server message through here; returns true if it was a chat message. */
  receive(msg: ServerMessage): boolean {
    if (msg.type === 'chat-refused') {
      if (msg.reason === 'rate') {
        this.refusedUntil = this.now() + (msg.wait ?? 2) * 1000
        this.note('Slow down a little: one line every couple of seconds.')
      } else this.note('The host has turned chat off for this room.')
      this.awaitingEcho = 0
      return true
    }
    if (msg.type !== 'chat') return false
    // The room relays only clean text, but this screen does not take that on trust.
    const text = typeof msg.text === 'string' ? cleanChatText(msg.text) : null
    if (!text || typeof msg.from !== 'number') return true
    const mine = msg.from === this.host.selfId()
    if (mine) this.awaitingEcho = Math.max(0, this.awaitingEcho - 1)
    this.add({ from: msg.from, name: this.host.nameOf(msg.from), color: this.host.colorOf(msg.from), bot: isBotId(msg.from), text, mine })
    return true
  }

  /** A line from this screen to this player only. */
  note(text: string): void {
    this.add({ from: 0, name: '', color: '', bot: false, text, mine: false, system: true })
  }

  mute(id: number, muted = true): void {
    if (muted) this.muted.add(id); else this.muted.delete(id)
    for (const l of this.changed) l()
  }

  /** Lines shown on this screen, as they arrive. */
  onShow(listener: ChatListener): () => void { this.shown.add(listener); return () => this.shown.delete(listener) }
  /** Every line from the room, shown here or not (the bots read requests from these). */
  onHear(listener: ChatListener): () => void { this.heard.add(listener); return () => this.heard.delete(listener) }
  /** Mutes or settings changed: redraw. */
  onChange(listener: () => void): () => void { this.changed.add(listener); return () => this.changed.delete(listener) }

  dispose(): void {
    clearTimeout(this.echoTimer)
    this.shown.clear(); this.heard.clear(); this.changed.clear()
  }

  private add(fields: Omit<ChatLine, 'seq' | 'at' | 'wall'>): void {
    const line: ChatLine = { ...fields, seq: ++this.seq, at: this.now(), wall: Date.now() }
    this.lines.push(line)
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP)
    if (!line.system) for (const l of this.heard) l(line)
    if (this.shows(line)) {
      for (const l of this.shown) l(line)
      // For the name labels (feat/nameplates-phone) or anything else that wants a moment of
      // emphasis on the speaker: `{ id, text, bot }`. Only for lines this screen shows.
      if (!line.system && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent(CHAT_SPEAK_EVENT, { detail: { id: line.from, text: line.text, bot: line.bot } }))
      }
    }
  }
}

/** Window event fired when a shown line is spoken; detail is `{ id, text, bot }`. */
export const CHAT_SPEAK_EVENT = 'mira:chat-speak'

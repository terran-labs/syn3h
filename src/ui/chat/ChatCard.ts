/**
 * Chat, as the last card in the sidebar's stack (the owner, 17 November 2026: "convert the
 * messaging panel to be a new card at the bottom of the card stack"). The card holds the log
 * and, last, the field; over the game, a strip shows the newest lines for a few seconds when
 * "Show new chat over the game" (a Me card setting, Interface group) is on. Who is in the room
 * is the Players & session card's; a name in the log, or a player's row there, opens the
 * mute menu (showMenu, offered to the Players card through chatLink).
 *
 * Opening: Y while driving, the left column's Chat row (through chatLink), or the card's own
 * header. Y and the row show the panels, open this card and put the caret in the field. Enter on
 * an empty field or Escape leaves the field and goes back to driving.
 *
 * Everything a player wrote is drawn with textContent, never as markup, and links are left as
 * plain text. Colour means identity in this game, so each name is drawn in its vehicle's tint,
 * lifted where a dark tint would vanish on the glass. Bots carry the bot mark before the name
 * (playerMarks.ts, the same mark every surface uses).
 *
 * While the field has focus `input.typing` is set, which stops every driving key, the stick and
 * the gamepad (src/core/Input.ts). It is cleared on blur, however focus leaves.
 */
import { CHAT_SPEAK_EVENT, type ChatChannel, type ChatLine } from '../../net/chat'
import { chatHideBots, chatOn, chatOverlay, chatShow, MAX_CHAT_LENGTH } from '../../../shared/chat'
import { restoreChatOverlay } from './overlayPreference'
import { markedName, legibleTint } from '../playerMarks'
import { chatLink } from './chatLink'
import { params } from '../../../shared/params'
import { touchLeftHanded as leftHanded } from '../TouchPreferences'
import './chat.css'

/** What the card needs from the shell: a place in the stack, and the panels. */
export interface ChatHost {
  /** The shell's element: the strip, the mute menu and the live region go here. */
  element: HTMLElement
  /** Add the card to the sidebar's stack; returns the card element. */
  addCard(id: string, title: string, body: HTMLElement, summary: () => string): HTMLElement
  /** Show the panels with this card open. */
  showCard(id: string): void
  /** Hide the panels and go back to driving (captures the cursor on a desktop). */
  drive(): void
  /** True while the sidebar is showing. */
  panelsOpen(): boolean
}

export interface ChatCardOptions {
  channel: ChatChannel
  input: { typing: boolean }
  /** True while playing and not paused: Y opens chat only then. */
  canOpen(): boolean
}

/** The card's id in the stack. */
export const CHAT_CARD = 'chat'
/** Newest lines shown in the strip over the game. */
const STRIP_LINES = 3
/** A line stays in the strip this long, ms, then fades. */
const STRIP_MS = 8000
/** A speaker's vehicle label stays lit this long, ms. */
const SPEAKING_MS = 3500
/** Key that opens chat: Y, the usual "say" key (Enter fires). */
export const CHAT_KEY = 'KeyY'

// The name tint and its contrast rule live with the bot mark (playerMarks.ts); re-exported for
// the tests and callers that know them as chat's.
export { CHAT_NAME_CONTRAST, CHAT_NAME_SURFACE, contrastRatio, legibleTint } from '../playerMarks'

/**
 * The card's summary shows the unread count while lines wait. A line is read once the card
 * is open with the panels showing and the log scrolled to its end (readIfSeen).
 */
export function chatSummary(unread: number): string {
  return unread > 0 ? `${unread > 99 ? '99+' : unread} unread` : ''
}

const timeOf = (wall: number) => new Date(wall).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export class ChatCard {
  /** The card in the stack. */
  readonly card: HTMLElement
  private readonly body = document.createElement('div')
  private readonly strip = document.createElement('div')
  private readonly overlayColumn = document.createElement('div')
  private readonly menu = document.createElement('div')
  private readonly live = document.createElement('div')
  private readonly log: HTMLOListElement
  private readonly field: HTMLInputElement
  private readonly form: HTMLFormElement
  private readonly status: HTMLElement
  private unread = 0
  /** The log was scrolled to its newest line when last looked at. */
  private pinned = true
  private unreadPerson: ChatLine | null = null
  private readonly unsubscribe: (() => void)[] = []
  private readonly abort = new AbortController()
  private readonly stripTimer: ReturnType<typeof setInterval>
  private readonly speaking = new Map<number, ReturnType<typeof setTimeout>>()
  private keyboardOff?: () => void

  constructor(private readonly host: ChatHost, private readonly options: ChatCardOptions) {
    this.body.className = 'chat-body'
    this.body.innerHTML = `
      <ol class="chat-log" tabindex="0" aria-label="Chat log" data-card-grow></ol>
      <p class="chat-status" hidden></p>
      <form class="chat-form" autocomplete="off">
        <input class="chat-field" type="text" enterkeyhint="send" autocomplete="off" autocorrect="on" spellcheck="true" aria-label="Chat" placeholder="Say something nice" maxlength="${MAX_CHAT_LENGTH}">
        <button type="submit" class="chat-send">Send</button>
      </form>`
    const q = <T extends HTMLElement>(s: string) => this.body.querySelector<T>(s)!
    this.log = q<HTMLOListElement>('.chat-log'); this.field = q<HTMLInputElement>('.chat-field'); this.form = q<HTMLFormElement>('.chat-form')
    this.status = q('.chat-status')
    this.strip.className = 'chat-strip'; this.strip.setAttribute('aria-hidden', 'true')
    this.menu.className = 'chat-menu'; this.menu.setAttribute('role', 'menu'); this.menu.hidden = true
    this.live.className = 'chat-live'; this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'false')
    const help = host.element.querySelector<HTMLElement>(':scope > .spawn-help')
    if (help && !host.element.classList.contains('has-touch')) {
      this.overlayColumn.className = 'help-chat-column'
      help.before(this.overlayColumn)
      this.overlayColumn.append(help, this.strip)
    } else {
      host.element.append(this.strip)
    }
    host.element.append(this.menu, this.live)
    this.card = host.addCard(CHAT_CARD, 'Chat', this.body, () => this.summary())

    const signal = this.abort.signal
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit() }, { signal })
    this.field.addEventListener('focus', () => { options.input.typing = true; this.followKeyboard(true) }, { signal })
    this.field.addEventListener('blur', () => { options.input.typing = false; this.followKeyboard(false) }, { signal })
    this.field.addEventListener('keydown', (e) => {
      // Keys typed here are the line's, not the game's.
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); this.leave() }
    }, { signal })
    // Pinned to the newest line until the player scrolls away from it themselves: a scroll the
    // card's own resizing causes (the stack easing its height) must not unpin it.
    let handled = 0
    for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const) this.log.addEventListener(type, () => { handled = performance.now() }, { signal, passive: true })
    this.log.addEventListener('scroll', () => {
      if (this.atBottom()) this.pinned = true
      else if (performance.now() - handled < 1000) this.pinned = false
      this.readIfSeen()
    }, { signal, passive: true })
    // The card grows and shrinks with the room the stack gives it (inspector/cardFit.ts): a log
    // that was showing its newest line keeps showing it.
    if (typeof ResizeObserver !== 'undefined') {
      const keep = new ResizeObserver(() => { if (this.pinned) this.log.scrollTop = this.log.scrollHeight; this.readIfSeen() })
      keep.observe(this.log); signal.addEventListener('abort', () => keep.disconnect())
    }
    this.log.addEventListener('click', (e) => this.onLogClick(e), { signal })
    window.addEventListener('keydown', (e) => this.onKey(e), { signal, capture: true })
    // The speaker's vehicle label (src/ui/nameplates) lights up for a moment with a speech mark.
    window.addEventListener(CHAT_SPEAK_EVENT, (e) => this.markSpeaker((e as CustomEvent<{ id: number }>).detail.id), { signal })
    window.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.menu.hidden = true }, { signal })
    // The card opening, closing or coming into view: draw the log, and the lines count as read.
    const watch = new MutationObserver(() => this.onShown())
    watch.observe(this.card, { attributes: true, attributeFilter: ['class'] })
    const panel = this.card.closest('.world-inspector')
    if (panel) watch.observe(panel, { attributes: true, attributeFilter: ['hidden'] })
    signal.addEventListener('abort', () => watch.disconnect())

    const { channel } = options
    this.unsubscribe.push(channel.onShow((line) => this.onLine(line)))
    this.unsubscribe.push(channel.onChange(() => this.redraw()))
    // "Show new chat over the game" (shared/chat.ts) is switched in the Me card's Interface
    // group. Off, lines go only into the log and the unread count.
    this.unsubscribe.push(restoreChatOverlay())
    this.unsubscribe.push(params.onChange((id) => {
      if (id === chatOverlay.def.id) this.renderStrip()
      if (id === chatShow.def.id || id === chatHideBots.def.id || id === chatOn.def.id) this.redraw()
      if (id === leftHanded.def.id) this.syncHand()
    }))
    // The left column's Chat row, and anything else, opens chat through the link.
    chatLink.setOpener(() => this.openAndFocus())
    chatLink.setPersonMenu((id, anchor, name) => this.showMenu(id, anchor, name))
    this.stripTimer = setInterval(() => this.fadeStrip(), 1000)
    this.syncHand()
    this.redraw()
  }

  /** The card is open and the panels are showing: the log is in front of the player. */
  get isOpen(): boolean { return this.card.classList.contains('is-open') && this.host.panelsOpen() }
  get unreadCount(): number { return this.unread }

  /** Show the panels on the Chat card and put the caret in the field. */
  openAndFocus(): void {
    if (!chatShow.value) return
    this.host.showCard(CHAT_CARD)
    // Focus now, inside the key press or tap, or a phone will not raise its keyboard. The card
    // eases open; bring the field into view once it has.
    this.field.focus({ preventScroll: true })
    setTimeout(() => { if (document.activeElement === this.field) this.field.scrollIntoView({ block: 'nearest' }) }, 320)
  }

  /** Leave the field and go back to driving. */
  private leave(): void {
    this.field.blur()
    this.options.input.typing = false
    this.host.drive()
  }

  dispose(): void {
    chatLink.setOpener(null)
    chatLink.setPersonMenu(null)
    for (const t of this.speaking.values()) clearTimeout(t)
    this.keyboardOff?.()
    this.abort.abort()
    for (const u of this.unsubscribe) u()
    clearInterval(this.stripTimer)
    this.options.input.typing = false
    this.strip.remove(); this.menu.remove(); this.live.remove()
    this.overlayColumn.replaceWith(...this.overlayColumn.childNodes)
  }

  /** The closed card's summary, kept current here; the stack also refreshes it while open. */
  private syncSummary(): void {
    const sum = this.card?.querySelector('.wi-head .wi-sum')
    if (sum) { const text = this.summary(); if (sum.textContent !== text) sum.textContent = text }
  }

  private summary(): string {
    return chatSummary(this.unread)
  }

  private wasOpen = false
  private onShown(): void {
    // Only a change between closed and open matters; the stack toggles other classes as it eases.
    const open = this.isOpen
    if (open === this.wasOpen) return
    this.wasOpen = open
    this.renderStrip()
    if (!open) return
    this.renderLog()
    this.log.scrollTop = this.log.scrollHeight
    this.syncStatus()
    this.readIfSeen()
  }

  /**
   * While the field has focus on a phone, keep the panel's foot above the on-screen keyboard:
   * the layout viewport does not shrink for it on every phone, the visual viewport does. The
   * panel's height gives way, the stack scrolls, and the field is brought back into view.
   */
  private followKeyboard(on: boolean): void {
    this.keyboardOff?.(); this.keyboardOff = undefined
    const panel = this.card.closest<HTMLElement>('.world-inspector')
    panel?.style.removeProperty('max-height')
    const vv = window.visualViewport
    if (!on || !vv || !panel) return
    const sync = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      if (!covered) { panel.style.removeProperty('max-height'); return }
      const top = panel.getBoundingClientRect().top
      panel.style.maxHeight = `${Math.max(120, vv.offsetTop + vv.height - top - 8)}px`
      this.field.scrollIntoView({ block: 'nearest' })
    }
    vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync)
    this.keyboardOff = () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync) }
    sync()
  }

  private markSpeaker(id: number): void {
    if (!chatOverlay.value) return
    const plate = document.querySelector<HTMLElement>(`.vehicle-nameplate[data-vehicle="${id}"]`)
    clearTimeout(this.speaking.get(id))
    if (!plate) return
    plate.classList.remove('is-speaking'); void plate.offsetWidth; plate.classList.add('is-speaking')
    this.speaking.set(id, setTimeout(() => { plate.classList.remove('is-speaking'); this.speaking.delete(id) }, SPEAKING_MS))
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code !== CHAT_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    if (!chatShow.value || !this.options.canOpen()) return
    e.preventDefault(); e.stopImmediatePropagation()
    this.openAndFocus()
  }

  private submit(): void {
    const text = this.field.value
    // Enter on an empty field is the way back to driving, as Escape is.
    if (!text.trim()) { this.leave(); return }
    if (this.options.channel.send(text)) this.field.value = ''
    this.syncStatus()
  }

  private onLine(line: ChatLine): void {
    if (line.system || !line.bot) this.announce(line)
    if (this.isOpen) {
      const stick = this.atBottom()
      this.log.querySelector('.chat-empty')?.remove()
      this.log.append(this.lineElement(line, true))
      while (this.log.children.length > 120) this.log.firstElementChild!.remove()
      if (stick || line.mine) this.log.scrollTop = this.log.scrollHeight
      else this.addUnread(line)
    } else {
      this.addUnread(line)
      this.renderStrip()
    }
    this.syncSummary()
  }

  /** Screen readers hear people's lines and notes; bot chatter is in the log for those who look. */
  private announce(line: ChatLine): void {
    const p = document.createElement('p')
    p.textContent = line.system ? line.text : `${line.mine ? 'You' : line.name}: ${line.text}`
    this.live.append(p)
    while (this.live.children.length > 3) this.live.firstElementChild!.remove()
  }

  private addUnread(line: ChatLine): void {
    if (line.mine || line.system) return
    this.unread++
    if (!line.bot) this.unreadPerson = line
    this.publishUnread()
  }

  /** The log is open and its newest lines are in view: they have been read. */
  private readIfSeen(): void {
    if (!this.unread || !this.isOpen || !this.atBottom()) return
    this.unread = 0; this.unreadPerson = null
    this.publishUnread()
  }

  /** One source for the unread count: the card's summary and the left column's row. */
  private publishUnread(): void {
    chatLink.setUnread(this.unread, !!this.unreadPerson)
    this.syncSummary()
    this.card.classList.toggle('has-unread', this.unread > 0)
    const head = this.card.querySelector('.wi-head')
    const who = this.unreadPerson ? `, including one from ${this.unreadPerson.name}` : ''
    head?.setAttribute('aria-label', this.unread ? `Chat, ${this.unread} unread${who}` : 'Chat')
  }

  private atBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24
  }

  private redraw(): void {
    // "Show chat" off: the card and the strip go, and the field cannot be reached.
    this.card.classList.toggle('is-off', !chatShow.value)
    if (!chatShow.value && document.activeElement === this.field) this.field.blur()
    // Lines now hidden (a mute, bots hidden) stop counting as unread.
    const visible = this.options.channel.visible()
    const shown = new Set(visible.map((l) => l.seq))
    if (this.unreadPerson && !shown.has(this.unreadPerson.seq)) this.unreadPerson = null
    if (this.unread) this.unread = Math.min(this.unread, visible.filter((l) => !l.mine && !l.system).length)
    this.publishUnread()
    this.renderStrip()
    if (this.isOpen) { this.renderLog(); this.syncStatus() }
  }

  private renderLog(): void {
    this.log.replaceChildren(...this.options.channel.visible().map((l) => this.lineElement(l, false)))
    if (!this.log.children.length) {
      const empty = document.createElement('li'); empty.className = 'chat-empty'
      empty.textContent = 'Nothing said yet. Press Y to say hello.'
      this.log.append(empty)
    }
  }

  private renderStrip(): void {
    if (this.isOpen || !chatOverlay.value || !chatShow.value) { this.strip.replaceChildren(); return }
    const now = performance.now()
    const recent = this.options.channel.visible().filter((l) => now - l.at < STRIP_MS).slice(-STRIP_LINES)
    const keep = new Set(recent.map((l) => String(l.seq)))
    for (const child of [...this.strip.children] as HTMLElement[]) if (!keep.has(child.dataset.seq!)) child.remove()
    for (const l of recent) if (!this.strip.querySelector(`[data-seq="${l.seq}"]`)) this.strip.append(this.lineElement(l, true, 'div'))
  }

  private fadeStrip(): void {
    if (this.isOpen || !this.strip.children.length) { this.strip.classList.remove('is-yielding'); return }
    // Step back when a vehicle's name label or a readout passes behind the strip.
    const box = this.strip.getBoundingClientRect()
    const under = [...document.querySelectorAll<HTMLElement>('.mira-nametags > *, .fh-read')].some((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && el.style.display !== 'none' && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom
    })
    this.strip.classList.toggle('is-yielding', under)
    const now = performance.now()
    for (const child of [...this.strip.children] as HTMLElement[]) {
      const line = this.options.channel.lines.find((l) => String(l.seq) === child.dataset.seq)
      if (!line || now - line.at > STRIP_MS) child.classList.add('is-leaving')
      if (!line || now - line.at > STRIP_MS + 700) child.remove()
    }
  }

  private lineElement(line: ChatLine, fresh: boolean, tag: 'li' | 'div' = 'li'): HTMLElement {
    const row = document.createElement(tag)
    row.className = `chat-line${line.system ? ' is-system' : ''}${line.bot ? ' is-bot' : ''}${line.mine ? ' is-mine' : ''}${fresh ? ' is-new' : ''}`
    row.dataset.seq = String(line.seq)
    const inLog = tag === 'li'
    const content = inLog ? row : document.createElement('div')
    if (!inLog) {
      content.className = 'chat-bubble-content'
      row.append(content)
    }
    if (line.system) { content.textContent = line.text; return row }
    // In the log the name opens the mute menu; over the game (the strip) it is plain text, as
    // the strip takes no touches.
    const name = document.createElement(inLog ? 'button' : 'span')
    if (name instanceof HTMLButtonElement) {
      name.type = 'button'; name.title = line.mine ? '' : `Options for ${line.name}`
      if (line.mine) name.disabled = true
    }
    name.className = 'chat-name'; name.dataset.from = String(line.from); name.dataset.name = line.name
    name.style.color = legibleTint(line.color)
    // A bot's name leads with the bot mark (playerMarks.ts), in the same colour; screen readers hear "Bot".
    name.append(...markedName({ name: line.name, bot: line.bot, color: line.color }, line.mine ? 'You' : line.name))
    content.append(name)
    const text = document.createElement('span'); text.className = 'chat-text'; text.textContent = line.text
    const time = document.createElement('time'); time.className = 'chat-time'; time.dateTime = new Date(line.wall).toISOString(); time.textContent = timeOf(line.wall)
    content.append(text, time)
    row.title = timeOf(line.wall)
    return row
  }

  private onLogClick(e: MouseEvent): void {
    const target = e.target as HTMLElement
    const name = target.closest<HTMLButtonElement>('.chat-name')
    if (name && !name.disabled) { this.showMenu(Number(name.dataset.from), name, name.dataset.name ?? ''); return }
    // A tap on a line shows its time (hover does on a desktop).
    target.closest('.chat-line')?.classList.toggle('show-time')
  }

  /** Mute or unmute one player's lines, on this screen only, for this visit. */
  private showMenu(id: number, anchor: HTMLElement, label: string): void {
    const muted = this.options.channel.muted.has(id)
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem')
    item.textContent = muted ? `Unmute ${label}` : `Mute ${label}`
    item.addEventListener('click', () => { this.options.channel.mute(id, !muted); this.menu.hidden = true })
    this.menu.replaceChildren(item)
    const box = anchor.getBoundingClientRect()
    this.menu.style.left = `${Math.max(4, Math.min(innerWidth - 180, box.left))}px`
    this.menu.style.top = `${box.bottom + 4}px`
    this.menu.hidden = false
    item.focus()
  }

  private syncStatus(): void {
    const can = this.options.channel.canSend()
    this.status.hidden = can.ok
    this.status.textContent = can.ok ? '' : can.why
    this.field.disabled = !can.ok
    this.form.querySelector('button')!.disabled = !can.ok
  }

  private syncHand(): void {
    this.strip.classList.toggle('is-left-hand', Boolean(leftHanded.value))
  }
}

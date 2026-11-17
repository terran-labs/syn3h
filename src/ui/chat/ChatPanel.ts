/**
 * The chat panel: a pill with an unread count, a strip of the newest lines that fades, and
 * a log with a text field that opens on Y (T is gear, Enter fires) or a tap.
 *
 * Everything a player wrote is drawn with textContent, never as markup, and links are left
 * as plain text. Colour means identity in this game, so each name is drawn in its vehicle's
 * tint, lifted where a dark tint would vanish on the glass. Bots carry a small "bot" mark.
 *
 * While the field has focus `input.typing` is set, which stops every driving key, the stick
 * and the gamepad (src/core/Input.ts). It is cleared on blur, however focus leaves.
 */
import { CHAT_SPEAK_EVENT, type ChatChannel, type ChatLine } from '../../net/chat'
import { chatHideBots, chatOn, chatShow, MAX_CHAT_LENGTH } from '../../../shared/chat'
import { params } from '../../../shared/params'
import { touchLeftHanded as leftHanded } from '../TouchPreferences'
import './chat.css'

export interface ChatPanelOptions {
  channel: ChatChannel
  input: { typing: boolean }
  /** True while driving: the key opens the panel only then. */
  canOpen(): boolean
  /** Everyone in the room except this player, for the mute list. */
  roster(): { id: number; name: string; color: string; bot: boolean }[]
}

/** Newest lines shown in the collapsed strip. */
const STRIP_LINES = 3
/** A line stays in the strip this long, ms, then fades. */
const STRIP_MS = 8000
/** A speaker's vehicle label stays lit this long, ms. */
const SPEAKING_MS = 3500
/** Key that opens chat. T cycles gear and Enter fires, so Y, the usual "say" key. */
export const CHAT_KEY = 'KeyY'

/** Make a tint readable on dark glass: keep its hue, raise its lightness if needed. */
export function legibleTint(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const n = parseInt(m[1], 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (lum >= 0.45) return color
  // Mix towards white until bright enough: plain sRGB is fine for a name label.
  const t = Math.min(0.8, (0.45 - lum) / (1 - lum) + 0.12)
  r = Math.round(r + (255 - r) * t); g = Math.round(g + (255 - g) * t); b = Math.round(b + (255 - b) * t)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

const timeOf = (wall: number) => new Date(wall).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export class ChatPanel {
  readonly element = document.createElement('section')
  private readonly toggle: HTMLButtonElement
  private readonly badge: HTMLElement
  private readonly strip: HTMLElement
  private readonly sheet: HTMLElement
  private readonly log: HTMLOListElement
  private readonly field: HTMLInputElement
  private readonly form: HTMLFormElement
  private readonly people: HTMLElement
  private readonly status: HTMLElement
  private readonly live: HTMLElement
  private readonly menu: HTMLElement
  private open = false
  /** The cursor was captured when chat opened: it stays captured while typing. */
  private lockedAtOpen = false
  private unread = 0
  private unreadPerson: ChatLine | null = null
  private readonly unsubscribe: (() => void)[] = []
  private readonly abort = new AbortController()
  private stripTimer: ReturnType<typeof setInterval> | undefined

  constructor(container: HTMLElement, private readonly options: ChatPanelOptions) {
    const el = this.element
    el.className = 'chat-panel'
    el.setAttribute('aria-label', 'Chat')
    el.innerHTML = `
      <div class="chat-strip" aria-hidden="true"></div>
      <div class="chat-sheet" hidden>
        <div class="chat-head"><h2>Chat</h2><button type="button" class="chat-people-toggle" aria-expanded="false">People</button><button type="button" class="chat-close" aria-label="Close chat">Close</button></div>
        <ol class="chat-log" tabindex="0" aria-label="Chat messages"></ol>
        <div class="chat-people" hidden><p class="chat-people-note">Muted players are hidden on your screen only, for this visit.</p><ul></ul></div>
        <p class="chat-status" hidden></p>
        <form class="chat-form" autocomplete="off">
          <input class="chat-field" type="text" enterkeyhint="send" autocomplete="off" autocorrect="on" spellcheck="true" aria-label="Message" placeholder="Say something nice" maxlength="${MAX_CHAT_LENGTH}">
          <button type="submit" class="chat-send">Send</button>
        </form>
      </div>
      <button type="button" class="chat-toggle" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H10l-4.5 3.5V15.5H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="chat-toggle-text">Chat</span><kbd>Y</kbd><span class="chat-unread" hidden></span></button>
      <div class="chat-menu" role="menu" hidden></div>
      <div class="chat-live" aria-live="polite" aria-atomic="false"></div>`
    const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!
    this.toggle = q('.chat-toggle'); this.badge = q('.chat-unread'); this.strip = q('.chat-strip'); this.sheet = q('.chat-sheet')
    this.log = q<HTMLOListElement>('.chat-log'); this.field = q<HTMLInputElement>('.chat-field'); this.form = q<HTMLFormElement>('.chat-form')
    this.people = q('.chat-people'); this.status = q('.chat-status'); this.live = q('.chat-live'); this.menu = q('.chat-menu')
    container.append(el)

    const signal = this.abort.signal
    this.toggle.addEventListener('click', () => this.setOpen(!this.open, true), { signal })
    q('.chat-close').addEventListener('click', () => this.setOpen(false), { signal })
    q('.chat-people-toggle').addEventListener('click', (e) => this.togglePeople(e.currentTarget as HTMLButtonElement), { signal })
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit() }, { signal })
    this.field.addEventListener('focus', () => { options.input.typing = true }, { signal })
    this.field.addEventListener('blur', () => { options.input.typing = false }, { signal })
    this.field.addEventListener('keydown', (e) => {
      // Keys typed here are the message's, not the game's.
      e.stopPropagation()
      // In the field every key is the message's, Y included: Enter on an empty field, Escape
      // or Close leave it. Y closes chat only while the field does not have focus (onKey).
      if (e.key === 'Escape') { e.preventDefault(); this.setOpen(false) }
    }, { signal })
    // Chat keeps a captured cursor captured (typing needs no pointer). If the browser takes the
    // lock away while chat is open (it does on Escape), chat closes too, so the player is back
    // to the ordinary uncaptured state rather than in a chat field they did not ask for.
    document.addEventListener('pointerlockchange', () => { if (this.open && this.lockedAtOpen && !document.pointerLockElement) this.setOpen(false) }, { signal })
    this.log.addEventListener('scroll', () => { if (this.atBottom()) this.clearUnread() }, { signal, passive: true })
    this.log.addEventListener('click', (e) => this.onLogClick(e), { signal })
    window.addEventListener('keydown', (e) => this.onKey(e), { signal, capture: true })
    // The speaker's vehicle label (src/ui/nameplates) lights up for a moment with a speech mark.
    window.addEventListener(CHAT_SPEAK_EVENT, (e) => this.markSpeaker((e as CustomEvent<{ id: number }>).detail.id), { signal })
    window.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.menu.hidden = true }, { signal })

    const { channel } = options
    this.unsubscribe.push(channel.onShow((line) => this.onLine(line)))
    this.unsubscribe.push(channel.onChange(() => this.redraw()))
    this.unsubscribe.push(params.onChange((id) => {
      if (id === chatShow.def.id || id === chatHideBots.def.id || id === chatOn.def.id) this.redraw()
      if (id === leftHanded.def.id) this.syncHand()
    }))
    this.stripTimer = setInterval(() => this.fadeStrip(), 1000)
    this.syncHand()
    this.redraw()
  }

  get isOpen(): boolean { return this.open }
  get unreadCount(): number { return this.unread }

  /** Open or close. Opening on a key or a tap puts the cursor in the field. */
  setOpen(open: boolean, focus = open): void {
    if (open && !chatShow.value) return
    this.open = open
    this.menu.hidden = true
    this.element.classList.toggle('is-open', open)
    this.toggle.setAttribute('aria-expanded', String(open))
    this.sheet.hidden = !open
    this.renderStrip()
    this.followKeyboard(open)
    if (open) {
      this.lockedAtOpen = Boolean(document.pointerLockElement)
      this.renderLog()
      this.log.scrollTop = this.log.scrollHeight
      this.clearUnread()
      this.syncStatus()
      if (focus) this.field.focus({ preventScroll: true })
    } else {
      if (document.activeElement === this.field) this.field.blur()
      this.options.input.typing = false
    }
  }

  /**
   * While open, keep the sheet's bottom on top of the on-screen keyboard: the layout viewport
   * does not shrink for it on every phone, the visual viewport does. Closing removes the
   * offset, so the layout returns exactly to what it was.
   */
  private followKeyboard(on: boolean): void {
    const vv = window.visualViewport
    this.keyboardOff?.()
    this.keyboardOff = undefined
    this.element.style.removeProperty('--chat-kb')
    if (!on || !vv) return
    const sync = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      if (covered > 0) this.element.style.setProperty('--chat-kb', `${covered}px`)
      else this.element.style.removeProperty('--chat-kb')
    }
    vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync)
    this.keyboardOff = () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync) }
    sync()
  }
  private keyboardOff?: () => void

  dispose(): void {
    for (const t of this.speaking.values()) clearTimeout(t)
    this.keyboardOff?.()
    this.abort.abort()
    for (const u of this.unsubscribe) u()
    clearInterval(this.stripTimer)
    this.options.input.typing = false
    this.element.remove()
  }

  private readonly speaking = new Map<number, ReturnType<typeof setTimeout>>()
  private markSpeaker(id: number): void {
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
    if (!chatShow.value) return
    // Open with the field not focused (typing goes to the field, so this is not a letter):
    // Y closes it again.
    if (this.open) { e.preventDefault(); e.stopImmediatePropagation(); this.setOpen(false); return }
    if (!this.options.canOpen()) return
    e.preventDefault(); e.stopImmediatePropagation()
    this.setOpen(true)
  }

  private submit(): void {
    const text = this.field.value
    if (!text.trim()) { this.field.blur(); this.setOpen(false); return }
    if (this.options.channel.send(text)) this.field.value = ''
    this.syncStatus()
  }

  private onLine(line: ChatLine): void {
    if (line.system || !line.bot) this.announce(line)
    if (this.open) {
      const stick = this.atBottom()
      this.log.append(this.lineElement(line, true))
      while (this.log.children.length > 120) this.log.firstElementChild!.remove()
      if (stick || line.mine) this.log.scrollTop = this.log.scrollHeight
      else this.addUnread(line)
    } else {
      if (!line.mine && !line.system) this.addUnread(line)
      this.renderStrip()
    }
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
    this.syncBadge(this.unread === 1)
  }

  private clearUnread(): void {
    if (!this.unread) return
    this.unread = 0; this.unreadPerson = null
    this.syncBadge(false)
  }

  private syncBadge(pulse: boolean): void {
    const b = this.badge
    b.hidden = this.unread === 0
    b.textContent = this.unread > 9 ? '9+' : String(this.unread)
    const who = this.unreadPerson ? `, including one from ${this.unreadPerson.name}` : ''
    b.setAttribute('aria-label', `${this.unread} unread message${this.unread === 1 ? '' : 's'}${who}`)
    this.toggle.setAttribute('aria-label', this.unread ? `Chat, ${this.unread} unread` : 'Chat')
    b.classList.toggle('from-person', !!this.unreadPerson)
    b.style.setProperty('--chat-person', this.unreadPerson ? legibleTint(this.unreadPerson.color) : '')
    if (pulse) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse') }
  }

  private atBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24
  }

  private redraw(): void {
    this.element.hidden = !chatShow.value
    if (!chatShow.value && this.open) this.setOpen(false)
    // Lines now hidden (a mute, bots hidden) stop counting as unread.
    const shown = new Set(this.options.channel.visible().map((l) => l.seq))
    if (this.unreadPerson && !shown.has(this.unreadPerson.seq)) this.unreadPerson = null
    if (this.unread) this.unread = Math.min(this.unread, this.options.channel.visible().filter((l) => !l.mine && !l.system).length)
    this.syncBadge(false)
    this.renderStrip()
    if (this.open) { this.renderLog(); this.syncStatus() }
    if (!this.people.hidden) this.renderPeople()
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
    if (this.open) { this.strip.replaceChildren(); return }
    const now = performance.now()
    const recent = this.options.channel.visible().filter((l) => now - l.at < STRIP_MS).slice(-STRIP_LINES)
    const keep = new Set(recent.map((l) => String(l.seq)))
    for (const child of [...this.strip.children] as HTMLElement[]) if (!keep.has(child.dataset.seq!)) child.remove()
    for (const l of recent) if (!this.strip.querySelector(`[data-seq="${l.seq}"]`)) this.strip.append(this.lineElement(l, true, 'div'))
  }

  private fadeStrip(): void {
    if (this.open || !this.strip.children.length) { this.strip.classList.remove('is-yielding'); return }
    // Step back when a vehicle's name label or a readout passes behind the strip.
    const box = this.strip.getBoundingClientRect()
    const under = [...document.querySelectorAll<HTMLElement>('.syn3h-nametags > *, .fh-read')].some((el) => {
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
    if (line.system) { row.textContent = line.text; return row }
    const name = document.createElement('button')
    name.type = 'button'; name.className = 'chat-name'; name.dataset.from = String(line.from)
    name.textContent = line.mine ? 'You' : line.name
    name.style.color = legibleTint(line.color)
    name.title = line.mine ? '' : `Options for ${line.name}`
    if (line.mine) name.disabled = true
    row.append(name)
    if (line.bot) { const mark = document.createElement('span'); mark.className = 'chat-bot'; mark.textContent = 'bot'; mark.setAttribute('aria-label', '(bot)'); row.append(mark) }
    const text = document.createElement('span'); text.className = 'chat-text'; text.textContent = line.text
    const time = document.createElement('time'); time.className = 'chat-time'; time.dateTime = new Date(line.wall).toISOString(); time.textContent = timeOf(line.wall)
    row.append(text, time)
    row.title = timeOf(line.wall)
    return row
  }

  private onLogClick(e: MouseEvent): void {
    const target = e.target as HTMLElement
    const name = target.closest<HTMLButtonElement>('.chat-name')
    if (name && !name.disabled) { this.showMenu(Number(name.dataset.from), name); return }
    // A tap on a line shows its time (hover does on a desktop).
    target.closest('.chat-line')?.classList.toggle('show-time')
  }

  private showMenu(id: number, anchor: HTMLElement): void {
    const muted = this.options.channel.muted.has(id)
    const label = anchor.textContent ?? ''
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem')
    item.textContent = muted ? `Unmute ${label}` : `Mute ${label}`
    item.addEventListener('click', () => { this.options.channel.mute(id, !muted); this.menu.hidden = true })
    this.menu.replaceChildren(item)
    const box = anchor.getBoundingClientRect(), host = this.element.getBoundingClientRect()
    this.menu.style.left = `${Math.max(0, box.left - host.left)}px`
    this.menu.style.top = `${box.bottom - host.top + 4}px`
    this.menu.hidden = false
    item.focus()
  }

  private togglePeople(button: HTMLButtonElement): void {
    const show = this.people.hidden
    this.people.hidden = !show
    button.setAttribute('aria-expanded', String(show))
    if (show) this.renderPeople()
  }

  private renderPeople(): void {
    const list = this.people.querySelector('ul')!
    const rows = this.options.roster().map((p) => {
      const li = document.createElement('li')
      const name = document.createElement('span'); name.className = 'chat-name'; name.textContent = p.name; name.style.color = legibleTint(p.color)
      li.append(name)
      if (p.bot) { const mark = document.createElement('span'); mark.className = 'chat-bot'; mark.textContent = 'bot'; li.append(mark) }
      const muted = this.options.channel.muted.has(p.id)
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chat-mute'; b.setAttribute('aria-pressed', String(muted))
      b.textContent = muted ? 'Muted' : 'Mute'; b.setAttribute('aria-label', `${muted ? 'Unmute' : 'Mute'} ${p.name}`)
      b.addEventListener('click', () => this.options.channel.mute(p.id, !muted))
      li.append(b)
      return li
    })
    if (!rows.length) { const li = document.createElement('li'); li.textContent = 'Nobody else is here yet.'; rows.push(li) }
    list.replaceChildren(...rows)
  }

  private syncStatus(): void {
    const can = this.options.channel.canSend()
    this.status.hidden = can.ok
    this.status.textContent = can.ok ? '' : can.why
    this.field.disabled = !can.ok
    this.form.querySelector('button')!.disabled = !can.ok
  }

  private syncHand(): void {
    this.element.classList.toggle('is-left-hand', Boolean(leftHanded.value))
  }
}

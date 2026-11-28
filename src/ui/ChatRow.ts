/**
 * The left column's Chat row (hud-column.css): the same row form as the accessories above it,
 * its node on the spine, its key cap (Y, shown only with the cursor free) and its name. It
 * opens chat and shows the unread count through chatLink alone, so it never touches the chat
 * surface's markup (the right panel's Chat card, chat/ChatCard.ts). The node
 * is lit while something is unread and hollow otherwise; the count is bright type just after the name.
 */
import { chatLink } from './chat/chatLink'
import { keycapHtml } from './keycap'
import { chatOn, chatShow } from '../../shared/chat'
import { params } from '../../shared/params'

/** The key that opens chat (ChatCard's CHAT_KEY). */
const CHAT_KEY = 'Y'
const TITLE = 'Talk with everyone in this world. Opens Chat; Y does the same.'

export class ChatRow {
  readonly element = document.createElement('div')
  private readonly button = document.createElement('button')
  private readonly count = document.createElement('span')
  private readonly tip = document.createElement('div')
  private tipTimer: ReturnType<typeof setTimeout> | undefined
  private readonly unsubscribe: () => void
  private readonly unsubscribeParams: () => void

  constructor(parent: HTMLElement, signal?: AbortSignal) {
    this.element.className = 'hud-chat'
    this.button.type = 'button'; this.button.className = 'acc-row'; this.button.dataset.id = 'chat'
    this.button.innerHTML = `${keycapHtml(CHAT_KEY)}<span class="acc-name" aria-hidden="true">Chat</span><i class="acc-pip" aria-hidden="true"></i>`
    this.count.className = 'chat-count'; this.count.setAttribute('aria-hidden', 'true'); this.count.hidden = true
    // Just after the word, inside the name's fixed column: the key column never moves.
    this.button.querySelector('.acc-name')!.append(this.count)
    this.element.append(this.button)
    this.tip.className = 'wi-glass wi-tooltip hud-column-tip'; this.tip.setAttribute('role', 'tooltip'); this.tip.hidden = true
    this.tip.innerHTML = '<strong></strong><p></p>'
    this.button.addEventListener('click', () => { chatLink.open(); this.button.blur() }, { signal })
    this.button.addEventListener('pointerenter', () => this.showTip(450), { signal })
    this.button.addEventListener('focus', () => this.showTip(0), { signal })
    for (const type of ['pointerleave', 'blur', 'pointerdown'] as const) this.button.addEventListener(type, () => this.hideTip(), { signal })
    this.unsubscribe = chatLink.subscribe(() => this.sync())
    // Shown only while the room has chat (chat.on, the host's) and this player shows it
    // (chat.show): the row, its count, its node and its share of the line go together.
    this.unsubscribeParams = params.onChange((id) => { if (id === chatOn.def.id || id === chatShow.def.id) this.syncShown() })
    this.syncShown()
    this.sync()
    parent.append(this.element, this.tip)
  }

  private syncShown(): void {
    const shown = chatOn.value && chatShow.value
    this.element.hidden = !shown
    if (!shown) this.hideTip()
  }

  private label(): string {
    const n = chatLink.unread
    return n ? `Chat, ${n} unread` : 'Chat'
  }

  private sync(): void {
    const n = chatLink.unread
    this.count.hidden = n === 0
    this.count.textContent = n > 99 ? '99+' : String(n)
    this.count.classList.toggle('from-person', chatLink.fromPerson)
    this.button.classList.toggle('is-on', n > 0)
    this.button.setAttribute('aria-label', `${this.label()}. Key Y.`)
    if (!this.tip.hidden) this.fillTip()
  }

  private fillTip(): void {
    this.tip.firstElementChild!.textContent = this.label().replace(', ', ' · ')
    this.tip.lastElementChild!.textContent = TITLE
  }

  /** Beside the row, growing upward, like the accessories' tooltips. */
  private showTip(delay: number): void {
    clearTimeout(this.tipTimer)
    this.tipTimer = setTimeout(() => {
      this.fillTip()
      const box = this.button.getBoundingClientRect()
      this.tip.style.left = `${Math.round(box.right + 12)}px`; this.tip.style.top = 'auto'
      this.tip.style.bottom = `${Math.round(innerHeight - box.bottom)}px`
      this.tip.hidden = false
    }, delay)
  }

  private hideTip(): void { clearTimeout(this.tipTimer); this.tip.hidden = true }

  dispose(): void { this.hideTip(); this.unsubscribe(); this.unsubscribeParams(); this.element.remove(); this.tip.remove() }
}

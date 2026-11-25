/**
 * Report a bug: a sheet over the pause screen (the owner, 25 November 2026, for the fans
 * arriving in Discord). The picture is the Screenshot button's own (Shell.captureShot), the
 * report is Copy diagnostics' own, cleaned (reportText.ts). Nothing leaves the page unless the
 * player presses a button, and then only by their own paste or GitHub's Submit.
 *
 * Two steps, because a share sheet uses up the tap that opened it and a browser then refuses
 * to open Discord in the same tap: Save picture first (the share sheet on a touch screen, a
 * download elsewhere), then Post in Discord, which copies the message and opens the invite.
 * On a desktop Post in Discord also saves the picture if it has not been saved yet.
 *
 * Appears by fading only. It is a modal dialog, so the pause screen behind it is inert and
 * nothing on it moves; Escape and the X close it and focus returns to the opener.
 */
import './report-sheet.css'
import { deliverShot, downloadShot, shareShot, shareableShot } from '../screenshot'
import { DISCORD_BUG_CHANNEL, DISCORD_INVITE } from './links'
import { discordMessage, githubIssueUrl, sanitizeReport, type ReportSecrets } from './reportText'
import { reportSheetHtml } from './sheetHtml'

export interface ReportSources {
  /** The Screenshot button's picture of the paused view, encoded, or null if it failed. */
  capture(): Promise<Blob | null>
  /** Copy diagnostics' report, as it would be copied now. */
  report(): string | undefined
  /** What must not appear in the report: the room, names and chat. */
  secrets(): ReportSecrets
  /** The Screenshot button's file name for this world and moment. */
  fileName(): string
  /** A touch screen: share the picture rather than download it. */
  touch(): boolean
  /** Called once the sheet has closed. */
  closed(): void
}

/** "the Mira Discord", or its bug channel once the owner names one (links.ts). */
const where = DISCORD_BUG_CHANNEL ? `#${DISCORD_BUG_CHANNEL} in the Mira Discord` : 'the Mira Discord'

/** Chat lines and names on the page right now (src/ui/chat/ChatCard.ts), for sanitizeReport. */
export function chatOnPage(root: ParentNode = document): Pick<ReportSecrets, 'chat' | 'names'> {
  const texts = (selector: string, read: (el: HTMLElement) => string | undefined) => [...root.querySelectorAll<HTMLElement>(selector)].map(read).filter((t): t is string => !!t)
  return { chat: texts('.chat-text', el => el.textContent ?? undefined), names: texts('.chat-name', el => el.dataset.name) }
}

export class ReportSheet {
  readonly element = document.createElement('dialog')
  private blob: Blob | null = null
  private thumbUrl = ''
  private saved = false
  private report = ''
  private opener?: HTMLElement
  private generation = 0

  constructor(parent: HTMLElement, private readonly sources: ReportSources, signal: AbortSignal) {
    const sheet = this.element
    sheet.className = 'report-sheet'
    sheet.setAttribute('aria-labelledby', 'report-title')
    sheet.innerHTML = reportSheetHtml()
    parent.append(sheet)
    const on = (selector: string, run: () => void) => sheet.querySelector(selector)!.addEventListener('click', run, { signal })
    on('.report-close', () => this.close())
    on('.report-save', () => { void this.savePicture() })
    on('.report-discord', () => this.postInDiscord())
    on('.report-github', () => this.openIssue())
    this.what.addEventListener('input', () => this.render(), { signal })
    // Enter in the field is "done", not a submit: it leaves the text as it is.
    this.what.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); sheet.querySelector<HTMLButtonElement>('.report-discord')!.focus() } }, { signal })
    // The dialog's own Escape (cancel) and any other close go through close().
    sheet.addEventListener('cancel', event => { event.preventDefault(); this.close() }, { signal })
    sheet.addEventListener('close', () => this.close(), { signal })
    signal.addEventListener('abort', () => this.release(), { once: true })
  }

  get isOpen(): boolean { return this.element.open }
  private get what(): HTMLInputElement { return this.element.querySelector('.report-what')! }
  private get text(): HTMLTextAreaElement { return this.element.querySelector('.report-text')! }
  private say(text: string): void { this.element.querySelector('.report-status')!.textContent = text }

  /** Open over the pause screen, capturing the view as it is now. */
  async open(): Promise<void> {
    if (this.isOpen) return
    const generation = ++this.generation
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    this.release(); this.saved = false; this.what.value = ''; this.say('')
    this.report = sanitizeReport(this.sources.report() ?? 'Diagnostics were not ready.', this.sources.secrets())
    const touch = this.sources.touch()
    this.element.querySelector('.report-how')!.textContent = touch
      ? `Save the picture, then Post in Discord copies the message and opens ${where}: paste it there and attach the picture.`
      : `Post in Discord copies the message, saves the picture and opens ${where}: paste it there and attach the picture. On GitHub, drag the picture into the issue.`
    this.element.classList.add('is-capturing')
    this.render()
    this.element.showModal()
    this.element.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true })
    const blob = await this.sources.capture()
    if (generation !== this.generation || !this.isOpen) return
    this.element.classList.remove('is-capturing')
    if (!blob) { this.say('The view could not be captured. The message can still be posted.'); return }
    this.blob = blob
    this.thumbUrl = URL.createObjectURL(blob)
    this.element.querySelector<HTMLImageElement>('.report-thumb')!.src = this.thumbUrl
  }

  close(): void {
    if (!this.element.open && !this.opener) return
    this.generation++
    if (this.element.open) this.element.close()
    this.release()
    const opener = this.opener; this.opener = undefined
    this.sources.closed()
    if (opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus({ preventScroll: true })
  }

  private release(): void {
    if (this.thumbUrl) URL.revokeObjectURL(this.thumbUrl)
    this.thumbUrl = ''; this.blob = null
    this.element.querySelector<HTMLImageElement>('.report-thumb')?.removeAttribute('src')
  }

  private input() { return { sentence: this.what.value, report: this.report } }
  private render(): void { this.text.value = discordMessage(this.input()) }

  /** The share sheet on a touch screen (the Screenshot button's deliverShot), a download elsewhere. */
  private async savePicture(): Promise<void> {
    if (!this.blob) { this.say('There is no picture to save.'); return }
    const name = this.sources.fileName()
    const ready = this.sources.touch() ? shareableShot(this.blob, name) : null
    const { outcome } = ready ? { outcome: await shareShot(ready) } : await deliverShot(this.blob, name, false)
    if (outcome === 'shared' || outcome === 'saved') { this.saved = true; this.say(outcome === 'shared' ? 'Picture shared.' : 'Picture saved.') }
    else if (outcome === 'blocked') this.say('Tap Save picture again to share it.')
  }

  /** Copy the message, save the picture on a desktop, open the invite: all inside this one press. */
  private postInDiscord(): void {
    const message = discordMessage(this.input())
    this.text.value = message
    const copied = navigator.clipboard?.writeText(message) ?? Promise.reject(new Error('No clipboard'))
    if (!this.sources.touch() && this.blob && !this.saved) { downloadShot(this.blob, this.sources.fileName()); this.saved = true }
    window.open(DISCORD_INVITE, '_blank', 'noopener,noreferrer')
    copied.then(
      () => this.say(`Message copied. Paste it in ${where}${this.blob ? ' and attach the picture' : ''}.`),
      () => { this.text.focus(); this.text.select(); this.say('Copy the message above, then paste it in Discord.') })
  }

  /** A new GitHub issue with the title and body filled in; the picture is dragged in by hand. */
  private openIssue(): void {
    if (!this.sources.touch() && this.blob && !this.saved) { downloadShot(this.blob, this.sources.fileName()); this.saved = true }
    window.open(githubIssueUrl(this.input()), '_blank', 'noopener,noreferrer')
    this.say(this.blob ? 'Drag the saved picture into the issue, then Submit.' : 'Check the issue, then Submit.')
  }
}

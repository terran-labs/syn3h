/**
 * About's content, shared by the lobby sheets and the in-play guide so they cannot drift. The
 * in-play guide shows it as two tabs, About (the story and credits) and Updates (recent
 * releases and their notes); the lobby gives each its own sheet (LobbySheet.ts), without tabs.
 * Updates fetches the release feed the first time it is opened.
 */
import { creditsHtml } from '../data/credits'
import { loadFeed, pinnedVersion, runningVersion, type Release } from './feed'
import { renderMarkdown, safeHref } from './markdown'
import { isNewer } from './version'
import './updates.css'

let uid = 0
/** The HTML for one About: tabs, the About pane and an empty Updates pane. */
export function aboutHtml(): string {
  const id = `about-${++uid}`
  return `<div class="about-tabs" role="tablist" aria-label="Welcome">
      <button type="button" role="tab" id="${id}-tab-about" aria-controls="${id}-about" aria-selected="true" data-about-tab="about">Welcome</button>
      <button type="button" role="tab" id="${id}-tab-updates" aria-controls="${id}-updates" aria-selected="false" tabindex="-1" data-about-tab="updates">Updates</button>
    </div>
    <div class="about-pane" role="tabpanel" id="${id}-about" aria-labelledby="${id}-tab-about" data-about-pane="about">${creditsHtml}</div>
    <div class="about-pane" role="tabpanel" id="${id}-updates" aria-labelledby="${id}-tab-updates" data-about-pane="updates" hidden><div class="about-updates" aria-live="polite"></div></div>`
}

/** The lobby's About sheet body: the story and credits, no tabs. */
export const aboutSheetHtml = (): string => `<div class="about-pane">${creditsHtml}</div>`
/** The lobby's Updates sheet body: the release list, filled by fillUpdates when it opens. */
export const updatesSheetHtml = (): string => '<div class="about-updates" aria-live="polite"></div>'

export type AboutTab = 'about' | 'updates'

/** Wire the tabs inside `root`. Arrow keys move between tabs, as a tab list should. */
export function wireAbout(root: HTMLElement, signal: AbortSignal): void {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-about-tab]')]
  for (const tab of tabs) {
    tab.addEventListener('click', () => showAboutTab(root, tab.dataset.aboutTab as AboutTab), { signal })
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      showAboutTab(root, next.dataset.aboutTab as AboutTab); next.focus()
    }, { signal })
  }
}

export function showAboutTab(root: HTMLElement, tab: AboutTab): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-about-tab]')) {
    const on = button.dataset.aboutTab === tab
    button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1
  }
  for (const pane of root.querySelectorAll<HTMLElement>('[data-about-pane]')) pane.hidden = pane.dataset.aboutPane !== tab
  if (tab === 'updates') void fillUpdates(root.querySelector<HTMLElement>('.about-updates')!)
}

const text = (tag: string, value: string, className?: string) => {
  const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el
}

/** "2026-11-16 04:18 PST" to "16 November 2026, 4:18am". The feed's own text if it does not parse. */
export function displayDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(value)
  if (!m) return value
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const day = `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ''} ${m[1]}`
  if (m[4] === undefined) return day
  const hour = Number(m[4]), h12 = hour % 12 || 12
  return `${day}, ${h12}:${m[5]}${hour < 12 ? 'am' : 'pm'}`
}

/** The release list. Safe to call again: it renders once and keeps what it rendered. */
export async function fillUpdates(host: HTMLElement): Promise<void> {
  if (host.dataset.state === 'ready' || host.dataset.state === 'loading') return
  host.dataset.state = 'loading'
  host.replaceChildren(text('p', 'Loading recent updates…', 'updates-status'))
  let releases: Release[]
  try { releases = await loadFeed() } catch {
    host.dataset.state = 'failed'
    const retry = text('button', 'Try again', 'updates-retry') as HTMLButtonElement
    retry.type = 'button'
    retry.addEventListener('click', () => { void fillUpdates(host) }, { once: true })
    host.replaceChildren(text('p', 'Updates could not be loaded just now. Check your connection and try again.', 'updates-status'), retry)
    return
  }
  host.dataset.state = 'ready'
  const running = runningVersion(), pinned = pinnedVersion()
  const nodes: Node[] = []
  if (pinned) {
    const note = text('p', `You are playing pinned version v${pinned}, kept exactly as it was released. `, 'updates-pinned')
    const latest = document.createElement('a'); latest.href = '/'; latest.textContent = 'Play the latest version'
    note.append(latest); nodes.push(note)
  } else if (running && releases.some(r => isNewer(r.version, running))) {
    const note = text('p', 'A newer version is out. ', 'updates-pinned')
    const reload = text('button', 'Reload to update', 'updates-reload') as HTMLButtonElement
    reload.type = 'button'; reload.addEventListener('click', () => location.reload())
    note.append(reload); nodes.push(note)
  }
  if (!releases.length) nodes.push(text('p', 'No release notes yet.', 'updates-status'))
  const list = document.createElement('ol'); list.className = 'updates-list'
  releases.forEach((release, index) => {
    const item = document.createElement('li'), details = document.createElement('details'), summary = document.createElement('summary')
    details.className = 'update-release'; details.dataset.version = release.version
    const head = document.createElement('span'); head.className = 'update-head'
    head.append(text('strong', `v${release.version}`, 'update-version'))
    if (running && release.version === running) head.append(text('span', 'You are playing this', 'update-badge is-running'))
    else if (running && isNewer(release.version, running)) head.append(text('span', 'New', 'update-badge is-new'))
    head.append(text('span', displayDate(release.date), 'update-date'))
    summary.append(head)
    if (release.summary) summary.append(text('span', release.summary, 'update-summary'))
    details.append(summary)
    // What players will notice (the digest), then the published notes on GitHub. Built on
    // first open; the newest release starts open.
    const body = document.createElement('div'); body.className = 'update-notes'
    const fill = () => {
      if (body.childElementCount) return
      if (release.digest) body.append(renderMarkdown(release.digest))
      const href = safeHref(release.url ?? '')
      if (href) {
        const link = document.createElement('a'); link.className = 'update-full'; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'
        link.textContent = 'Full release notes'; link.setAttribute('aria-label', `Full release notes for v${release.version}, on GitHub`)
        body.append(link)
      }
    }
    details.addEventListener('toggle', () => { if (details.open) fill() })
    details.append(body)
    if (index === 0) { details.open = true; fill() }
    item.append(details); list.append(item)
  })
  nodes.push(list)
  host.replaceChildren(...nodes)
}

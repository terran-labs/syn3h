/**
 * The in-play guide's two views, Welcome (the guide, src/ui/welcome/welcome.ts, mounted into the
 * About pane by Shell.ts) and Updates (recent releases and their notes), one at a time. The lobby
 * gives each its own sheet (LobbySheet.ts).
 * Updates fetches the release feed the first time it is opened.
 */
import { ACCORDION_ARROW } from '../accordionArrow'
import { DayPager, planUpdates, RELEASES_URL, type DayEntry, type ReleaseEntry } from './days'
import { loadFeedInfo, loadOlder, pinnedVersion, runningVersion, type Release } from './feed'
import { renderMarkdown } from './markdown'
import { isNewer } from './version'
import './updates.css'

let uid = 0
/**
 * The HTML for the in-play guide's two views, Welcome and Updates, one shown at a time. No tabs
 * (the owner, 25 November 2026: "Eliminate the Welcome and Updates tabs"): the Welcome button
 * opens Welcome, and the update banner opens Updates (Shell.openAbout).
 */
export function aboutHtml(): string {
  return `<div class="about-pane" data-about-pane="about"></div>
    <div class="about-pane" data-about-pane="updates" hidden><h2 class="about-updates-title">Updates</h2>${githubReleasesHtml()}<div class="about-updates" aria-live="polite"></div></div>`
}

/** The lobby's Updates sheet body: the release list, filled by fillUpdates when it opens. */
export const updatesSheetHtml = (): string => `${githubReleasesHtml()}<div class="about-updates" aria-live="polite"></div>`

export type AboutTab = 'about' | 'updates'

/** Show one of the guide's two views inside `root`. Updates fetches the release feed the first time. */
export function showAboutTab(root: HTMLElement, tab: AboutTab): void {
  for (const pane of root.querySelectorAll<HTMLElement>('[data-about-pane]')) pane.hidden = pane.dataset.aboutPane !== tab
  if (tab === 'updates') void fillUpdates(root.querySelector<HTMLElement>('.about-updates')!)
}

const text = (tag: string, value: string, className?: string) => {
  const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el
}

/**
 * GitHub's mark (Invertocat), one path, drawn in the text's own ink by the stylesheet.
 * Copied from ui/lobby-community-links (src/ui/communityLinks.ts, GITHUB_ICON), which is not on
 * main yet: when both have landed, this merges into that module and is imported from there.
 * https://brand.github.com/foundations/logo. GitHub's mark is a trademark of GitHub, Inc.
 */
const GITHUB_ICON = '<svg class="github-mark" viewBox="0 0 98 96" aria-hidden="true" focusable="false"><path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"/></svg>'

/** The link to every release on GitHub, for anyone who wants the whole record. */
export const githubReleasesHtml = (): string =>
  `<a class="updates-github" href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer" aria-label="All Mira releases on GitHub">${GITHUB_ICON}<span class="updates-github-text">All releases</span></a>`

/**
 * A link to GitHub drawn as GitHub's mark alone, never the word (the owner, 26 November 2026:
 * "always use a GitHub icon instead of the text GitHub"); `label` is its accessible name.
 */
const githubLink = (href: string, label: string, className: string) => {
  const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'
  a.className = `github-link ${className}`; a.setAttribute('aria-label', label); a.dataset.tip = label
  a.innerHTML = GITHUB_ICON; return a
}

/** A button in the house glass (glass.css .liquid-glass), as the lobby's own buttons are. */
const houseButton = (label: string, className: string) => {
  const b = text('button', label, `${className} liquid-glass`) as HTMLButtonElement; b.type = 'button'; return b
}

/**
 * A disclosure: a real button with aria-expanded and the region it controls. The region folds
 * by reflowing its height and fading (updates.css .update-fold), never sliding, and at once
 * under reduced motion. `fill` builds the contents on first open, so a closed day costs nothing.
 */
function disclosure(button: HTMLButtonElement, open: boolean, fill: (into: HTMLElement) => void): HTMLElement {
  const fold = document.createElement('div'); fold.className = 'update-fold'; fold.id = `update-fold-${++uid}`
  const inner = document.createElement('div'); inner.className = 'update-fold-inner'; fold.append(inner)
  button.type = 'button'; button.setAttribute('aria-controls', fold.id)
  let filled = false
  const set = (on: boolean) => {
    if (on && !filled) { filled = true; fill(inner) }
    button.setAttribute('aria-expanded', String(on))
  }
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'))
  set(open)
  return fold
}

/** One release row: version, time and headline; it opens to its bullets, betas, changes and GitHub link. */
function releaseRow(r: ReleaseEntry): HTMLLIElement {
  const item = document.createElement('li')
  item.className = `update-release${r.beta ? ' is-beta' : ''}`; item.dataset.version = r.release.version
  const button = document.createElement('button'); button.className = 'update-release-toggle'
  const line = document.createElement('span'); line.className = 'update-release-line'
  line.insertAdjacentHTML('beforeend', ACCORDION_ARROW)
  line.append(text('span', `v${r.release.version}`, 'update-version'))
  if (r.beta) line.append(text('span', 'Beta', 'update-badge is-beta'))
  if (r.playing) line.append(text('span', 'Playing', 'update-badge is-running'))
  // A beta inside a release was superseded by it: calling it New would be noise.
  else if (r.isNew && !r.beta) line.append(text('span', 'New', 'update-badge is-new'))
  if (r.time) line.append(text('span', r.time, 'update-time'))
  button.append(line)
  if (r.release.summary) button.append(text('span', r.release.summary, 'update-summary'))
  const fold = disclosure(button, r.open, inner => {
    const notes = document.createElement('div'); notes.className = 'update-notes'
    if (r.release.digest) notes.append(renderMarkdown(r.release.digest))
    if (r.changes.length) {
      notes.append(text('h4', 'Changes'))
      const list = document.createElement('ul'); list.className = 'update-changes'
      // Each change is plain text with one GitHub mark at the right edge, in a column.
      for (const c of r.changes) {
        const li = document.createElement('li'); li.append(text('span', c.title, 'update-change-title'))
        if (c.href) li.append(githubLink(c.href, 'View this change on GitHub', 'update-change-link'))
        list.append(li)
      }
      notes.append(list)
    }
    if (r.betas.length) {
      notes.append(text('h4', r.betas.length === 1 ? 'The beta before it' : `The ${r.betas.length} betas before it`))
      const list = document.createElement('ol'); list.className = 'update-releases update-betas'
      for (const b of r.betas) list.append(releaseRow(b))
      notes.append(list)
    }
    const full = document.createElement('p'); full.className = 'update-full-row'
    full.append(githubLink(r.href, `${r.beta ? 'Beta notes' : 'Release notes'} for v${r.release.version}, on GitHub`, 'update-full'))
    notes.append(full)
    inner.append(notes)
  })
  item.append(button, fold)
  return item
}

/** One day: its date in the display face, a line of headlines and a count; it opens to its releases. */
function dayEntry(day: DayEntry): HTMLLIElement {
  const item = document.createElement('li'); item.className = 'update-day'; item.dataset.day = day.key
  if (day.playing) item.classList.add('is-playing')
  const heading = document.createElement('h3'); heading.className = 'update-day-heading'
  const button = document.createElement('button'); button.className = 'update-day-toggle'
  const line = document.createElement('span'); line.className = 'update-day-line'
  line.append(text('span', day.label, 'update-day-date'))
  if (day.playing) line.append(text('span', 'You are playing this', 'update-badge is-running'))
  else if (day.isNew) line.append(text('span', 'New', 'update-badge is-new'))
  // The count and the arrow wrap together, so the arrow is never left on a line of its own.
  const meta = text('span', day.count, 'update-day-count')
  meta.insertAdjacentHTML('beforeend', ACCORDION_ARROW)
  line.append(meta)
  button.append(line)
  if (day.summary) button.append(text('span', day.summary, 'update-day-summary'))
  heading.append(button)
  const fold = disclosure(button, day.expanded, inner => {
    const list = document.createElement('ol'); list.className = 'update-releases'
    for (const r of day.releases) list.append(releaseRow(r))
    inner.append(list)
  })
  item.append(heading, fold)
  return item
}

/** The release list. Safe to call again: it renders once and keeps what it rendered. */
export async function fillUpdates(host: HTMLElement): Promise<void> {
  if (host.dataset.state === 'ready' || host.dataset.state === 'loading') return
  host.dataset.state = 'loading'
  host.replaceChildren(text('p', 'Loading recent updates…', 'updates-status'))
  let releases: Release[], older: string | null
  try { ({ releases, older } = await loadFeedInfo()) } catch {
    host.dataset.state = 'failed'
    const retry = houseButton('Try again', 'updates-retry')
    retry.addEventListener('click', () => { void fillUpdates(host) }, { once: true })
    host.replaceChildren(text('p', 'Updates could not be loaded just now. Check your connection and try again.', 'updates-status'), retry)
    return
  }
  host.dataset.state = 'ready'
  const running = runningVersion(), pinned = pinnedVersion()
  const nodes: Node[] = []
  // Root-relative on purpose: on beta.mira.cc "the latest" is the newest beta, never production.
  if (pinned) {
    const note = text('p', `You are playing pinned version v${pinned}, kept exactly as it was released. `, 'updates-pinned')
    const latest = document.createElement('a'); latest.href = '/'; latest.textContent = 'Play the latest version'
    note.append(latest); nodes.push(note)
  } else if (running && releases.some(r => isNewer(r.version, running))) {
    const note = text('p', 'A newer version is out. ', 'updates-pinned')
    const reload = houseButton('Reload to update', 'updates-reload')
    reload.addEventListener('click', () => location.reload())
    note.append(reload); nodes.push(note)
  }
  const plan = planUpdates(releases, running)
  if (plan.empty) nodes.push(text('p', plan.empty, 'updates-status'))
  else nodes.push(dayList(releases, older, running))
  host.replaceChildren(...nodes)
}

/**
 * The days, newest first, then Show more as the last entry while older days remain: each press
 * reveals DAY_STEP more, fetching the older history file (feed.ts loadOlder) the first time it is
 * needed and never before, down to the first release. Days already shown stay as they are.
 */
function dayList(recent: Release[], olderFile: string | null, running: string | null): HTMLOListElement {
  const list = document.createElement('ol'); list.className = 'updates-days'
  const pager = new DayPager(recent, olderFile, running)
  for (const day of pager.days()) list.append(dayEntry(day))
  const more = document.createElement('li'); more.className = 'updates-more'
  const button = houseButton('Show more', 'updates-more-button')
  const end = () => {
    more.replaceChildren(text('p', pager.first ? `Back to v${pager.first.version}.` : '', 'updates-end'))
    more.classList.add('is-end')
  }
  button.addEventListener('click', async () => {
    if (button.disabled) return
    if (pager.needsOlder) {
      button.disabled = true; button.textContent = 'Loading…'
      try { pager.addOlder(await loadOlder(pager.older!)) } catch {
        button.disabled = false; button.textContent = 'Older releases could not be loaded. Try again'
        return
      }
      button.disabled = false; button.textContent = 'Show more'
    }
    const next = pager.next(), added = next.map(dayEntry)
    for (const item of added) more.before(item)
    // Nothing left: the button gives way to a line, and focus moves to the first day it revealed.
    if (pager.done) { added[0]?.querySelector<HTMLButtonElement>('.update-day-toggle')?.focus({ preventScroll: true }); end() }
  })
  more.append(button)
  if (pager.done) end()
  list.append(more)
  railFollows(list)
  return list
}

/**
 * The rail runs at full strength beside every day shown and fades only below the last of them,
 * over Show more (the owner, 26 November 2026). Its solid length is measured, since days open,
 * close and arrive: --rail-solid is the last day's foot, from the top of the list.
 */
function railFollows(list: HTMLOListElement): void {
  const measure = () => {
    const days = list.querySelectorAll<HTMLElement>(':scope > .update-day'), last = days[days.length - 1]
    if (last) list.style.setProperty('--rail-solid', `${Math.round(last.offsetTop + last.offsetHeight)}px`)
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(list)
  new MutationObserver(measure).observe(list, { childList: true })
  requestAnimationFrame(measure)
}

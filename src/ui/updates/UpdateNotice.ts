/**
 * Tells the player a newer version is live. In the lobby: a banner in the build banner's style
 * with Reload, What's new and a dismiss button. In play it never covers the world: a small
 * chip in the sidebar, seen only when the panels are open. Nothing here reloads on its own.
 * Dismissing hides both for this version for the rest of the session.
 *
 * On the dev server the existing detector (tools/manual-reload.mjs) announces a rebuilt
 * bundle with a "syn3h:new-build" event; that shows the same banner without a version, and
 * the stylesheet hides the detector's own pill in the lobby so only this banner shows there.
 */
import { loadFeed, watchForUpdates } from './feed'

const DISMISSED = 'syn3h.update.dismissed'

export class UpdateNotice {
  readonly banner = document.createElement('div')
  readonly chip = document.createElement('button')
  /** The newer version, '' for a dev rebuild with no version, null before anything is found. */
  version: string | null = null
  constructor(private readonly whatsNew: () => void, signal: AbortSignal) {
    this.banner.className = 'build-banner update-banner'
    this.banner.setAttribute('role', 'status')
    this.banner.hidden = true
    this.banner.innerHTML = '<span class="update-banner-text"><strong></strong><span class="update-banner-summary"></span></span><span class="update-banner-actions"><button type="button" class="update-reload">Reload</button><button type="button" class="update-whatsnew">What’s new</button><button type="button" class="update-dismiss" aria-label="Dismiss for now">×</button></span>'
    this.banner.querySelector('.update-reload')!.addEventListener('click', () => location.reload(), { signal })
    this.banner.querySelector('.update-whatsnew')!.addEventListener('click', () => this.whatsNew(), { signal })
    this.banner.querySelector('.update-dismiss')!.addEventListener('click', () => this.dismiss(), { signal })
    this.chip.type = 'button'; this.chip.className = 'rail-update'; this.chip.hidden = true
    this.chip.addEventListener('click', () => this.whatsNew(), { signal })
    watchForUpdates(version => { void this.show(version) }, signal)
    window.addEventListener('syn3h:new-build', () => { if (!this.version) void this.show('') }, { signal })
  }

  /** Show the notice for `version`. Public so a check can drive it without a live site. */
  async show(version: string): Promise<void> {
    this.version = version
    let dismissed: string | null = null
    try { dismissed = sessionStorage.getItem(DISMISSED) } catch { /* No storage: show it. */ }
    if (dismissed === version) return
    this.banner.querySelector('strong')!.textContent = version ? `Update available: v${version}` : 'New build available'
    this.chip.textContent = version ? `Update v${version} · What’s new` : 'New build · What’s new'
    this.banner.querySelector('.update-banner-summary')!.textContent = ''
    if (!version) { this.banner.hidden = false; this.chip.hidden = false; return }
    this.banner.hidden = false; this.chip.hidden = false
    // The summary is a bonus: the notes for the newest release may not be in the feed yet.
    const summary = await loadFeed().then(list => list.find(r => r.version === version)?.summary ?? '', () => '')
    if (this.version === version) this.banner.querySelector('.update-banner-summary')!.textContent = summary
  }

  private dismiss(): void {
    this.banner.hidden = true; this.chip.hidden = true
    try { if (this.version) sessionStorage.setItem(DISMISSED, this.version) } catch { /* Hidden for this page only. */ }
  }
}

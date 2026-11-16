/** Keep lobby presentation separate from the URL needed to enter/resume a world.
 * No navigation occurs. A query-based frozen version is restored in play; reloading
 * the cleaned root lobby intentionally requests latest. Frozen pathnames stay intact.
 */
/** Preview switches that survive the lobby's clean address: the wordmark placement and the opening. */
const PREVIEW_FLAGS = ['wordmark', 'intro'] as const

export class LobbyAddress {
  private retained: URL
  private lobby = false

  constructor(
    private readonly location: Pick<Location, 'href'>,
    private readonly history: Pick<History, 'state' | 'replaceState'>,
  ) { this.retained = new URL(location.href) }

  playURL(): URL { return new URL(this.lobby ? this.retained.href : this.location.href) }

  showLobby(): void {
    if (!this.lobby) this.retained = new URL(this.location.href)
    this.lobby = true
    const clean = new URL(this.retained.href)
    // The preview flags (src/ui/brand/wordmarkSwitch.ts) stay while they are present.
    const now = new URL(this.location.href).searchParams
    const kept = PREVIEW_FLAGS.map(flag => [flag, now.get(flag) ?? clean.searchParams.get(flag)] as const)
    clean.search = ''; clean.hash = ''
    for (const [flag, value] of kept) if (value !== null) clean.searchParams.set(flag, value)
    this.replace(clean)
  }

  showPlay(room?: string): void {
    const url = this.playURL()
    if (room !== undefined) url.searchParams.set('room', room)
    this.retained = url
    this.lobby = false
    this.replace(url)
  }

  /** Invite/QR generation must not derive a frozen version from the cleaned bar. */
  inviteURL(room: string, world: string): string {
    const entry = this.playURL(), url = new URL(entry.pathname, entry.origin)
    const version = entry.searchParams.get('v')
    if (version !== null) url.searchParams.set('v', version)
    url.searchParams.set('room', room)
    if (world) url.searchParams.set('world', world)
    return url.href
  }

  private replace(url: URL): void {
    if (url.href !== this.location.href) this.history.replaceState(this.history.state, '', url.href)
  }
}

import { loadingMessages } from './data/loadingMessages'

const phaseLabels: Record<string, string> = { device: 'Checking your device', physics: 'Preparing motion', renderer: 'Preparing the view', world: 'Building your world', ready: 'Ready to explore' }
export interface LoadingDetail { phase?: string; progress?: number; elapsedMs?: number }

/** The progress meter the bootstrap script in index.html puts on `window`. */
interface BootMeter { set(value: number): void; value(): number; stop(): void }
const meter = (): BootMeter | undefined => (window as unknown as { __boot?: BootMeter }).__boot
/** However slow the device, the veil never stays longer than this. */
const LIMIT_MS = 45000

/**
 * The loading veil's logic. The veil itself, its mark and the easing of its progress are in
 * index.html, brought over verbatim from terranlabs.com so they cover the first paint: a
 * dark world seen edge on, light travelling round its limb behind a small sun as things
 * arrive, a moon in a slow outer orbit. This module is that site's BootGate for Syn3h: it
 * raises the mark's target as the game reports its phases, and when the world is ready it
 * lets the light finish its lap and lifts the veil.
 *
 * Nothing is written on the veil. The phase and a loading message are kept in a status
 * region that only screen readers see.
 */
export class LoadingScreen {
  readonly element = document.createElement('section')
  private messages: string[] = [...loadingMessages]
  private index = 0
  private done = false
  private readonly timer: ReturnType<typeof setInterval>
  private readonly limit: ReturnType<typeof setTimeout>
  private readonly abort = new AbortController()
  constructor() {
    this.element.className = 'syn3h-loading'
    this.element.setAttribute('role', 'status'); this.element.setAttribute('aria-live', 'polite')
    this.element.innerHTML = '<p class="loading-phase">Starting Syn3h</p><progress aria-label="Loading progress"></progress><p class="loading-message"></p>'
    document.body.append(this.element)
    this.setMessages(this.messages)
    // The bundle has arrived and is running.
    meter()?.set(0.45)
    window.addEventListener('syn3h:loading', event => this.update((event as CustomEvent<LoadingDetail>).detail), { signal: this.abort.signal })
    this.timer = setInterval(() => { this.index++; this.element.querySelector('.loading-message')!.textContent = this.messages[this.index % this.messages.length] }, 5000)
    this.limit = setTimeout(() => this.finish(), LIMIT_MS)
    // A startup failure must be seen, never hidden behind the veil: lift at once on a script
    // error, a rejected promise, or the moment the page's failure message is shown.
    window.addEventListener('error', () => this.lift(), { signal: this.abort.signal })
    window.addEventListener('unhandledrejection', () => this.lift(), { signal: this.abort.signal })
    const fatal = document.getElementById('fatal')
    if (fatal) {
      const watch = new MutationObserver(() => { if (fatal.style.display && fatal.style.display !== 'none') this.lift() })
      watch.observe(fatal, { attributes: true, attributeFilter: ['style'] })
      this.abort.signal.addEventListener('abort', () => watch.disconnect())
    }
  }
  setMessages(messages: readonly string[]): void {
    this.messages = messages.filter(value => typeof value === 'string' && value.trim()).slice(0, 100)
    if (!this.messages.length) this.messages = [...loadingMessages]
    this.index = 0; this.element.querySelector('.loading-message')!.textContent = this.messages[0]
  }
  update(detail?: LoadingDetail): void {
    if (!detail || typeof detail !== 'object') return
    if (typeof detail.phase === 'string') this.element.querySelector('.loading-phase')!.textContent = phaseLabels[detail.phase] ?? detail.phase
    const progress = this.element.querySelector('progress')!
    if (typeof detail.progress === 'number' && Number.isFinite(detail.progress)) {
      progress.max = 1; progress.value = Math.min(1, Math.max(0, detail.progress))
      // The game's own progress takes the light from where the bundle left it to nearly round.
      meter()?.set(0.45 + 0.47 * progress.value)
    } else progress.removeAttribute('value')
  }
  /** Everything is here. Let the light finish its lap, then lift. */
  finish(): void {
    if (this.done) return
    this.done = true
    meter()?.set(1)
    const started = performance.now()
    const settle = () => {
      const current = meter()
      if (!current || current.value() > 0.985 || performance.now() - started > 700) this.lift()
      else requestAnimationFrame(settle)
    }
    settle()
  }
  /** Lift the veil. Safe to call more than once. */
  private lift(): void {
    this.done = true
    clearInterval(this.timer); clearTimeout(this.limit); meter()?.stop()
    const root = document.documentElement
    // A busy phone draws few frames while it loads, so the eased light may not have got
    // round in time. Complete the lap as the mark opens out: it never lifts unfinished.
    root.style.setProperty('--boot-progress', '1')
    if (root.dataset.boot === 'loading') root.dataset.boot = 'done'
    this.element.hidden = true
  }
  dispose(): void { this.lift(); this.abort.abort(); this.element.remove() }
}

// Module imports run before main awaits renderer and physics initialization.
export const bootLoading = typeof document !== 'undefined' ? new LoadingScreen() : undefined

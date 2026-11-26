import { loadingMessages, pickLoadingLine } from './data/loadingMessages'

/**
 * What each phase the game reports (core/quality.ts reportLoading, from Game.init and the
 * first frame) is really doing, in plain words, for screen readers: announced once per phase
 * by the polite live region. The veil's visible progress line is numbers only (index.html).
 */
export const phaseSteps: Record<string, string> = {
  device: 'Checking your graphics',
  physics: 'Starting the physics engine',
  renderer: 'Starting the renderer',
  world: 'Building your first world',
  ready: 'Ready to explore',
}
export interface LoadingDetail { phase?: string; progress?: number; elapsedMs?: number }

/** Keeps the veil up once loading is done, and calls `lift` when it may go. */
export type VeilHold = (lift: () => void) => void
/** The progress meter the bootstrap script in index.html puts on `window`. */
interface BootMeter { set(value: number): void; value(): number; stop(): void }
const meter = (): BootMeter | undefined => (window as unknown as { __boot?: BootMeter }).__boot
/** However slow the device, the veil never stays longer than this. */
const LIMIT_MS = 45000

/**
 * The loading veil's logic. The veil itself, its mark and the easing of its progress are in
 * index.html, brought over verbatim from terranlabs.com so they cover the first paint: a
 * dark world seen edge on, light travelling round its limb behind a small sun as things
 * arrive, a moon in a slow outer orbit. This module is that site's BootGate for Mira: it
 * raises the mark's target as the game reports its phases, and when the world is ready it
 * lets the light finish its lap and lifts the veil.
 *
 * The veil's status line (.boot-status) shows one dry joke about what is loading, picked by
 * index.html and kept until loading ends: no rotation. Three seconds into a load still going,
 * it fades in with index.html's second line (.boot-still), which is numbers only: the
 * seconds and the megabytes received. Both lines are aria-hidden: screen readers hear the
 * plain step once per phase (phaseSteps) from this module's polite live region,
 * .mira-loading, never the ticking numbers.
 */
/**
 * Whether the veil's status line may show a general loading line now. Not during a move between
 * rooms (html[data-room-move], src/ui/parallelUniverse.ts): then it says only the move's own lines,
 * the move line, "This is taking a while." and the outcome, never a joke about gravity.
 */
export const mayShowLoadingLine = (root: Pick<Element, 'hasAttribute'>): boolean => !root.hasAttribute('data-room-move')

export class LoadingScreen {
  /** The visually hidden live region: the plain phase, once per phase. */
  readonly element = document.createElement('section')
  private messages: readonly string[] = loadingMessages
  /** A host's own list replaces the phase pools as well as the general list. */
  private custom = false
  private phase: string | undefined
  private label = ''
  private done = false
  private limit: ReturnType<typeof setTimeout>
  private readonly abort = new AbortController()
  constructor() {
    this.element.className = 'mira-loading'
    this.element.setAttribute('role', 'status')
    this.element.setAttribute('aria-live', 'polite')
    this.element.innerHTML = '<p class="loading-phase"></p>'
    document.body.append(this.element)
    // The bundle has arrived and is running. index.html's own rotation hands over here.
    meter()?.set(0.45); this.announce('Loading Mira')
    window.addEventListener('mira:loading', event => this.update((event as CustomEvent<LoadingDetail>).detail), { signal: this.abort.signal })
    this.limit = setTimeout(() => this.finish(), LIMIT_MS)
    // The physics engine's download is being retried, or waits for Try again (physicsWasm.ts):
    // the veil carries that message, so its time limit waits, and starts afresh once the engine
    // has arrived and the rest of loading resumes.
    window.addEventListener('mira:physics-retry', event => {
      if (this.done) return
      clearTimeout(this.limit)
      if ((event as CustomEvent<{ state?: string }>).detail?.state === 'clear') this.limit = setTimeout(() => this.finish(), LIMIT_MS)
    }, { signal: this.abort.signal })
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
  /** Replaces the line with one of a host's own. It is shown as text, never as markup. */
  setMessages(messages: readonly string[]): void {
    const usable = messages.filter(value => typeof value === 'string' && value.trim()).slice(0, 100)
    this.custom = usable.length > 0
    this.messages = this.custom ? usable : loadingMessages
    const status = this.status()
    if (!this.done && status && mayShowLoadingLine(document.documentElement)) status.textContent = pickLoadingLine({ general: this.messages, previous: status.textContent ?? undefined })
  }
  update(detail?: LoadingDetail): void {
    if (!detail || typeof detail !== 'object') return
    if (typeof detail.phase === 'string' && detail.phase !== this.phase) {
      this.phase = detail.phase
      const step = phaseSteps[detail.phase] ?? detail.phase
      this.announce(step)
    }
    // The game's own progress takes the light from where the bundle left it to nearly round.
    if (typeof detail.progress === 'number' && Number.isFinite(detail.progress)) meter()?.set(0.45 + 0.47 * Math.min(1, Math.max(0, detail.progress)))
  }
  private status(): HTMLElement | null { return document.querySelector<HTMLElement>('.boot-status') }
  /** The plain phase, for screen readers. Only a change is written, so each is heard once. */
  private announce(text: string): void {
    if (text === this.label) return
    this.label = text
    this.element.querySelector('.loading-phase')!.textContent = text
  }
  /**
   * Everything is here. Let the light finish its lap, then lift. `hold`, if given, may keep
   * the veil up after loading (src/ui/TapToBegin.ts): it is handed the function that lifts it.
   */
  finish(hold?: VeilHold): void {
    if (this.done) return
    this.done = true
    meter()?.set(1)
    const started = performance.now()
    const settle = () => {
      const current = meter()
      if (!current || current.value() > 0.985 || performance.now() - started > 700) this.lift(hold)
      else requestAnimationFrame(settle)
    }
    settle()
  }
  /**
   * Lift the veil. Safe to call more than once. Without a hold (a startup failure, the time
   * limit) it lifts at once, ending any wait for a tap.
   */
  private lift(hold?: VeilHold): void {
    this.done = true
    clearTimeout(this.limit); meter()?.stop()
    const root = document.documentElement
    // A busy phone draws few frames while it loads, so the eased light may not have got
    // round in time. Complete the lap as the mark opens out: it never lifts unfinished.
    root.style.setProperty('--boot-progress', '1')
    this.element.hidden = true
    // 'ready': loading is done and the veil waits for a tap (TapToBegin.ts).
    const open = () => { if (root.dataset.boot === 'loading' || root.dataset.boot === 'ready') root.dataset.boot = 'done' }
    if (hold && root.dataset.boot === 'loading') hold(open)
    else open()
  }
  dispose(): void { this.lift(); this.abort.abort(); this.element.remove() }
}

// Module imports run before main awaits renderer and physics initialization.
export const bootLoading = typeof document !== 'undefined' ? new LoadingScreen() : undefined

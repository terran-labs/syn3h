import { wordmarkSvg } from './brand/logo'
import { Starfield } from './Starfield'
import { graphicsLevel, levelNumber } from '../core/quality'
import { loadingMessages } from './data/loadingMessages'
const phaseLabels: Record<string, string> = { device: 'Checking your device', physics: 'Preparing motion', renderer: 'Preparing the view', world: 'Building your world', ready: 'Ready to explore' }
export interface LoadingDetail { phase?: string; progress?: number; elapsedMs?: number }

export class LoadingScreen {
  readonly element = document.createElement('section')
  private messages: string[] = [...loadingMessages]
  private index = 0
  private readonly started = performance.now()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly abort = new AbortController()
  private readonly sky: Starfield
  constructor() {
    this.element.className = 'syn3h-loading'
    this.element.setAttribute('role', 'status'); this.element.setAttribute('aria-live', 'polite')
    this.element.innerHTML = wordmarkSvg()+'<h1>Preparing to Explore</h1><p class="loading-phase">Starting Syn3h</p><progress aria-label="Loading progress"></progress><p class="loading-message"></p><small class="loading-time"></small>'
    document.body.append(this.element)
    // The same generated sky as the lobby, so the first thing on screen needs no image.
    this.sky = new Starfield(this.element, {}, () => levelNumber(graphicsLevel.value) === 0)
    this.setMessages(this.messages)
    window.addEventListener('syn3h:loading', event => this.update((event as CustomEvent<LoadingDetail>).detail), { signal: this.abort.signal })
    this.timer = setInterval(() => {
      this.index++; this.element.querySelector('.loading-message')!.textContent = this.messages[this.index % this.messages.length]
      this.updateTime(performance.now() - this.started)
    }, 5000)
    // A fatal startup failure must remain visible above this cover.
    window.addEventListener('error', () => this.finish(), { signal: this.abort.signal })
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
    if (typeof detail.progress === 'number' && Number.isFinite(detail.progress)) { progress.max = 1; progress.value = Math.min(1, Math.max(0, detail.progress)) }
    else progress.removeAttribute('value')
    if (typeof detail.elapsedMs === 'number' && Number.isFinite(detail.elapsedMs)) this.updateTime(detail.elapsedMs)
  }
  private updateTime(ms: number): void { this.element.querySelector('.loading-time')!.textContent = `${Math.max(0, Math.floor(ms / 1000))} seconds` }
  finish(): void { this.element.hidden = true; clearInterval(this.timer); this.sky.dispose() }
  dispose(): void { this.finish(); this.abort.abort(); this.element.remove() }
}

// Module imports run before main awaits renderer and physics initialization.
export const bootLoading = typeof document !== 'undefined' ? new LoadingScreen() : undefined

/**
 * The pause contract agreed with the integrator, whose implementation is src/core/pause.ts
 * (PauseState) and src/core/lifecycle.ts. Declared here structurally so the shell compiles
 * on bases that do not have those files yet; the shapes are identical.
 */
export interface PauseControl {
  readonly paused: boolean
  readonly reason: 'user' | 'hidden' | null
  pause(reason: 'user' | 'hidden'): void
  resume(reason: 'user' | 'hidden'): void
  /** Called on any change of paused or reason; not called with the current state on subscribe. */
  subscribe(listener: (paused: boolean, reason: 'user' | 'hidden' | null) => void): () => void
}

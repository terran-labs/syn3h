/**
 * Long work spread across animation frames, so no single frame stalls.
 *
 * A job is an iterator. Each `next()` does one small piece and yields. Yielding a promise
 * means "wait for this" (a worker, an async compile) without spending frame time. The
 * runner takes pieces until the frame's budget is spent, then waits for the next frame.
 *
 * `drain` runs a job to the end at once, ignoring the promises it yields: the fallback when
 * something needs the result immediately.
 */
export type SliceStep = void | undefined | PromiseLike<unknown>

const nextFrame = (): Promise<void> => new Promise(resolve => {
  // A hidden page gets no animation frames; carry on with timers there.
  if (typeof requestAnimationFrame === 'undefined' || (typeof document !== 'undefined' && document.hidden)) setTimeout(resolve, 0)
  else requestAnimationFrame(() => resolve())
})

/** Run `job` a few milliseconds per frame. Resolves when it is done. */
export async function runSliced(job: Iterator<SliceStep>, budgetMs = 6): Promise<void> {
  await nextFrame()
  let start = performance.now()
  for (;;) {
    const step = job.next()
    if (step.done) return
    if (step.value && typeof (step.value as PromiseLike<unknown>).then === 'function') {
      // Waiting costs no frame time: start a fresh budget when it is over.
      try { await step.value } catch { /* The job reads the outcome itself. */ }
      start = performance.now()
    }
    if (performance.now() - start >= budgetMs) { await nextFrame(); start = performance.now() }
  }
}

/** Run `job` to the end now. Promises it yields are not waited for. */
export function drain(job: Iterator<SliceStep>): void {
  while (!job.next().done) { /* Each step does its own work. */ }
}

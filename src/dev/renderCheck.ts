import type { PassResult, RenderCheckPasses } from './renderCheckPasses'
import type { RenderCheckScene } from './renderCheckScene'
import { formatTier, percentile, type TierResult } from './renderCheckResults'

declare const __SYN3H_BUILD__: string

const main = document.querySelector('main')!
const canvas = document.querySelector('canvas')!
const setup = document.querySelector<HTMLElement>('#setup')!
const status = document.querySelector<HTMLElement>('#status')!
const output = document.querySelector<HTMLElement>('#result')!
const actions = document.querySelector<HTMLElement>('#actions')!
const share = document.querySelector<HTMLButtonElement>('#share')!
let report = '', fullReport = ''
function selectedReport() { return document.querySelector<HTMLDetailsElement>('#details')!.open ? fullReport : report }

function nextFrame(signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const cancel = () => { cancelAnimationFrame(id); reject(signal.reason) }
    const id = requestAnimationFrame(t => {
      signal.removeEventListener('abort', cancel)
      resolve(t)
    })
    signal.addEventListener('abort', cancel, { once: true })
  })
}

async function sampleFrames(draw: () => void, limit: number, until: number, signal: AbortSignal, programCount?: () => number) {
  const intervals: number[] = [], cpu: number[] = []
  let previous: number | undefined, previousCpu = 0, previousBuilt = false
  while (intervals.length < limit && performance.now() < until) {
    const t = await nextFrame(signal)
    if (performance.now() >= until) break
    const before = programCount?.()
    const start = performance.now()
    draw()
    if (previous !== undefined && !previousBuilt) {
      intervals.push(t - previous)
      cpu.push(previousCpu)
    }
    previousCpu = performance.now() - start
    previousBuilt = before !== programCount?.()
    previous = t
  }
  return { intervals, cpu }
}

async function crossCheck(scene: RenderCheckScene, row: TierResult, deadline: number, signal: AbortSignal) {
  const toggles = scene.getToggles()
  for (const toggle of toggles) {
    if (performance.now() + 350 >= deadline) {
      row.checks.push('Frame cross-checks incomplete at the tier deadline.')
      break
    }
    const block = async () => {
      scene.draw() // Apply the change, including any graph rebuild, before timing the block.
      return (await sampleFrames(() => scene.draw(), 5, deadline, signal, () => scene.renderer.info.memory.programs)).intervals
    }
    const on = await block()
    if (on.length < 5) break
    let off: number[]
    try { toggle.setEnabled(false); off = await block() }
    finally { toggle.setEnabled(true) }
    if (off.length < 5 || performance.now() >= deadline) break
    const again = await block()
    if (again.length < 5) break
    const a = percentile(on, .5), b = percentile(again, .5)
    const delta = (a + b) / 2 - percentile(off, .5)
    const spread = Math.max(Math.abs(a - b), percentile([...on, ...again], .9) - percentile([...on, ...again], .1), .1)
    row.checks.push(toggle.name + ' · frame difference: ' + (Math.abs(delta) <= spread
      ? 'within baseline variation' : delta.toFixed(1) + ' ms') + ' (5 intervals per block)')
  }
}

async function measurePasses(meter: RenderCheckPasses, draw: () => void, deadline: number, signal: AbortSignal) {
  await nextFrame(signal)
  const first = await meter.measure(draw, deadline)
  const timed = (p: PassResult) => p.ms !== null && /timestamp|elapsed query|timer query/i.test(p.method)
  if (!first.some(timed)) return first
  const samples = new Map(first.filter(timed).map(p => [p.name, [p.ms!]]))
  for (let i = 1; i < 5 && performance.now() + 100 < deadline; i++) {
    await nextFrame(signal)
    for (const p of await meter.measure(draw, deadline)) {
      if (timed(p)) samples.get(p.name)?.push(p.ms!)
    }
  }
  return first.map(p => {
    const values = samples.get(p.name)
    return values ? { ...p, ms: percentile(values, .5), note: [values.length + ' timed frames', p.note].filter(Boolean).join('. ') } : p
  })
}

async function run() {
  const started = performance.now(), end = started + 55_000
  const ctl = new AbortController()
  const stop = (reason: string) => { if (!ctl.signal.aborted) ctl.abort(new Error(reason)) }
  let scene: RenderCheckScene | undefined, refreshMs = NaN, backend = 'unavailable'
  let finished = false
  const rows: TierResult[] = []
  const model = document.querySelector<HTMLInputElement>('#model')!.value.trim() ||
    (/iPhone/i.test(navigator.userAgent) ? 'iPhone (model unspecified)' : 'Model unspecified')
  function finish(reason: string) {
    if (finished) return
    finished = true
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    const header = ['Syn3h render check · ' + __SYN3H_BUILD__ + ' · shoreline v1',
      model + ' · ' + navigator.userAgent,
      backend + ' · device DPR ' + devicePixelRatio + ' · ' + seconds + ' s · ' + reason]
    if (Number.isFinite(refreshMs)) header.push('Browser cadence ' + Math.round(1000 / refreshMs) +
      ' Hz. Holds = at least 95% of measured frames within 1.5 refresh periods.')
    report = [...header, '', ...rows.map(r => formatTier(r, refreshMs, false) + '\n'),
      'K-slope is a completion-time estimate. Tile GPUs can defer or merge work. Repeated submission time remains in the slope; R² describes the fit.',
      'Scene color includes the sky and water surface. Their visibility cross-checks include changes in overdraw. Fused post effects share a pass.'].join('\n')
    output.textContent = report
    const breakdown = rows.map(r => formatTier(r, refreshMs)).join('\n\n')
    fullReport = report + '\n\nPass timings and cross-checks\n' + breakdown
    document.querySelector<HTMLElement>('#timings')!.textContent = breakdown
    document.querySelector<HTMLElement>('#details')!.hidden = false
    status.textContent = reason
    main.classList.remove('running')
    actions.hidden = false
    share.hidden = !navigator.share
  }
  const interrupted = () => finish(String((ctl.signal.reason as Error).message))
  const onHide = () => { if (document.hidden) stop('Partial result: page was hidden.') }
  const onRotate = () => stop('Partial result: orientation changed.')
  ctl.signal.addEventListener('abort', interrupted)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('orientationchange', onRotate)
  const timer = window.setTimeout(() => stop('Partial result: time limit reached.'), end - started)
  setup.hidden = true
  main.classList.add('running')
  status.textContent = 'Preparing the shoreline…'
  try {
    const [{ createRenderCheckScene }, { RenderCheckPasses }, { LEVELS }] = await Promise.all([
      import('./renderCheckScene'), import('./renderCheckPasses'), import('../core/quality'),
    ])
    for (const level of LEVELS) rows.push({ name: level.name, intervals: [], cpu: [], passes: [], checks: [], status: 'Unmeasured' })
    const cadence = await sampleFrames(() => {}, 24, Math.min(end, performance.now() + 1800), ctl.signal)
    if (cadence.intervals.length >= 8) refreshMs = percentile(cadence.intervals, .5)
    ctl.signal.throwIfAborted()
    scene = await createRenderCheckScene(canvas)
    ctl.signal.throwIfAborted()
    backend = scene.getState().backend
    const meter = new RenderCheckPasses(scene.renderer, new URLSearchParams(location.search).get('timing') === 'slope')
    for (const [i, row] of rows.entries()) {
      ctl.signal.throwIfAborted()
      const start = performance.now()
      if (start >= end - 300) break
      const tierEnd = start + (end - start - 250) / (rows.length - i)
      status.textContent = row.name + ' · ' + (i + 1) + ' of ' + rows.length
      await nextFrame(ctl.signal)
      await scene.setTier(i)
      scene.draw()
      await nextFrame(ctl.signal)
      scene.draw()
      const state = scene.getState()
      row.resolution = state.width + '×' + state.height + ' backing pixels · render DPR ' + state.pixelRatio.toFixed(2)
      const frame = await sampleFrames(() => scene!.draw(), 30, Math.min(tierEnd, performance.now() + 1600), ctl.signal, () => scene!.renderer.info.memory.programs)
      row.intervals = frame.intervals; row.cpu = frame.cpu
      row.status = 'Pass timings incomplete'
      if (performance.now() >= tierEnd) continue
      row.passes = await measurePasses(meter, () => scene!.draw(), tierEnd - Math.min(1400, (tierEnd - performance.now()) * .18), ctl.signal)
      ctl.signal.throwIfAborted()
      row.status = row.passes.length ? undefined : 'No pass timings available'
      await crossCheck(scene, row, tierEnd, ctl.signal)
      if (!finished) output.textContent = formatTier(row, refreshMs, false)
    }
    finish(rows.every(r => r.intervals.length >= 12 && r.passes.some(p => p.ms !== null)) ?
      'Run complete.' : 'Partial result: insufficient samples for some measurements.')
  } catch (error) {
    finish('Partial result: ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('orientationchange', onRotate)
    scene?.dispose()
  }
}

document.querySelector('#start')!.addEventListener('click', () => void run(), { once: true })
document.querySelector('#again')!.addEventListener('click', () => location.reload())
document.querySelector('#copy')!.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(selectedReport()); status.textContent = 'Result copied.' }
  catch {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector<HTMLDetailsElement>('#details')!.open ? document.querySelector('#timings')! : output)
    const selection = getSelection()
    selection?.removeAllRanges(); selection?.addRange(range)
    status.textContent = 'Select Copy to copy the highlighted result.'
  }
})
share.addEventListener('click', async () => {
  try { await navigator.share({ title: 'Syn3h rendering check', text: selectedReport() }) }
  catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) status.textContent = 'Sharing unavailable. Use Copy result.' }
})

document.querySelector('#details')!.addEventListener('toggle', () => {
  document.querySelector('#copy')!.textContent = document.querySelector<HTMLDetailsElement>('#details')!.open ? 'Copy full report' : 'Copy result'
})

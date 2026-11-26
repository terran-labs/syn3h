/**
 * The loading veil's progress bar (index.html's bootstrap, tools/boot-bytes.mjs). Bugs caught:
 * - the bar's total missing a startup file, so it overshoots, or counting a file the page never
 *   fetches before its first frame (a lazy chunk, a source map, a worker, a font weight the veil
 *   does not use), so it stalls short of the end of the download (startupFiles);
 * - the inlined total not what the veil adds up from the emitted files (the build's own check,
 *   countedTotal), or the document's size depending on the number written into it;
 * - a retried physics download counted twice, a resource outside the startup set counted, or a
 *   different transfer encoding changing the count (decoded sizes);
 * - the bar going backwards, reaching 100% before the veil lifts, or claiming a stage early;
 * - a page without a total (the dev server) losing its seconds and megabytes line.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bootSetScript, countedTotal, fillSlot, startupFiles } from '../../tools/boot-bytes.mjs'

const chunk = (fileName: string, code: string, imports: string[] = [], extra: object = {}) => ({ type: 'chunk', fileName, code, imports, dynamicImports: [], isEntry: false, viteMetadata: { importedCss: new Set<string>() }, ...extra })
const asset = (fileName: string, source: string | Uint8Array) => ({ type: 'asset', fileName, source })

const CSS = '@font-face{src:url(/fonts/barlow-400-latin.woff2)}@font-face{src:url(/fonts/barlow-500-latin.woff2)}@font-face{src:url(/fonts/barlow-600-latin.woff2)}'
function bundle() {
  const entry = chunk('assets/index-AAAA1111.js', 'x'.repeat(1000) + 'new Worker(new URL(`/assets/terrainWorker-BBBB2222.js`,``+import.meta.url))', ['assets/three-CCCC3333.js'],
    { isEntry: true, dynamicImports: ['assets/GlassPost-DDDD4444.js'], viteMetadata: { importedCss: new Set(['assets/index-EEEE5555.css']) } })
  const files = [
    entry,
    chunk('assets/three-CCCC3333.js', 'y'.repeat(500), ['assets/vendor-FFFF6666.js']),
    chunk('assets/vendor-FFFF6666.js', 'z'.repeat(300)),
    chunk('assets/GlassPost-DDDD4444.js', 'lazy'.repeat(100)),
    asset('assets/index-EEEE5555.css', CSS),
    asset('assets/terrainWorker-BBBB2222.js', 'w'.repeat(200)),
    asset('assets/index-AAAA1111.js.map', 'm'.repeat(9000)),
    asset('assets/rapier_wasm3d_bg-GGGG7777.wasm', new Uint8Array(4000)),
    asset('assets/hall.worklet-HHHH8888.js', 'h'.repeat(50)),
  ]
  return Object.fromEntries(files.map(f => [f.fileName, f]))
}
const fonts = (url: string) => ({ '/fonts/barlow-400-latin.woff2': 160, '/fonts/barlow-500-latin.woff2': 170, '/fonts/barlow-600-latin.woff2': 180 } as Record<string, number>)[url] ?? null

describe('the startup set the build counts', () => {
  it('is the entry, its static imports and their CSS, the physics engine and the veil\'s own fonts; never a worker, a lazy chunk, a map or another weight', () => {
    const files = startupFiles(bundle(), fonts)
    expect(Object.fromEntries(files)).toEqual({
      'assets/index-AAAA1111.js': 1000 + 'new Worker(new URL(`/assets/terrainWorker-BBBB2222.js`,``+import.meta.url))'.length,
      'assets/index-EEEE5555.css': CSS.length,
      'assets/three-CCCC3333.js': 500,
      'assets/vendor-FFFF6666.js': 300,
      'assets/rapier_wasm3d_bg-GGGG7777.wasm': 4000,
      'fonts/barlow-400-latin.woff2': 160,
      'fonts/barlow-500-latin.woff2': 170,
    })
  })
  it('fails the build when the startup CSS stops declaring a font the veil is set in', () => {
    const b = bundle(); (b['assets/index-EEEE5555.css'] as { source: string }).source = '@font-face{src:url(/fonts/barlow-400-latin.woff2)}'
    expect(() => startupFiles(b, fonts)).toThrow(/barlow-500/)
  })
  it('writes the total into a slot of fixed width, and the veil adds up the same number from the emitted files', () => {
    const files: Map<string, number> = startupFiles(bundle(), fonts)
    const page = `<head><script>${bootSetScript(files)}</script></head><body>${'p'.repeat(700)}</body>`
    const total = Buffer.byteLength(page) + [...files.values()].reduce((a, b) => a + b, 0)
    const filled = fillSlot(page, total)
    expect(Buffer.byteLength(filled)).toBe(Buffer.byteLength(page))
    const sizes = new Map([...files].map(([path, bytes]) => [path.slice(path.lastIndexOf('/') + 1), bytes]))
    expect(countedTotal(filled, (name: string) => sizes.get(name) ?? 0)).toMatchObject({ inlined: total, counted: total })
    // A startup file changed without the total changing is a disagreement the build refuses.
    expect(countedTotal(filled, (name: string) => (sizes.get(name) ?? 0) + (name.startsWith('three') ? 1 : 0)).counted).toBe(total + 1)
  })
})

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
const head = scripts.find(s => s.includes('root.dataset.boot = "loading"'))!

interface Entry { name: string; decodedBodySize: number; encodedBodySize?: number }
/** index.html's head bootstrap, run against fakes, with a frame driven by hand. */
function veil(set: { bytes: number; files: string[] } | null, opts: { search?: string; reduced?: boolean } = {}) {
  const vars: Record<string, string> = {}, dataset: Record<string, string> = {}
  const root = { dataset, style: { setProperty: (k: string, v: string) => { vars[k] = v } } }
  const entries: { navigation: Entry[]; resource: Entry[] } = { navigation: [], resource: [] }
  const win: Record<string, unknown> = { __miraBootSet: set }
  let frame: ((now: number) => void) | null = null, now = 0
  new Function('document', 'sessionStorage', 'location', 'window', 'requestAnimationFrame', 'matchMedia', 'performance', head)(
    { documentElement: root }, { getItem: () => null }, { search: opts.search ?? '' }, win,
    (f: (now: number) => void) => { frame = f; return 0 }, () => ({ matches: !!opts.reduced }),
    { now: () => now, getEntriesByType: (type: 'navigation' | 'resource') => entries[type] })
  const boot = win.__boot as { set(v: number): void; stage(p: string): void; value(): number; received(): number; total: number }
  const run = (frames: number) => { for (let i = 0; i < frames; i++) { now += 16; frame?.(now) } }
  return { boot, win, entries, vars, dataset, run, bar: () => Number(vars['--boot-bar']) }
}

describe('the veil\'s progress', () => {
  const set = { bytes: 10_000, files: ['index-A.js', 'three-B.js', 'rapier_wasm3d_bg-C.wasm'] }

  it('counts each startup file once, by its decoded size, the largest seen, and nothing outside the set', () => {
    const v = veil(set)
    v.entries.navigation.push({ name: 'https://mira.cc/', decodedBodySize: 1000, encodedBodySize: 300 })
    v.entries.resource.push(
      { name: 'https://mira.cc/assets/index-A.js', decodedBodySize: 3000, encodedBodySize: 900 },
      // A retried physics download: a failed attempt's partial body, then the whole file.
      { name: 'https://mira.cc/assets/rapier_wasm3d_bg-C.wasm', decodedBodySize: 1200 },
      { name: 'https://mira.cc/assets/rapier_wasm3d_bg-C.wasm?retry=2', decodedBodySize: 4000 },
      // Lazy and unrelated files are not in the set.
      { name: 'https://mira.cc/assets/GlassPost-D.js', decodedBodySize: 5000 },
      { name: 'https://mira.cc/brand/mira3-favicon.svg', decodedBodySize: 800 },
    )
    expect(v.boot.received()).toBe(1000 + 3000 + 4000)
    // The engine streaming on its way to the loader, before its entry exists, counts as it arrives.
    v.win.__miraPhysicsUrl = '/assets/rapier_wasm3d_bg-C.wasm'
    v.entries.resource.splice(1, 2); v.win.__miraPhysicsBytes = 2500
    expect(v.boot.received()).toBe(1000 + 3000 + 2500)
  })

  it('shows the download by its bytes, never goes backwards, and holds short of the end until the veil lifts', () => {
    const v = veil(set)
    v.entries.navigation.push({ name: 'https://mira.cc/', decodedBodySize: 5000 })
    v.run(400)
    const half = v.bar()
    expect(half).toBeGreaterThan(0.35); expect(half).toBeLessThanOrEqual(0.4)
    // A retry restarting the engine's stream lowers the count; the bar stays where it was.
    v.win.__miraPhysicsUrl = '/assets/rapier_wasm3d_bg-C.wasm'; v.win.__miraPhysicsBytes = 0
    v.entries.navigation[0].decodedBodySize = 4000
    v.run(100); expect(v.bar()).toBeGreaterThanOrEqual(half)
    // Phases end stages, in order; one reported out of order never moves the bar back.
    let last = v.bar()
    for (const phase of ['device', 'physics', 'renderer', 'world', 'terrain', 'world', 'ready']) {
      v.boot.stage(phase); v.run(300)
      expect(v.bar()).toBeGreaterThanOrEqual(last); last = v.bar()
    }
    // Everything drawn, but the veil has not lifted: never 100%.
    v.run(20_000); expect(v.bar()).toBeLessThan(0.99)
    v.boot.set(1); v.run(300); expect(v.bar()).toBeGreaterThan(0.99)
  })

  it('creeps through a long stage without reaching its end, and never fakes download progress it has a total for', () => {
    const v = veil(set)
    v.run(5000); expect(v.bar()).toBe(0)
    v.boot.stage('world'); v.run(50_000)
    expect(v.bar()).toBeGreaterThan(0.82); expect(v.bar()).toBeLessThan(0.86)
  })

  it('steps the bar under reduced motion', () => {
    const v = veil(set, { reduced: true })
    v.boot.stage('world'); v.run(300)
    expect(Math.abs(v.bar() * 20 - Math.round(v.bar() * 20))).toBeLessThan(1e-9)
  })

  it('marks the page for the bar only with a total, and the percentage only on request', () => {
    expect('bootBytes' in veil(set).dataset).toBe(true)
    expect('bootBytes' in veil(null).dataset).toBe(false)
    expect('bootPercent' in veil(set).dataset).toBe(false)
    expect('bootPercent' in veil(set, { search: '?bootpct=1' }).dataset).toBe(true)
    // Without a total the mark still creeps, as before.
    const old = veil(null); old.run(2000); expect(Number(old.vars['--boot-progress'])).toBeGreaterThan(0)
  })

  it('keeps the seconds and megabytes: as the bar\'s title with a total, as the line itself without', () => {
    const body = scripts.find(s => s.includes('w.textContent = numbers'))!
    expect(body).toMatch(/if \(bar\) \{ w\.title = numbers; w\.dataset\.numbers = numbers;/)
    expect(body).toMatch(/else w\.textContent = numbers;/)
  })
})

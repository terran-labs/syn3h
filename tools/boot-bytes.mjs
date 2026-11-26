/**
 * Build plugin: tell the loading veil how many bytes a first visit downloads before the first
 * frame, so its bar can show the download as a true fraction (index.html, the veil's bootstrap).
 *
 * The startup set is what the page needs before it can draw:
 *   - the document itself (index.html, after this plugin has written the total into it);
 *   - the entry script and every chunk it imports statically, with the CSS those chunks import;
 *   - the physics engine's WebAssembly (tools/rapier-wasm.mjs);
 *   - the fonts the veil's own text is set in (VEIL_FONTS), which the startup CSS declares.
 * Not in it: source maps, chunks imported only dynamically (the glass shader, tuners), the
 * audio worklets, the module workers (a worker's script is not one of the page's resource
 * entries, so the veil could never count it, and the planet map's starts after loading), the
 * other font weights (fetched when text set in them is first shown, after the veil) and
 * anything else fetched after play starts. Measured 25 November 2026: on every load, cold and
 * cached, desktop and phone, exactly these were absent when the first frame was drawn.
 *
 * Sizes are decoded sizes, the file's own bytes, because that is what the browser reports as
 * decodedBodySize whatever the transfer encoding: a server that sends Brotli where the build
 * expected gzip, or nothing compressed, gives the same count.
 *
 * The page gets one small script, before any other: window.__miraBootSet = { bytes, files },
 * the total and the file names the runtime adds up. The total includes the document, whose size
 * depends on the total, so the number is written into a fixed-width slot and the document's
 * size is the same whatever the number is. The build fails if what the runtime would count
 * from the emitted files differs from the total it was given.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The total's slot: the number is padded with spaces to this width, so the document's size never depends on it. */
const PLACEHOLDER = '__MIRA_BOOT_BYTES__'

const baseName = file => file.slice(file.lastIndexOf('/') + 1)
/** The veil's status line is Barlow 500 and its progress line Barlow 400 (index.html). */
export const VEIL_FONTS = ['/fonts/barlow-400-latin.woff2', '/fonts/barlow-500-latin.woff2']
const FONT = /url\((["']?)(\/fonts\/[^"')]+\.woff2)\1\)/g

/**
 * The files of the startup set, by output path, with their byte sizes as generated (the build
 * itself measures them again as written). `bundle` is Rollup's
 * output bundle; `publicFile(path)` returns the bytes of a public file such as /fonts/x.woff2,
 * or null. The document is not included: its size is known only once the total is in it.
 */
export function startupFiles(bundle, publicFile) {
  const files = new Map()
  const size = item => item.type === 'chunk' ? Buffer.byteLength(item.code) : (typeof item.source === 'string' ? Buffer.byteLength(item.source) : item.source.byteLength)
  const add = (path, bytes) => { if (!path.endsWith('.map')) files.set(path, bytes) }
  const chunks = Object.values(bundle).filter(item => item.type === 'chunk')
  const byName = new Map(Object.values(bundle).map(item => [item.fileName, item]))
  // The entry and its static imports. Dynamic imports load later and are not counted.
  const seen = new Set(), queue = chunks.filter(chunk => chunk.isEntry).map(chunk => chunk.fileName)
  if (queue.length !== 1) throw new Error(`Expected exactly 1 entry chunk for the startup set, found ${queue.length}`)
  while (queue.length) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const chunk = byName.get(name)
    if (!chunk || chunk.type !== 'chunk') continue
    add(name, size(chunk))
    queue.push(...chunk.imports)
    for (const css of chunk.viteMetadata?.importedCss ?? []) if (byName.has(css)) add(css, size(byName.get(css)))
  }
  // The physics engine's binary, fetched from the page's head (tools/rapier-wasm.mjs).
  const wasm = [...byName.keys()].filter(file => /(^|\/)rapier_wasm3d_bg-[\w-]+\.wasm$/.test(file))
  if (wasm.length !== 1) throw new Error(`Expected exactly 1 Rapier .wasm in the startup set, found ${wasm.length}`)
  add(wasm[0], size(byName.get(wasm[0])))
  // The veil's fonts, which the startup CSS must declare. Public files, so not in the bundle.
  const declared = new Set()
  for (const [path] of files) {
    if (!path.endsWith('.css')) continue
    const item = byName.get(path)
    const text = typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8')
    for (const [, , url] of text.matchAll(FONT)) declared.add(url)
  }
  for (const url of VEIL_FONTS) {
    if (!declared.has(url)) throw new Error(`The startup CSS no longer declares ${url}; update VEIL_FONTS in tools/boot-bytes.mjs`)
    const bytes = publicFile(url)
    if (bytes === null) throw new Error(`The veil's font ${url} is not in public/`)
    add(url.slice(1), bytes)
  }
  return files
}

/** The head script: the total's slot and the file names the runtime counts (by base name). */
export function bootSetScript(files, bytes = PLACEHOLDER) {
  const names = [...files.keys()].map(baseName)
  if (new Set(names).size !== names.length) throw new Error('Two startup files share a name; the veil counts them by name')
  return `window.__miraBootSet={bytes:${bytes},files:${JSON.stringify(names)}}`
}

/** Writes the total into the document's slot. Throws if the slot is not there exactly once. */
export function fillSlot(html, total) {
  const at = html.indexOf(PLACEHOLDER)
  if (at < 0 || html.indexOf(PLACEHOLDER, at + 1) >= 0) throw new Error('The startup byte slot is not in index.html exactly once')
  const number = String(total)
  if (number.length > PLACEHOLDER.length) throw new Error(`Startup total ${total} does not fit its slot`)
  return html.slice(0, at) + number.padEnd(PLACEHOLDER.length, ' ') + html.slice(at + PLACEHOLDER.length)
}

/**
 * What the veil's counter would add up from a finished document and the emitted files: the
 * document's own bytes and each listed file's. Used by the build to check itself.
 */
export function countedTotal(html, fileBytes) {
  const m = /window\.__miraBootSet=\{bytes:(\d+) *,files:(\[[^\]]*\])\}/.exec(html)
  if (!m) throw new Error('No startup set in index.html')
  const names = JSON.parse(m[2])
  return { inlined: Number(m[1]), counted: Buffer.byteLength(html) + names.reduce((sum, name) => sum + fileBytes(name), 0), names }
}

export function bootBytes() {
  let publicDir = 'public', files = null
  const publicFile = url => {
    const path = join(publicDir, url)
    return existsSync(path) ? readFileSync(path).byteLength : null
  }
  return {
    name: 'mira-boot-bytes',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { publicDir = config.publicDir },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return
        files = startupFiles(ctx.bundle, publicFile)
        return [{ tag: 'script', children: bootSetScript(files), injectTo: 'head-prepend' }]
      },
    },
    // Measured as written: Rollup adds each chunk's source map comment when it writes the file,
    // after generateBundle, so only the files on disk have their final sizes.
    writeBundle(options) {
      const dir = options.dir
      const page = join(dir, 'index.html')
      if (!files || !existsSync(page)) throw new Error('index.html or its startup set is missing from the build')
      const sizes = new Map()
      for (const path of files.keys()) {
        const onDisk = join(dir, path)
        if (!existsSync(onDisk)) throw new Error(`Startup file ${path} was not written`)
        sizes.set(baseName(path), readFileSync(onDisk).byteLength)
      }
      const html = readFileSync(page, 'utf8')
      // The document's size is fixed by the slot, so it can be counted before it is filled.
      const total = Buffer.byteLength(html) + [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0)
      const filled = fillSlot(html, total)
      writeFileSync(page, filled)
      // The check: what the runtime adds up from the written files equals the total it was given.
      const { inlined, counted } = countedTotal(readFileSync(page, 'utf8'), name => {
        const path = [...files.keys()].find(p => baseName(p) === name)
        return path ? readFileSync(join(dir, path)).byteLength : 0
      })
      if (inlined !== counted || inlined !== total) throw new Error(`Startup bytes disagree: inlined ${inlined}, counted ${counted}, total ${total}`)
      this.info?.(`startup set: ${files.size + 1} files, ${(total / 1048576).toFixed(2)} MB decoded`)
    },
  }
}

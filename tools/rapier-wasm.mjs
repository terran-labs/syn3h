/**
 * Build plugin: ship Rapier's WebAssembly as its own hashed file.
 *
 * @dimforge/rapier3d-compat carries its 3 MB WebAssembly as a 4.1 MB base64 string inside its
 * JavaScript, so the browser downloads and parses it as text before anything runs. The package
 * also ships the identical binary next to that script. For production builds this plugin
 * removes the string and has the module ask src/core/physicsWasm.ts for the compiled binary,
 * fetched from the package's own .wasm (emitted by Vite as a hashed asset). It also starts
 * that download from index.html, before the main script has arrived, and the loader takes it
 * over. A preload link was tried first: WebKit did not reuse it and fetched the file twice.
 *
 * Build only. The dev server, vitest and Node harnesses keep the stock package, bytes inline.
 *
 * It fails the build unless it finds exactly one inlined binary in exactly the expected
 * call, so a changed package can never ship both copies or none.
 */
import { fileURLToPath } from 'node:url'

/**
 * The base64 decode feeding wasm-bindgen's init: `X.toByteArray("<base64>").buffer`. The
 * lookbehind lets the identifier start only at a boundary, so megabytes of base64 are scanned
 * once and not once per character.
 */
const INLINED = /(?<![\w$])[A-Za-z_$][\w$]*\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer/g
/** Any other long base64 run would be a second inlined binary. */
const LONG_BASE64 = /[A-Za-z0-9+/=]{100000,}/g

/**
 * Rewrite the Rapier module source. `loader` is the import specifier of physicsWasm.ts.
 * Throws when the source is not shaped exactly as expected.
 */
export function externaliseRapierWasm(code, loader) {
  const found = [...code.matchAll(INLINED)]
  if (found.length !== 1) throw new Error(`Rapier changed: expected 1 inlined WebAssembly binary, found ${found.length}. Review tools/rapier-wasm.mjs before shipping.`)
  const replaced = code.replace(INLINED, '__syn3hPhysicsWasm(__syn3hPhysicsWasmUrl)')
  const left = replaced.match(LONG_BASE64)?.length ?? 0
  if (left !== 0) throw new Error(`Rapier changed: ${left} more inlined binary run(s) remain after removing the WebAssembly. Review tools/rapier-wasm.mjs before shipping.`)
  return `import __syn3hPhysicsWasmUrl from './rapier_wasm3d_bg.wasm?url'\nimport { loadPhysicsWasm as __syn3hPhysicsWasm } from ${JSON.stringify(loader)}\n${replaced}`
}

/**
 * The inline script that starts the download while the page is still being parsed, or throws
 * when the build did not emit exactly one binary. The loader in src/core/physicsWasm.ts uses
 * this response when the address matches, so the file is requested once in every browser.
 * A failed request is kept as its error, never an unhandled rejection.
 */
export function physicsEarlyFetchTag(fileNames, base = '/') {
  const wasm = fileNames.filter(name => /(^|\/)rapier_wasm3d_bg-[\w-]+\.wasm$/.test(name))
  if (wasm.length !== 1) throw new Error(`Expected exactly 1 Rapier .wasm in the build, found ${wasm.length}: ${wasm.join(', ')}`)
  const url = JSON.stringify(base + wasm[0])
  // The body is passed through a counter on its way to the loader, so the loading view can
  // show the bytes as they arrive (window.__syn3hPhysicsBytes, read by index.html's veil
  // script): the engine is the largest file of a first visit. The loader takes the response
  // unchanged otherwise (same status and headers, so compileStreaming still streams it).
  const count = `function(r){if(!r||!r.body||typeof TransformStream!=='function')return r;window.__syn3hPhysicsBytes=0;return new Response(r.body.pipeThrough(new TransformStream({transform:function(c,k){window.__syn3hPhysicsBytes+=c.byteLength;k.enqueue(c)}})),{status:r.status,statusText:r.statusText,headers:r.headers})}`
  return { tag: 'script', children: `window.__syn3hPhysicsUrl=${url};window.__syn3hPhysicsWasm={url:${url},response:fetch(${url}).then(${count}).catch(function(e){return e})}`, injectTo: 'head-prepend' }
}

export function rapierWasmAsset() {
  const loader = fileURLToPath(new URL('../src/core/physicsWasm.ts', import.meta.url))
  let base = '/', seen = 0
  return {
    name: 'syn3h-rapier-wasm-asset',
    apply: 'build',
    configResolved(config) { base = config.base },
    buildStart() { seen = 0 },
    transform(code, id) {
      if (!/node_modules\/@dimforge\/rapier3d-compat\/dist\/rapier\.mjs$/.test(id.replaceAll('\\', '/').split('?')[0])) return
      seen++
      return { code: externaliseRapierWasm(code, loader), map: null }
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return
        // The game always bundles physics: not having rewritten it means the inlined copy shipped.
        if (seen !== 1) throw new Error(`Rapier's module was rewritten ${seen} times, expected 1. Is the package import path still dist/rapier.mjs?`)
        return [physicsEarlyFetchTag(Object.keys(ctx.bundle), base)]
      },
    },
  }
}

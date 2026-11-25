#!/usr/bin/env node
/**
 * What a frozen copy would put on Cloudflare, and what it needs there (ops/RELEASE.md).
 *
 *   node tools/frozen-fingerprint.mjs hash <frozen dir>
 *       one sha256 over every deployable byte: each file under dist/, wrangler.toml,
 *       wrangler.staging.toml, and the Worker script wrangler bundles from the copy's server code
 *       (`wrangler deploy --dry-run`, which also takes in the dependencies and the bundler the copy
 *       is built with today: a frozen copy's node_modules is a link to the checkout's, so a change
 *       there changes the hash too). release.sh records it when a beta ships and refuses to promote
 *       a copy whose hash has changed since: nothing may edit what the owner tested.
 *   node tools/frozen-fingerprint.mjs secrets <wrangler config>
 *       the secret names the config declares in `[secrets] required = [...]`, one per line. A
 *       Worker secret must be declared there; release.sh refuses to deploy to a Worker that lacks
 *       one (a beta checks both Workers, since its bytes are promoted unchanged).
 *
 * The bundle's README (its timestamp) and source map (its paths) are not deployed and not hashed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

function files(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else out.push(path)
  }
  return out
}

/** The secret names in a wrangler.toml's `[secrets]` table, `required = [...]` (one or many lines). */
export function requiredSecrets(toml) {
  const section = /^\[secrets\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)
  if (!section) return []
  const list = /^\s*required\s*=\s*\[([\s\S]*?)\]/m.exec(section[1])
  return list ? [...list[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]) : []
}

export function fingerprint(dest) {
  const root = resolve(dest)
  const out = mkdtempSync(join(tmpdir(), 'mira-fingerprint-'))
  try {
    const wrangler = join(REPO, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
    execFileSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', out], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] })
    const entries = []
    for (const path of files(join(root, 'dist'))) entries.push([relative(root, path), sha(readFileSync(path))])
    for (const name of ['wrangler.toml', 'wrangler.staging.toml']) {
      const path = join(root, name)
      if (existsSync(path)) entries.push([name, sha(readFileSync(path))])
    }
    const bundle = join(out, 'worker.js')
    if (!existsSync(bundle)) throw new Error(`wrangler built no worker.js for ${root}`)
    entries.push(['<worker bundle>', sha(readFileSync(bundle))])
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return sha(entries.map(([path, hash]) => `${hash}  ${path}\n`).join(''))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'hash' && arg) console.log(fingerprint(arg))
  else if (cmd === 'secrets' && arg) { for (const name of requiredSecrets(readFileSync(arg, 'utf8'))) console.log(name) }
  else { console.error('usage: node tools/frozen-fingerprint.mjs hash <frozen dir> | secrets <wrangler config>'); process.exit(2) }
}

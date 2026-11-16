// Narrow first format: one self-contained Worker, explicit config, exact client selection.
// This module prepares/inspects files only. It never builds, starts a server or deploys.
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from './performance-release/index.mjs'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export const FINAL_CONFIG = Object.freeze({
  name: 'syn3h', main: './worker/worker.js', compatibility_date: '2026-11-01',
  no_bundle: true, find_additional_modules: false,
  assets: { directory: './dist', binding: 'ASSETS',
    run_worker_first: ['/ws', '/status', '/presence', '/', '/index.html', '/build.json', '/models/*'] },
  durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'RoomDO' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['RoomDO'] }],
})

const FINAL_CONFIG_JSON = canonicalJson(FINAL_CONFIG)
export function assertFinalConfig(value) {
  // Exact schema/value comparison deliberately rejects new flags, bindings, envs,
  // build steps and redirects until their semantics receive a separate review.
  if (canonicalJson(value) !== FINAL_CONFIG_JSON) throw new Error('Unsupported final deployment configuration')
}
function regular(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected regular artifact file: ${path}`)
  return readFileSync(path)
}
function inventory(root, relative, rows) {
  const path = join(root, relative), stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error(`Artifact symlink: ${relative}`)
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) inventory(root, `${relative}/${name}`, rows)
  } else if (stat.isFile()) {
    const bytes = readFileSync(path)
    rows.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) })
  } else throw new Error(`Unsupported artifact node: ${relative}`)
}
export function clientInventory(root) {
  const rows = []
  inventory(root, 'dist', rows)
  if (rows.some(r => r.path !== 'dist/.assetsignore' && r.path.split('/').some(p => p.startsWith('.')) || ['dist/_headers', 'dist/_redirects'].includes(r.path))) throw new Error('Unsupported hidden asset or routing directive')
  const policy = regular(join(root, 'dist/.assetsignore')).toString('utf8')
  if (policy !== '*.map\n') throw new Error('Unsupported asset upload policy')
  // This selection is intentionally limited to the reviewed policy. Headers,
  // redirects, hidden runtime files and carried versions are not silently omitted.
  return { selected: rows.filter(r => r.path !== 'dist/.assetsignore' && !r.path.endsWith('.map')),
    policy: rows.find(r => r.path === 'dist/.assetsignore'),
    excluded: rows.filter(r => r.path.endsWith('.map')) }
}
export async function assertSelfContainedWorker(bytes) {
  // es-module-lexer is already supplied by the existing Vite toolchain. Its version
  // and bytes must be included in preparer provenance before operational use.
  const { init, parse } = await import('es-module-lexer')
  await init
  const [imports] = parse(bytes.toString('utf8'))
  // Includes static imports, re-exports, dynamic imports and import.meta. This first
  // format supports none; it is not a general module resolver.
  if (imports.length) throw new Error('Worker must be self-contained without import expressions')
}
export async function inspectFinalArtifact(root) {
  for (const path of [root, join(root, 'worker')]) {
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Artifact directory must not be a symlink')
  }
  const names = readdirSync(root).sort()
  if (canonicalJson(names) !== canonicalJson(['dist', 'provenance.json', 'worker', 'wrangler.json'])) throw new Error('Unexpected final artifact root entries')
  const configBytes = regular(join(root, 'wrangler.json'))
  assertFinalConfig(JSON.parse(configBytes))
  if (canonicalJson(readdirSync(join(root, 'worker')).sort()) !== canonicalJson(['worker.js'])) throw new Error('Unsupported Worker companion module')
  const worker = regular(join(root, 'worker/worker.js'))
  await assertSelfContainedWorker(worker)
  const clients = clientInventory(root)
  const build = JSON.parse(regular(join(root, 'dist/build.json')))
  if (!/^v\d{2}\.\d+\.\d+$/.test(build.version) || !/^[a-f0-9]{40}$/.test(build.commit)) throw new Error('Incomplete build identity')
  const files = [...clients.selected, clients.policy,
    { path: 'worker/worker.js', bytes: worker.length, sha256: digest(worker) },
    { path: 'wrangler.json', bytes: configBytes.length, sha256: digest(configBytes) }].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  // Provenance records history. It cannot certify acceptance or alter runtime identity.
  const provenance = JSON.parse(regular(join(root, 'provenance.json')))
  return { identity: { version: build.version, commit: build.commit, artifactSha256: digest(canonicalJson(files)) },
    files, excluded: clients.excluded, provenance, provenanceSha256: digest(canonicalJson(provenance)) }
}
export async function prepareFinalArtifact({ snapshot, workerBytes, destination, reviewedSourceConfigSha256,
  reviewedClientManifest, reviewedWorkerSha256, provenance }) {
  if (digest(workerBytes) !== reviewedWorkerSha256) throw new Error('Worker bytes differ from reviewed module')
  if (digest(regular(join(snapshot, 'wrangler.toml'))) !== reviewedSourceConfigSha256) throw new Error('Original configuration differs from reviewed source')
  const clients = clientInventory(snapshot)
  if (canonicalJson(clients.selected) !== canonicalJson(reviewedClientManifest)) throw new Error('Client bytes differ from independently reviewed manifest')
  await assertSelfContainedWorker(workerBytes)
  // mkdir without recursive creation refuses an existing target, including an accepted snapshot.
  mkdirSync(destination)
  mkdirSync(join(destination, 'worker'))
  writeFileSync(join(destination, 'worker/worker.js'), workerBytes, { flag: 'wx' })
  writeFileSync(join(destination, 'wrangler.json'), FINAL_CONFIG_JSON + '\n', { flag: 'wx' })
  writeFileSync(join(destination, 'provenance.json'), canonicalJson(provenance) + '\n', { flag: 'wx' })
  for (const row of [...clients.selected, clients.policy]) {
    const parent = row.path.slice(0, row.path.lastIndexOf('/'))
    mkdirSync(join(destination, parent), { recursive: true })
    const bytes = regular(join(snapshot, row.path))
    if (digest(bytes) !== row.sha256) throw new Error('Snapshot changed during artifact preparation')
    writeFileSync(join(destination, row.path), bytes, { flag: 'wx' })
  }
  return inspectFinalArtifact(destination)
}

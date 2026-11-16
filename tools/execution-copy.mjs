// File preparation only. No process launch, cleanup, upload or qualification.
import * as fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inspectFinalArtifact } from './final-worker-artifact.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value)
const receipts = new WeakSet()
const requireThat = (condition, message) => { if (!condition) throw new Error(message) }
function absolute(p) {
  requireThat(typeof p === 'string' && path.isAbsolute(p) && path.normalize(p) === p && p !== '/' && !/[\x00-\x1f\x7f]/.test(p), 'Invalid absolute path')
  return p
}
function ancestors(p) {
  absolute(p)
  let cursor = path.parse(p).root
  for (const part of p.slice(cursor.length).split('/')) {
    cursor = path.join(cursor, part)
    const s = fs.lstatSync(cursor)
    requireThat(s.isDirectory() && !s.isSymbolicLink(), 'Ancestor must be an ordinary directory')
  }
}
function info(s) {
  requireThat(Number.isSafeInteger(s.dev) && Number.isSafeInteger(s.ino), 'Unsupported filesystem identity precision')
  requireThat((s.mode & 0o7000) === 0, 'Unsupported privilege mode bits')
  requireThat(s.isDirectory() || (s.isFile() && s.nlink === 1), 'Unsupported file type or hardlink')
  return { type: s.isDirectory() ? 'directory' : 'file', mode: s.mode & 0o777, dev: s.dev, ino: s.ino }
}
const identity = s => `${s.dev}:${s.ino}`
function stable(a, b) {
  return identity(a) === identity(b) && a.mode === b.mode && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink
}
function readRegular(p, expected) {
  ancestors(path.dirname(p))
  const before = fs.lstatSync(p)
  requireThat(info(before).type === 'file', 'Expected ordinary file')
  if (expected) requireThat(identity(before) === identity(expected) && (before.mode & 0o777) === expected.mode, 'Source identity changed')
  requireThat(typeof fs.constants.O_NOFOLLOW === 'number', 'No-follow opens required')
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    requireThat(stable(before, fs.fstatSync(fd)), 'Source changed before read')
    const bytes = fs.readFileSync(fd)
    requireThat(stable(before, fs.fstatSync(fd)) && stable(before, fs.lstatSync(p)), 'Source changed during read')
    return bytes
  } finally { fs.closeSync(fd) }
}
function portable(rows) { return rows.map(({dev, ino, ...row}) => row) }
function freeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value) }
  return value
}
/** Full inventory, including root, excluded files and empty directories. */
export function inventoryExecutionTree(root) {
  ancestors(root)
  const rows = []
  function visit(relative) {
    const p = relative ? path.join(root, relative) : root
    const before = fs.lstatSync(p), meta = info(before)
    const row = { path: relative, ...meta }
    if (meta.type === 'directory') {
      rows.push(row)
      for (const name of fs.readdirSync(p).sort()) visit(relative ? `${relative}/${name}` : name)
    } else {
      const bytes = readRegular(p, row)
      rows.push({ ...row, size: bytes.length, sha256: hash(bytes) })
    }
    requireThat(stable(before, fs.lstatSync(p)), 'Inventory changed during traversal')
  }
  visit('')
  return freeze({ rows, sha256: hash(json(portable(rows))) })
}
function same(actual, expected) {
  requireThat(json(actual.rows) === json(expected.rows), 'Original inventory or identity changed')
}
function independent(a, b) {
  const ids = new Set(a.rows.map(identity))
  requireThat(b.rows.every(r => !ids.has(identity(r))), 'Copy shares source identity')
}
/** Expected digests must be independently reviewed, not derived inside this call. */
export async function prepareExecutionCopy({ source, runner, expectedArtifactSha256, expectedInventorySha256 }) {
  absolute(source); absolute(runner)
  requireThat(source !== runner && !source.startsWith(runner + '/') && !runner.startsWith(source + '/'), 'Overlapping roots')
  ancestors(path.dirname(runner))
  const original = inventoryExecutionTree(source)
  requireThat(original.sha256 === expectedInventorySha256, 'Unreviewed full inventory')
  const inspected = await inspectFinalArtifact(source)
  requireThat(inspected.identity.artifactSha256 === expectedArtifactSha256, 'Unreviewed artifact')
  same(inventoryExecutionTree(source), original)
  // Exclusive staging creation. Failures deliberately leave evidence, never auto-delete.
  fs.mkdirSync(runner, { mode: 0o700 })
  fs.chmodSync(runner, 0o700)
  const project = path.join(runner, 'project'), state = path.join(runner, 'state')
  fs.mkdirSync(state, { mode: 0o700 }); fs.chmodSync(state, 0o700)
  for (const row of original.rows) {
    const target = row.path ? path.join(project, row.path) : project
    ancestors(path.dirname(target))
    if (row.type === 'directory') { fs.mkdirSync(target, { mode: 0o700 }); fs.chmodSync(target, 0o700); continue }
    const bytes = readRegular(path.join(source, row.path), row)
    requireThat(hash(bytes) === row.sha256 && bytes.length === row.size, 'Source bytes changed during copy')
    const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
    try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, row.mode) } finally { fs.closeSync(fd) }
  }
  for (const row of [...original.rows].reverse()) if (row.type === 'directory') fs.chmodSync(row.path ? path.join(project,row.path) : project,row.mode)
  const copied = inventoryExecutionTree(project)
  requireThat(json(portable(copied.rows)) === json(portable(original.rows)), 'Copy differs from complete source inventory')
  independent(original,copied)
  same(inventoryExecutionTree(source),original)
  const copyIdentity = await inspectFinalArtifact(project)
  requireThat(copyIdentity.identity.artifactSha256 === expectedArtifactSha256, 'Copied artifact changed')
  same(inventoryExecutionTree(project),copied)
  same(inventoryExecutionTree(source),original)
  const receipt = freeze({ source, runner, project, state, original, copied,
    runnerIdentity: info(fs.lstatSync(runner)), stateIdentity: info(fs.lstatSync(state)),
    artifactSha256: expectedArtifactSha256, qualified: false, launchAllowed: false })
  receipts.add(receipt)
  return receipt
}
/** Retain the actual preparer receipt in-process; untrusted deserialized receipts are refused. */
export function verifyExecutionCopy(receipt) {
  requireThat(receipts.has(receipt), 'Expected retained preparer receipt')
  ancestors(receipt.runner)
  requireThat(json(info(fs.lstatSync(receipt.runner))) === json(receipt.runnerIdentity), 'Runner identity changed')
  same(inventoryExecutionTree(receipt.source), receipt.original)
  const current = inventoryExecutionTree(receipt.project)
  const originals = new Set(receipt.copied.rows.map(r => r.path))
  const existing = current.rows.filter(r => originals.has(r.path))
  requireThat(json(existing) === json(receipt.copied.rows), 'Execution payload changed or disappeared')
  for (const row of current.rows) if (!originals.has(row.path)) {
    requireThat(row.path === '.wrangler' || row.path.startsWith('.wrangler/'), 'Unreviewed scratch addition')
    if (row.path === '.wrangler') requireThat(row.type === 'directory', 'Scratch root must be directory')
  }
  // Inventory already rejects every symlink, special file and multiply-linked file,
  // including scratch. State is outside the artifact and follows the same policy.
  const state = inventoryExecutionTree(receipt.state)
  requireThat(json(info(fs.lstatSync(receipt.state))) === json(receipt.stateIdentity), 'State root changed')
  independent(receipt.original,current); independent(receipt.original,state); independent(current,state)
  same(inventoryExecutionTree(receipt.source), receipt.original)
  return { endpointEquality: true, qualified: false, launchAllowed: false,
    limitation: 'Endpoint equality does not prove absence of transient mutation or filesystem containment' }
}

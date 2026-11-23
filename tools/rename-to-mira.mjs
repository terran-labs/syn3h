#!/usr/bin/env node
/**
 * Renames Syn3h to Mira across a checkout (owner's decision, 22 November 2026).
 *
 *   node tools/rename-to-mira.mjs [--dry-run] [--report out.json] [checkout]   apply the rename
 *   node tools/rename-to-mira.mjs --check [checkout]                         explain what is left
 *
 * The rename is a tool rather than a hand edit so that it can be read as rules plus a
 * keep-list, and rerun on any branch that still says Syn3h. Running it twice changes nothing
 * the second time. --check lists every remaining "syn3h" (any case) with the keep rule that
 * explains it and exits non-zero if any occurrence is unexplained.
 *
 * Case rules: Syn3h and Syn3H become Mira, syn3h becomes mira, SYN3H becomes MIRA. Any other
 * spelling is reported and left alone. docs/NAMES.md explains every kept name and what it
 * would take to change it. A line containing the marker `rename-keep` is never changed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Whole files left as they are. Category B (outside systems) and C (history), plus the machinery. */
export const KEEP_FILES = [
  { pattern: /^wrangler(\.staging)?\.toml$/, reason: 'B: Cloudflare Worker names, R2 bucket and routes; a renamed Worker is a new Worker with an empty Durable Object namespace' },
  { pattern: /^public\/brand\/(favicon\.svg|manifest\.webmanifest|apple-touch-icon\.png|icon-192\.png|icon-512\.png|share\.png)$|^public\/assets\/liquid-glass\/NOTICE\.md$/, reason: 'B: the bytes every frozen version loads from this address; the current files have new names (tools/frozen-versions.mjs prepare refuses any change here)' },
  { pattern: /^paseo\.json$/, reason: 'B: Vorteo preview service definitions, edited by the Foreman; its SYN3H_* variables still work through the legacy environment bridge' },
  { pattern: /^ops\/STATE\.md$/, reason: 'C: the Orchestrator updates its prose itself after the rename release' },
  { pattern: /^ops\/(DECISIONS|MORNING-HANDOFF)\.md$/, reason: 'C: dated decision records and handoffs' },
  { pattern: /^handoffs\//, reason: 'C: dated handoffs' },
  { pattern: /^docs\/CUTOVER\.md$/, reason: 'C: the record of the syn3h.com cutover' },
  { pattern: /^(PLANETS|WATER|VEGETATION)-LAB-BRIEF\.md$/, reason: 'C: dated lab briefs that quote the owner' },
  { pattern: /^tests\/vehicles2\/syn3h-actors\.md$|^tools\/models\/convert-syn3h-jet\.py$/, reason: 'C: inventory and converter of the original Syn3h Unity source' },
  { pattern: /^src\/ui\/brand\/mira\/|^tools\/brand\/mira-(round\d+|wordmark)\.ts$/, reason: 'C: the Mira logo lab, whose candidates are described against the Syn3h mark' },
  { pattern: /^docs\/MIRA-CUTOVER\.md$|^tools\/switch-domain(\.test)?\.mjs$/, reason: 'C: the address move, made while the game was still called Syn3h' },
  { pattern: /^tools\/rename-to-mira(\.test)?\.mjs$/, reason: 'the rename tool and its test name the old spelling on purpose' },
  { pattern: /^docs\/NAMES\.md$/, reason: 'the keep-list document names the old spelling on purpose' },
  { pattern: /^tools\/lib\/legacy-env\.(mjs|sh)$|^tools\/legacy_env\.py$|^tools\/lib\/legacy-page-names\.mjs$|^src\/core\/legacyWindowNames\.ts$|^tests\/core\/legacyWindowNames\.test\.ts$/, reason: 'legacy-name bridges (environment variables, window hooks); remove after 22 December 2026' },
]

/** Release notes of published versions are history (C). Read from release-notes/history.tsv. */
function publishedNotes(root) {
  const tsv = join(root, 'release-notes', 'history.tsv')
  if (!existsSync(tsv)) return new Set()
  const versions = readFileSync(tsv, 'utf8').split('\n').filter(l => /^v\d/.test(l)).map(l => l.split('\t')[0])
  return new Set(versions.flatMap(v => [`release-notes/releases/${v}.md`, `release-notes/player/${v}.md`]))
}

/**
 * Names inside otherwise renamed files that stay, each with its reason. Matched before any
 * replacement, so no rule can reach into them.
 */
export const KEEP_TOKENS = [
  { pattern: /buggy-syn3h/g, reason: "B wire: the default vehicle kind in shared/protocol.ts VEHICLE_KINDS, sent between players and stored in resume state; old pages must keep understanding it" },
  { pattern: /x-syn3h-version/g, reason: 'B: response header the Worker sets on frozen versions; tools/frozen-versions.mjs checks it' },
  { pattern: /syn3h-versions/g, reason: 'B: R2 bucket holding every frozen version' },
  { pattern: /syn3h(-staging)?\\?\.af-4e7\\?\.workers\\?\.dev/g, reason: 'B: workers.dev addresses of the production and staging Workers' },
  { pattern: /WORKER=syn3h\b|service\\?["']?\s*:\s*\\?["']syn3h/g, reason: 'B: the Worker name, which the Custom Domains API addresses (tools/domain.sh)' },
  { pattern: /syn3h-staging/g, reason: 'B: the staging Worker name' },
  { pattern: /(https?:\/\/)?([a-z0-9-]+\\?\.)*syn3h\\?\.com\b/gi, reason: 'B: the old address, which redirects to mira.cc; kept where it names the old host on purpose or is history' },
  { pattern: /terran-labs\/syn3h/g, reason: 'B: the GitHub repository, renamed by the owner later' },
  { pattern: /\.config\/syn3h\b/g, reason: 'B: the Cloudflare token path outside the repository' },
  { pattern: /\/Users\/vtn\/dev\/Syn3h(-wt|-stable)?/g, reason: 'B: folders on disk, which other tools depend on' },
  { pattern: /Syn3h-(stable|wt)\b/g, reason: 'B: folders on disk, which other tools depend on' },
  { pattern: /\/tmp\/syn3h[\w.$-]*/g, reason: 'B: temporary paths shared with older worktrees (above all the heavy job slots)' },
  { pattern: /syn3h-shot-/g, reason: 'B: the prefix of smoke evidence folders the release scripts make under /tmp' },
  { pattern: /syn3h-heavy-v2/g, reason: 'B: heavy job slot root shared by every worktree' },
  { pattern: /([Oo]riginal|[Oo]ld|Unity) Syn3h|Syn3h (Unity|prefab)/g, reason: "C: the original Syn3h game, ported from Unity; history, not this game's name" },
  { pattern: /syn3h-(client|player)[\w-]*/g, reason: 'C: names of the original Syn3h Unity source snapshots' },
  { pattern: /Syn3h in Action/g, reason: "C: the name of a panel on terranlabs.com" },
  { pattern: /rows\/syn3h\//g, reason: 'C: a path in the terranlabs.com repository' },
  { pattern: /LAST_SYN3H_VERSION|"## Syn3h vX"/g, reason: 'C: the release-notes cutoff between the two names (tools/release-notes.mjs)' },
  { pattern: /Syn3h (bytes|icons)/g, reason: 'C: names the old brand files frozen versions keep loading' },
  { pattern: /(called|named|formerly|was|released as) Syn3h/g, reason: 'C: says what the game used to be called' },
]

const CASES = { Syn3h: 'Mira', Syn3H: 'Mira', syn3h: 'mira', SYN3H: 'MIRA' }
const ANY = /syn3h/gi

/** Character ranges [start, end) that no rule may touch, each with the reason. */
function keptRanges(text) {
  const ranges = []
  for (const { pattern, reason } of KEEP_TOKENS) {
    pattern.lastIndex = 0
    for (const m of text.matchAll(pattern)) ranges.push([m.index, m.index + m[0].length, reason])
  }
  let at = 0
  for (const line of text.split('\n')) {
    if (line.includes('rename-keep')) ranges.push([at, at + line.length, 'marked rename-keep on its line'])
    at += line.length + 1
  }
  return ranges
}

/**
 * Applies the case rules to text outside the kept ranges.
 * Returns { text, counts: { 'Syn3h->Mira': n, ... }, kept: [{ reason, index }], odd: [spelling] }.
 */
export function renameText(text) {
  const ranges = keptRanges(text)
  const counts = {}, kept = [], odd = []
  const out = text.replace(ANY, (match, index) => {
    const range = ranges.find(([s, e]) => index >= s && index < e)
    if (range) { kept.push({ reason: range[2], index }); return match }
    const to = CASES[match]
    if (!to) { odd.push(match); return match }
    counts[`${match}->${to}`] = (counts[`${match}->${to}`] ?? 0) + 1
    return to
  })
  return { text: out, counts, kept, odd }
}

/** A path's new name: same rules, applied to each segment. */
export function renamePath(path) { return renameText(path).text }

const BRIDGE_COMMENT = 'legacy environment names, see docs/NAMES.md'
const isNodeScript = path => /\.(mjs|cjs|js|ts|mts)$/.test(path) && !/\.d\.m?ts$/.test(path) && !path.startsWith('src/') && !path.startsWith('public/')

/**
 * After the rename, MIRA_* variables are read first and SYN3H_* is the fallback, so scripts
 * outside the repository that still set SYN3H_* keep working. One bridge per language copies
 * each SYN3H_<X> to MIRA_<X> when MIRA_<X> is unset; every script that names a MIRA_ variable
 * loads it first.
 */
export function addBridge(path, text) {
  if (!/MIRA_[A-Z]/.test(text) || KEEP_FILES.some(k => k.pattern.test(path))) return text
  const lines = text.split('\n')
  if (isNodeScript(path) && /process\.env/.test(text)) {
    if (text.includes('legacy-env.mjs')) return text
    let rel = relative(dirname(path), 'tools/lib/legacy-env.mjs')
    if (!rel.startsWith('.')) rel = './' + rel
    const first = lines.findIndex(l => /^import\s/.test(l))
    const at = first >= 0 ? first : (lines[0]?.startsWith('#!') ? 1 : 0)
    lines.splice(at, 0, `import '${rel}' // ${BRIDGE_COMMENT}`)
    return lines.join('\n')
  }
  if (path.endsWith('.sh') && lines[0]?.startsWith('#!')) {
    if (text.includes('legacy-env.sh')) return text
    const rel = relative(dirname(path), 'tools/lib/legacy-env.sh')
    let at = 1
    while (at < lines.length && lines[at].startsWith('#')) at++
    lines.splice(at, 0, `. "$(dirname "$0")/${rel}" # ${BRIDGE_COMMENT}`)
    return lines.join('\n')
  }
  if (path.endsWith('.py') && path.startsWith('tools/') && path.split('/').length === 2) {
    if (text.includes('import legacy_env')) return text
    const first = lines.findIndex(l => /^(import|from)\s/.test(l))
    // From this file's own folder, so it also loads under runpy or another working directory.
    lines.splice(first >= 0 ? first : 0, 0, `import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import legacy_env  # noqa: E401,E702,F401  ${BRIDGE_COMMENT}`)
    return lines.join('\n')
  }
  return text
}

const sha = buf => createHash('sha256').update(buf).digest('hex')
const key = v => v.split('.').map(Number).reduce((k, n) => k * 10000 + n, 0)
const isBinary = buf => buf.subarray(0, 8000).includes(0)
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })

function keepFileReason(path, published) {
  if (published.has(path)) return 'C: release notes of a published version'
  return KEEP_FILES.find(k => k.pattern.test(path))?.reason
}

function apply(root, dryRun) {
  const published = publishedNotes(root)
  const files = git(root, 'ls-files', '-z').split('\0').filter(Boolean)
  const report = { changedFiles: 0, replacements: {}, renamed: [], keptFiles: {}, keptTokens: {}, odd: [], bridged: [] }
  const renames = []
  for (const path of files) {
    const full = join(root, path)
    if (!existsSync(full)) continue
    const reason = keepFileReason(path, published)
    const buf = readFileSync(full)
    if (reason) {
      const n = isBinary(buf) ? 0 : (buf.toString('utf8').match(ANY) ?? []).length
      if (n || ANY.test(path)) report.keptFiles[path] = { reason, occurrences: n }
      ANY.lastIndex = 0
      continue
    }
    if (!isBinary(buf)) {
      const before = buf.toString('utf8')
      const { text, counts, kept, odd } = renameText(before)
      for (const [k, v] of Object.entries(counts)) report.replacements[k] = (report.replacements[k] ?? 0) + v
      for (const { reason: r } of kept) report.keptTokens[r] = (report.keptTokens[r] ?? 0) + 1
      for (const o of odd) report.odd.push(`${path}: ${o}`)
      const target = renamePath(path)
      const bridged = addBridge(target, text)
      if (bridged !== text) report.bridged.push(target)
      if (bridged !== before) { report.changedFiles++; if (!dryRun) writeFileSync(full, bridged) }
    }
    const target = renamePath(path)
    if (target !== path) renames.push([path, target])
  }
  for (const [from, to] of renames) {
    report.renamed.push(`${from} -> ${to}`)
    if (!dryRun) { execFileSync('mkdir', ['-p', dirname(join(root, to))]); git(root, 'mv', from, to) }
  }
  return report
}

/** Every remaining occurrence, with the rule that explains it. */
function check(root) {
  const published = publishedNotes(root)
  const files = git(root, 'ls-files', '-z').split('\0').filter(Boolean)
  const explained = {}, unexplained = []
  const add = (reason, n = 1) => { explained[reason] = (explained[reason] ?? 0) + n }
  for (const path of files) {
    const full = join(root, path)
    if (!existsSync(full)) continue
    const reason = keepFileReason(path, published)
    const buf = readFileSync(full)
    const inName = (path.match(ANY) ?? []).length
    if (reason) { add(`${reason} [files]`, (isBinary(buf) ? 0 : (buf.toString('utf8').match(ANY) ?? []).length) + inName); continue }
    if (inName && renamePath(path) !== path) unexplained.push(`${path}: file name`)
    if (isBinary(buf)) continue
    const text = buf.toString('utf8')
    const { kept, counts, odd } = renameText(text)
    for (const k of kept) add(k.reason)
    const lines = text.split('\n')
    if (Object.keys(counts).length || odd.length) {
      for (let i = 0; i < lines.length; i++) {
        const r = renameText(lines[i])
        if (Object.keys(r.counts).length || r.odd.length) unexplained.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
      }
    }
  }
  // Published notes newer than release-notes.mjs's LAST_SYN3H_VERSION must not say Syn3h:
  // if one does, a Syn3h release shipped after the constant was set, and it must move.
  const tool = join(root, 'tools', 'release-notes.mjs')
  const last = existsSync(tool) && readFileSync(tool, 'utf8').match(/LAST_SYN3H_VERSION = 'v(\d+)\.(\d+)\.(\d+)'/)
  if (last) {
    const key = (a, b, c) => [a, b, c].map(Number).reduce((k, n) => k * 10000 + n, 0)
    for (const path of published) {
      const m = path.match(/releases\/v(\d+)\.(\d+)\.(\d+)\.md$/)
      if (!m || key(m[1], m[2], m[3]) <= key(last[1], last[2], last[3]) || !existsSync(join(root, path))) continue
      if (/^## Syn3h /m.test(readFileSync(join(root, path), 'utf8'))) unexplained.push(`${path}: says Syn3h but is newer than LAST_SYN3H_VERSION in tools/release-notes.mjs; move that constant`)
    }
  }
  // Files under public/ reach dist at the same address, which every frozen version also loads
  // from (static assets are not routed through the Worker). A renamed or redrawn file there would
  // give old pages new bytes; tools/frozen-versions.mjs prepare refuses such a release. Same rule
  // here, without a build: any tracked public file whose bytes differ from an archived version's
  // file at the same address needs a new name instead.
  const archive = process.env.MIRA_VERSION_ARCHIVE || join(root, '..', 'Syn3h-stable', 'versions')
  if (existsSync(archive)) {
    const versions = readdirSync(archive).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => key(a) - key(b))
    for (const path of files.filter(p => p.startsWith('public/'))) {
      const served = path.slice('public/'.length)
      const mine = existsSync(join(root, path)) ? sha(readFileSync(join(root, path))) : null
      const differs = versions.filter(v => existsSync(join(archive, v, served)) && sha(readFileSync(join(archive, v, served))) !== mine)
      if (differs.length) unexplained.push(`${path}: differs from the file ${differs.length} frozen versions serve at /${served} (newest ${differs.at(-1)}); give the new bytes a new name`)
    }
  } else unexplained.push(`frozen versions not found at ${archive}: set MIRA_VERSION_ARCHIVE to check public/ against them`)
  return { explained, unexplained }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
  const option = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v }
  const dryRun = flag('--dry-run'), checking = flag('--check'), reportFile = option('--report')
  const root = resolve(args[0] ?? git(process.cwd(), 'rev-parse', '--show-toplevel').trim())
  if (checking) {
    const { explained, unexplained } = check(root)
    const total = Object.values(explained).reduce((a, b) => a + b, 0)
    console.log(`Remaining "syn3h" occurrences (any case) in ${root}: ${total} explained, ${unexplained.length} unexplained.\n`)
    for (const [reason, n] of Object.entries(explained).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${reason}`)
    if (unexplained.length) { console.log('\nUnexplained:'); for (const u of unexplained) console.log(`  ${u}`) }
    process.exit(unexplained.length ? 1 : 0)
  }
  const report = apply(root, dryRun)
  if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  const total = Object.values(report.replacements).reduce((a, b) => a + b, 0)
  console.log(`${dryRun ? 'DRY RUN: ' : ''}${total} replacements in ${report.changedFiles} files; ${report.renamed.length} files renamed; ${report.bridged.length} scripts given the legacy environment bridge.`)
  for (const [k, v] of Object.entries(report.replacements)) console.log(`  ${k}: ${v}`)
  console.log('Renamed files:'); for (const r of report.renamed) console.log(`  ${r}`)
  console.log('Kept names inside renamed files:'); for (const [k, v] of Object.entries(report.keptTokens).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
  const byReason = {}
  for (const { reason, occurrences } of Object.values(report.keptFiles)) { byReason[reason] ??= { files: 0, occurrences: 0 }; byReason[reason].files++; byReason[reason].occurrences += occurrences }
  console.log('Kept files:'); for (const [k, v] of Object.entries(byReason)) console.log(`  ${String(v.occurrences).padStart(5)} in ${v.files} files  ${k}`)
  if (report.odd.length) { console.log('Other spellings left alone:'); for (const o of report.odd) console.log(`  ${o}`) }
}

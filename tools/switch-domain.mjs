#!/usr/bin/env node
/**
 * Moves the game's address from syn3h.com and www.syn3h.com to mira.cc (owner's decision, 22
 * November 2026; docs/MIRA-CUTOVER.md). The name Syn3h is not touched here: that is the rename's
 * job (tools/rename-to-mira.mjs, on its own branch).
 *
 *   node tools/switch-domain.mjs [--dry-run] [checkout]   move every old address outside history
 *   node tools/switch-domain.mjs --check [checkout]       list what is left, each with its reason;
 *                                                         exit 1 if anything is unexplained
 *
 * Every form of the old address (https, wss, apex, www, escaped in a regular expression) becomes
 * mira.cc. Running it twice changes nothing the second time. A line containing `rename-keep` is
 * never changed (the same marker the rename tool honours).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NEW_HOST = 'mira.cc'
const OLD = /(https?:\/\/|wss?:\/\/)?(www\\?\.)?syn3h(\\?\.)com\b/g

/** Whole files that keep the old address: history, and the tools that manage both zones. */
export const KEEP_FILES = [
  { pattern: /^ops\/(STATE|DECISIONS|MORNING-HANDOFF)\.md$/, reason: 'history: dated records (the Orchestrator updates STATE itself)' },
  { pattern: /^handoffs\//, reason: 'history: dated handoffs' },
  { pattern: /^docs\/CUTOVER\.md$/, reason: 'history: the record of the syn3h.com cutover' },
  { pattern: /^(PLANETS|WATER|VEGETATION)-LAB-BRIEF\.md$/, reason: 'history: dated lab briefs' },
  { pattern: /^wrangler(\.staging)?\.toml$/, reason: 'the Worker configuration; its comments describe the old hosts' },
  { pattern: /^paseo\.json$/, reason: 'Vorteo preview services' },
  { pattern: /^tools\/domain(\.sh|\.test\.mjs)$|^docs\/(DOMAIN-TOOL|MIRA-CUTOVER)\.md$/, reason: 'domain.sh and the runbooks manage both zones on purpose' },
  { pattern: /^tools\/rename-to-mira(\.test)?\.mjs$|^docs\/NAMES\.md$/, reason: 'the rename tool and its keep-list document name the old address on purpose' },
  { pattern: /^tools\/switch-domain(\.test)?\.mjs$|^tools\/release-address-checks\.test\.mjs$/, reason: 'this tool, and the test of the old-address checks, name the old address on purpose' },
]
const KEEP_TOKENS = [
  { pattern: /(www\.)?syn3h\.com\/backstory\.html/g, reason: 'a page of the old syn3h.com website' },
]

/** Release notes of published versions were written while the game lived at the old address. */
function publishedNotes(root) {
  const tsv = join(root, 'release-notes', 'history.tsv')
  if (!existsSync(tsv)) return new Set()
  const versions = readFileSync(tsv, 'utf8').split('\n').filter(l => /^v\d/.test(l)).map(l => l.split('\t')[0])
  return new Set(versions.flatMap(v => [`release-notes/releases/${v}.md`, `release-notes/player/${v}.md`]))
}

function keptRanges(text) {
  const ranges = []
  for (const { pattern, reason } of KEEP_TOKENS) { pattern.lastIndex = 0; for (const m of text.matchAll(pattern)) ranges.push([m.index, m.index + m[0].length, reason]) }
  let at = 0
  for (const line of text.split('\n')) { if (line.includes('rename-keep')) ranges.push([at, at + line.length, 'marked rename-keep on its line']); at += line.length + 1 }
  return ranges
}

/** Moves the old address to mira.cc outside kept ranges. Returns { text, count, kept: [reason] }. */
export function switchDomain(text) {
  const ranges = keptRanges(text)
  let count = 0
  const kept = []
  const out = text.replace(OLD, (match, scheme = '', _www, dot, index) => {
    const range = ranges.find(([s, e]) => index >= s && index < e)
    if (range) { kept.push(range[2]); return match }
    count++
    return `${scheme}${NEW_HOST.replace('.', dot)}`
  })
  return { text: out, count, kept }
}

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
const isBinary = buf => buf.subarray(0, 8000).includes(0)

function run(root, { dryRun, checking }) {
  const published = publishedNotes(root)
  const explained = {}, unexplained = []
  let moved = 0, files = 0
  for (const path of git(root, 'ls-files', '-z').split('\0').filter(Boolean)) {
    const full = join(root, path)
    if (!existsSync(full)) continue
    const buf = readFileSync(full)
    if (isBinary(buf)) continue
    const text = buf.toString('utf8')
    const occurrences = (text.match(OLD) ?? []).length
    if (!occurrences) continue
    const reason = published.has(path) ? 'history: release notes of a published version' : KEEP_FILES.find(k => k.pattern.test(path))?.reason
    if (reason) { explained[reason] = (explained[reason] ?? 0) + occurrences; continue }
    const result = switchDomain(text)
    for (const k of result.kept) explained[k] = (explained[k] ?? 0) + 1
    if (checking) {
      if (result.count) text.split('\n').forEach((line, i) => { if (switchDomain(line).count) unexplained.push(`${path}:${i + 1}: ${line.trim().slice(0, 160)}`) })
      continue
    }
    if (result.count) { moved += result.count; files++; if (!dryRun) writeFileSync(full, result.text) }
  }
  return { explained, unexplained, moved, files }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
  const dryRun = flag('--dry-run'), checking = flag('--check')
  const root = resolve(args[0] ?? git(process.cwd(), 'rev-parse', '--show-toplevel').trim())
  const { explained, unexplained, moved, files } = run(root, { dryRun, checking })
  if (!checking) console.log(`${dryRun ? 'DRY RUN: ' : ''}${moved} old addresses moved to ${NEW_HOST} in ${files} files.`)
  console.log('Old addresses left, by reason:')
  for (const [reason, n] of Object.entries(explained).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${reason}`)
  if (checking) {
    console.log(`${unexplained.length} unexplained.`)
    for (const u of unexplained) console.log(`  ${u}`)
    process.exit(unexplained.length ? 1 : 0)
  }
}

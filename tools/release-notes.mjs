#!/usr/bin/env node
// Calendar versions, release notes and GitHub releases for Syn3h. See release-notes/README.md.
//
//   node tools/release-notes.mjs next [--date <ISO time>]
//   node tools/release-notes.mjs versions
//   node tools/release-notes.mjs draft <version> <from-tag> <to-tag> [--force]
//   node tools/release-notes.mjs render <version> [--assets <dir>]
//   node tools/release-notes.mjs publish <version> [--assets <dir>] [--latest] --dry-run
//   node tools/release-notes.mjs publish <version> [--assets <dir>] [--latest] --yes-publish
//
// `publish` is the only subcommand that changes anything outside this checkout. It refuses
// to run without --yes-publish, and --dry-run prints every command it would run instead.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadApprovedPerformance, verifyPerformanceFiles, verifyPublishedPerformance } from './release-performance.mjs'
import { compareVersions, isVersion, kindLine, matchReleases, nextVersion, parseHistory, parseVersion, releasesFromTsv } from './lib/release-version.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NOTES_DIR = join(REPO, 'release-notes', 'releases')
const HISTORY = join(REPO, 'release-notes', 'history.tsv')
const GITHUB_REPO = process.env.SYN3H_GITHUB_REPO || 'terran-labs/syn3h'
const PLAY_URL = 'https://www.syn3h.com/'
/** The address that serves one frozen release for good (tools/frozen-versions.mjs). */
export function frozenUrl(version) {
  return `${PLAY_URL}?v=${String(version).replace(/^v/, '')}`
}
const MANIFEST = 'manifest.json'

/** Sections in the order a notes file has them. Play only in production notes. */
const SECTIONS = ['The story so far', 'Features', 'Fixes', 'Play', 'Performance', 'Known issues']
const REQUIRED = ['The story so far', 'Features']

/** Historical notes keep their original contract. */
export function requiresPerformance(row) {
  return row.channel === 'production' && compareVersions(parseVersion(row.version), parseVersion('v26.11.1518')) > 0
}

export function assetUrl(tag, name, repo = GITHUB_REPO) {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`
}

/**
 * Read an assets directory's manifest.json, written by the capture worker:
 * {"images":[{"file":"01-lobby.png","caption":"..."}], "gif":"syn3h-showcase.gif" or null}.
 * No directory, or no manifest, means no screenshots.
 */
export function readManifest(dir) {
  if (!dir) return { images: [], gif: null }
  const path = join(dir, MANIFEST)
  if (!existsSync(path)) throw new Error(`no ${MANIFEST} in ${dir}`)
  return parseManifest(readFileSync(path, 'utf8'))
}

export function parseManifest(text) {
  let data
  try { data = JSON.parse(text) } catch (error) { throw new Error(`${MANIFEST} is not JSON: ${error.message}`) }
  const images = data?.images ?? []
  if (!Array.isArray(images)) throw new Error(`${MANIFEST}: images must be a list`)
  const safe = (name) => typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== MANIFEST
  for (const [i, image] of images.entries()) {
    if (!safe(image?.file)) throw new Error(`${MANIFEST}: images[${i}].file must be a plain file name`)
    if (typeof image.caption !== 'string' || !image.caption.trim()) throw new Error(`${MANIFEST}: images[${i}] has no caption`)
    if (/[\[\]\n]/.test(image.caption)) throw new Error(`${MANIFEST}: images[${i}].caption may not contain brackets or line breaks`)
  }
  const gif = data?.gif ?? null
  if (gif !== null && !safe(gif)) throw new Error(`${MANIFEST}: gif must be a plain file name or null`)
  return { images: images.map((i) => ({ file: i.file, caption: i.caption.trim() })), gif }
}

/** The ### Screenshots section from a manifest, or '' when it has nothing to show. */
export function screenshotSection(tag, manifest, repo = GITHUB_REPO) {
  if (!manifest.gif && manifest.images.length === 0) return ''
  const lines = ['### Screenshots', '']
  if (manifest.gif) lines.push(`![Syn3h showcase](${assetUrl(tag, manifest.gif, repo)})`, '')
  for (const { file, caption } of manifest.images) lines.push(`![${caption}](${assetUrl(tag, file, repo)})`, `_${caption}_`, '')
  return lines.join('\n').trimEnd()
}

/** Commit subjects between two refs, oldest first, merges left out. */
function commitSubjects(from, to) {
  const out = execFileSync('git', ['log', '--reverse', '--no-merges', '--format=%h %s', `${from}..${to}`], { cwd: REPO, encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

/**
 * A notes file skeleton. The commit list sits in an HTML comment, which `render` strips, so
 * an unedited draft cannot publish commit subjects as release notes by accident.
 */
export function draftNotes(row, from, to, commits) {
  const production = row.channel === 'production'
  return [
    `## Syn3h ${row.version}`,
    '',
    'TODO: one line deck, the most meaningful outcomes, as "X, Y and Z"',
    '',
    kindLine(row),
    '',
    `<!-- Draft from git log ${from}..${to}, ${commits.length} commits. Rewrite these as shipped`,
    'behaviour for players, merge related lines, and delete this comment. Wording rule: tag',
    'beams, never lasers or weapons; vehicles get stuck in lava, never destroyed.',
    '',
    ...commits.map((c) => `- ${c.replace(/--/g, '- -')}`),
    '-->',
    '',
    '### The story so far',
    '',
    'TODO: three to six plain sentences on what happened in this stretch: what was decided, what went wrong, what changed direction',
    '',
    '### Features',
    '',
    '- TODO',
    '',
    '### Fixes',
    '',
    '- TODO',
    '',
    ...(production ? ['### Play', '', `Open ${PLAY_URL} in a browser, choose a vehicle and press Play.`, '', `This exact version stays playable at ${frozenUrl(row.version)}, whatever ships after it.`, '', '- TODO: the controls that matter for this release', ''] : []),
    ...(requiresPerformance(row) ? ['### Performance', '', 'TODO: insert the canonical qualified performance report and chart', ''] : []),
    '### Known issues',
    '',
    '- TODO: from ops/KNOWN-ISSUES.md as it stood when this was built',
    '',
  ].join('\n')
}

/**
 * The GitHub release body: the notes file with HTML comments removed and blank runs
 * collapsed, then the Screenshots section built from the manifest. Throws if the notes are
 * not in the agreed shape for the version's history row, or still hold a TODO.
 */
export function renderNotes(text, row, manifest = { images: [], gif: null }) {
  const tag = row.version
  const notes = text.replace(/^\(AI Generated\)\r?\n\r?\n/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  const lines = notes.split('\n')
  const problems = []
  // Accept historical heading-first sources; all rendered external bodies carry attribution.
  if (lines[0] !== `## Syn3h ${tag}`) problems.push(`the first line must be the heading "## Syn3h ${tag}"`)
  if (lines[1] !== '' || !lines[2] || lines[2].startsWith('#')) problems.push('a one line deck must follow the heading after a blank line')
  if (lines[4] !== kindLine(row)) problems.push(`the line under the deck must be "${kindLine(row)}"`)
  const found = lines.filter((l) => l.startsWith('### ')).map((l) => l.slice(4))
  for (const name of found) if (!SECTIONS.includes(name)) problems.push(`unexpected section "### ${name}"${name === 'Screenshots' ? ' (it is built from the assets manifest)' : ''}`)
  for (const name of REQUIRED) if (!found.includes(name)) problems.push(`missing "### ${name}"`)
  const order = found.filter((n) => SECTIONS.includes(n))
  if (order.join() !== SECTIONS.filter((n) => order.includes(n)).join()) problems.push(`sections must run in the order ${SECTIONS.join(', ')}`)
  if (found[0] !== 'The story so far') problems.push('"### The story so far" must be the first section')
  if (row.channel === 'production' && !found.includes('Play')) problems.push('production notes need "### Play"')
  if (row.channel !== 'production' && found.includes('Play')) problems.push('"### Play" belongs only in production notes')
  if (requiresPerformance(row) && !found.includes('Performance')) problems.push('production notes after v26.11.1518 need \"### Performance\"')
  if (/\bTODO\b/.test(notes)) problems.push('the notes still contain TODO')
  if (/[–—]/.test(notes)) problems.push('the notes contain an en or em dash')
  const banned = notes.match(/\b(lasers?|fire[sd]?|firing|shoot\w*|shot|weapons?|hit|hits|kill\w*|destroy\w*|death|dies?|died)\b/gi)
  if (banned) problems.push(`wording rule: ${[...new Set(banned.map((w) => w.toLowerCase()))].join(', ')}`)
  if (problems.length) throw new Error(`Notes for ${tag} are not ready:\n  ${problems.join('\n  ')}`)
  const shots = screenshotSection(tag, manifest)
  return `(AI Generated)\n\n${notes}\n${shots ? `\n${shots}\n` : ''}`
}

/** Every release-download URL the body links for this tag, by file name. */
/** Replace only the dedicated section, preserving all other release prose. */
export function withPerformanceSection(notes, markdown) {
  const normalized = notes.replace(/\r\n/g, '\n')
  if ((normalized.match(/^### Performance$/gm) ?? []).length !== 1) throw new Error('Expected exactly one Performance section')
  return normalized.replace(/^### Performance\n[\s\S]*?(?=^#{1,3} |$(?![\s\S]))/m, () => markdown.trimEnd() + '\n\n')
}

export function referencedAssets(body, tag, repo = GITHUB_REPO) {
  const prefix = `https://github.com/${repo}/releases/download/${tag}/`
  const names = new Set()
  for (const match of body.matchAll(/\]\((https:\/\/github\.com\/[^)\s]+)\)/g)) {
    if (match[1].startsWith(prefix)) names.add(match[1].slice(prefix.length))
  }
  return [...names]
}

function notesPath(tag) {
  return join(NOTES_DIR, `${tag}.md`)
}

function history() {
  return existsSync(HISTORY) ? parseHistory(readFileSync(HISTORY, 'utf8')) : []
}

function historyRow(tag) {
  const row = history().find((r) => r.version === tag)
  if (!row) throw new Error(`${tag} is not in release-notes/history.tsv; add its row first`)
  return row
}

function releasesTsvPath() {
  return process.env.SYN3H_RELEASES_TSV || resolve(REPO, '..', 'Syn3h-stable', 'releases.tsv')
}

/** releases.tsv rows, or null if this checkout has no record beside it. */
function recordedReleases() {
  const path = releasesTsvPath()
  return existsSync(path) ? releasesFromTsv(readFileSync(path, 'utf8')) : null
}

/** Every version known: history.tsv, local v tags and notes files, oldest first. */
function knownVersions() {
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: REPO, encoding: 'utf8' }).split('\n')
  const notes = existsSync(NOTES_DIR) ? readdirSync(NOTES_DIR).map((f) => f.replace(/\.md$/, '')) : []
  const all = new Set([...history().map((r) => r.version), ...tags, ...notes].filter(isVersion).map((v) => parseVersion(v).tag))
  return [...all].sort(compareVersions)
}

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function shellQuote(arg) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Resolve a ref to its full commit, or null. */
function commitOf(ref) {
  try { return run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() } catch { return null }
}

async function headStatus(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  return response.status
}

async function publish(tag, { assetsDir, dryRun, yes, latest }) {
  if (!dryRun && !yes) {
    throw new Error('publish creates a public GitHub release. Pass --dry-run to see the plan, or --yes-publish to do it.')
  }
  const row = historyRow(tag)
  const dir = assetsDir ? resolve(assetsDir) : null
  if (dir && (!existsSync(dir) || !statSync(dir).isDirectory())) throw new Error(`no assets directory at ${dir}`)
  const manifest = readManifest(dir)
  let notes = readFileSync(notesPath(tag), 'utf8'), performance = null
  if (requiresPerformance(row)) {
    const rows = history(), index = rows.findIndex(r => r.version === tag)
    const baseline = rows.slice(0, index).filter(r => r.channel === 'production').at(-1)
    if (!baseline || !dir) throw new Error('Performance publication requires the accepted baseline and an asset directory')
    performance = await loadApprovedPerformance({ version: tag, candidateCommit: commitOf(row.commit),
      baselineCommit: commitOf(baseline.commit), baselineVersion: baseline.version,
      assetBaseUrl: `https://github.com/${GITHUB_REPO}/releases/download/${tag}` })
    notes = withPerformanceSection(notes, performance.markdown)
  }
  const body = renderNotes(notes, row, manifest)
  const assets = [...(manifest.gif ? [manifest.gif] : []), ...manifest.images.map((i) => i.file), ...(performance ? performance.files.keys() : [])]
  if (new Set(assets).size !== assets.length) throw new Error('Performance assets conflict with showcase assets')

  const problems = []
  for (const name of assets) {
    const path = join(dir, name)
    if (performance?.files.has(name)) {
      if (existsSync(path) && !readFileSync(path).equals(performance.files.get(name))) problems.push(`existing performance bytes differ: ${name}`)
    } else if (!existsSync(path)) problems.push(`${MANIFEST} lists ${name}, which is not in ${dir}`)
    else if (statSync(path).size === 0) problems.push(`${name} is empty`)
  }
  for (const name of referencedAssets(body, tag)) if (!assets.includes(name)) problems.push(`the body links ${name}, which is not uploaded`)
  if (dir) {
    const extra = readdirSync(dir).filter((f) => !f.startsWith('.') && f !== MANIFEST && !assets.includes(f))
    if (extra.length) problems.push(`not in ${MANIFEST}, so not uploaded: ${extra.join(', ')}`)
  }

  // The commit comes from history.tsv. An existing tag must already point at it.
  const commit = commitOf(row.commit)
  const tagCommit = commitOf(`refs/tags/${tag}`)
  if (!commit) problems.push(`history.tsv says ${tag} is ${row.commit}, which is not in this repository`)
  if (tagCommit && commit && tagCommit !== commit) {
    problems.push(`tag ${tag} points at ${tagCommit.slice(0, 7)} but history.tsv says ${row.commit}; delete the old tag and release first (release-notes/README.md)`)
  }
  let release = null
  if (row.channel === 'production') {
    const releases = recordedReleases()
    if (!releases) problems.push(`production, but there is no releases.tsv at ${releasesTsvPath()} to check it against`)
    else {
      const { pairs, problems: mismatches } = matchReleases(history(), releases)
      release = pairs.find((p) => p.version === tag) ?? null
      problems.push(...mismatches.filter((m) => m.startsWith(tag)))
    }
  }

  const notesFile = dryRun ? '<temporary file holding the body below>' : join(mkdtempSync(join(tmpdir(), 'syn3h-notes-')), 'body.md')
  const steps = []
  if (!tagCommit && commit) {
    const message = `Syn3h ${tag} (${row.milestone}${release ? `, ${release.release}` : ''})`
    steps.push(['git', 'tag', '-a', tag, commit, '-m', message])
  }
  steps.push(['git', 'push', 'origin', `refs/tags/${tag}`])
  steps.push(['gh', 'release', 'create', tag, '--repo', GITHUB_REPO, '--verify-tag', '--title', `Syn3h ${tag}`,
    '--notes-file', notesFile, '--latest=false', ...assets.map((name) => join(dir, name))])

  const print = (line) => process.stdout.write(`${line}\n`)
  print(`${dryRun ? 'DRY RUN: ' : ''}publish Syn3h ${tag} to https://github.com/${GITHUB_REPO}/releases/tag/${tag}`)
  print(`Commit: ${commit ?? row.commit} (${row.milestone}, ${row.channel}, ${row.time}${release ? `, ${release.release}` : ''})`)
  print(`Marked Latest: ${latest ? 'only after all asset URLs pass verification' : 'no'}`)
  print(`Notes: ${notesPath(tag)}`)
  print(assets.length ? `Assets (${assets.length}) from ${dir}:` : 'Assets: none, so no Screenshots section')
  for (const name of assets) print(`  ${name}  ${performance?.files.get(name)?.length ?? (existsSync(join(dir, name)) ? statSync(join(dir, name)).size : 'missing')} bytes`)
  if (problems.length) {
    print('Problems:')
    for (const p of problems) print(`  ${p}`)
  }
  print('Commands:')
  for (const step of steps) print(`  ${step.map(shellQuote).join(' ')}`)
  if (assets.length) {
    print('Then check that each of these answers 200:')
    for (const name of assets) print(`  ${assetUrl(tag, name)}`)
  }
  if (latest) print(`After successful asset verification: gh release edit ${tag} --repo ${GITHUB_REPO} --latest`)
  if (dryRun) {
    print('Release body:')
    print('-----')
    process.stdout.write(body)
    print('-----')
    print(problems.length ? `DRY RUN: ${problems.length} problem(s); a real publish would stop before any command.` : 'DRY RUN: nothing was tagged, pushed or published.')
    return problems.length ? 1 : 0
  }
  if (problems.length) throw new Error('publish stopped before any command; see Problems above')

  let exists = false
  try { run('gh', ['release', 'view', tag, '--repo', GITHUB_REPO, '--json', 'tagName']); exists = true } catch { /* not there: good */ }
  if (exists) throw new Error(`a GitHub release for ${tag} already exists`)
  if (performance) {
    for (const [name, bytes] of performance.files) writeFileSync(join(dir, name), bytes)
    verifyPerformanceFiles(dir, performance)
  }
  writeFileSync(notesFile, body)
  for (const step of steps) {
    print(`$ ${step.map(shellQuote).join(' ')}`)
    execFileSync(step[0], step.slice(1), { cwd: REPO, stdio: 'inherit' })
  }
  let failed = 0
  for (const name of assets) {
    const url = assetUrl(tag, name)
    const status = await headStatus(url).catch((error) => `error ${error.message}`)
    print(`${status === 200 ? 'OK  ' : 'FAIL'} ${status} ${url}`)
    if (status !== 200) failed++
  }
  if (failed) throw new Error(`${failed} asset URL(s) did not answer 200`)
  if (performance) await verifyPublishedPerformance(`https://github.com/${GITHUB_REPO}/releases/download/${tag}`, performance)
  if (latest) execFileSync('gh', ['release', 'edit', tag, '--repo', GITHUB_REPO, '--latest'], { cwd: REPO, stdio: 'inherit' })
  print(`PUBLISHED: https://github.com/${GITHUB_REPO}/releases/tag/${tag}`)
  return 0
}

function option(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(argv) {
  const [command, ...args] = argv
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--assets', '--date'].includes(args[i - 1])))
  switch (command) {
    case 'next': {
      const when = option(args, '--date')
      console.log(nextVersion(when ? new Date(when) : new Date(), knownVersions()))
      return 0
    }
    case 'versions': {
      const releases = recordedReleases()
      const pairs = releases ? matchReleases(history(), releases) : { pairs: [], problems: [] }
      for (const r of history()) {
        const p = pairs.pairs.find((x) => x.version === r.version)
        console.log([r.version, r.milestone, r.commit, r.time, r.channel, p?.release ?? ''].join('\t').trimEnd())
      }
      for (const problem of pairs.problems) console.error(`warning: ${problem}`)
      return 0
    }
    case 'draft': {
      const [version, from, to] = positional
      if (!version || !from || !to) throw new Error('usage: draft <version> <from-tag> <to-tag> [--force]')
      const row = historyRow(parseVersion(version).tag)
      const path = notesPath(row.version)
      if (existsSync(path) && !args.includes('--force')) throw new Error(`${path} exists; pass --force to replace it`)
      writeFileSync(path, draftNotes(row, from, to, commitSubjects(from, to)))
      console.log(`Wrote ${path}`)
      return 0
    }
    case 'render': {
      const [version] = positional
      if (!version) throw new Error('usage: render <version> [--assets <dir>]')
      const row = historyRow(parseVersion(version).tag)
      const assets = option(args, '--assets')
      process.stdout.write(renderNotes(readFileSync(notesPath(row.version), 'utf8'), row, readManifest(assets && resolve(assets))))
      return 0
    }
    case 'publish': {
      const [version] = positional
      if (!version) throw new Error('usage: publish <version> [--assets <dir>] [--latest] (--dry-run | --yes-publish)')
      return publish(parseVersion(version).tag, {
        assetsDir: option(args, '--assets'), dryRun: args.includes('--dry-run'), yes: args.includes('--yes-publish'), latest: args.includes('--latest'),
      })
    }
    default:
      console.error('usage: node tools/release-notes.mjs <next | versions | draft | render | publish> ...')
      return 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (error) => {
    console.error(`release-notes: ${error.message}`)
    process.exitCode = 1
  })
}

#!/usr/bin/env node
// Calendar versions, release notes and GitHub releases for Syn3h production releases.
// See release-notes/README.md for the workflow.
//
//   node tools/release-notes.mjs next [--date <ISO time>]
//   node tools/release-notes.mjs versions
//   node tools/release-notes.mjs draft <version> <from-tag> <to-tag> [--force]
//   node tools/release-notes.mjs render <version>
//   node tools/release-notes.mjs publish <version> --assets <dir> --dry-run
//   node tools/release-notes.mjs publish <version> --assets <dir> --yes-publish
//
// `publish` is the only subcommand that changes anything outside this checkout. It refuses
// to run without --yes-publish, and --dry-run prints every command it would run instead.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, isVersion, nextVersion, parseVersion, releasesFromTsv } from './lib/release-version.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NOTES_DIR = join(REPO, 'release-notes', 'releases')
const GITHUB_REPO = process.env.SYN3H_GITHUB_REPO || 'terran-labs/syn3h'
const PLAY_URL = 'https://www.syn3h.com/'

/** Screenshots every release's notes link, captured from that release's frozen build. */
export const SHOWCASE = 'syn3h-showcase.gif'
export const SCREENSHOTS = [
  'lobby.png', 'buggy-volcano.png', 'wings-glide.png', 'bots-pursuit.png', 'tag-beam.png',
  'jet-flight.png', 'hovercraft-lava.png', 'lava-night.png', 'king-of-the-hill.png', 'other-world.png',
]

export function assetUrl(tag, name, repo = GITHUB_REPO) {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`
}

/** The ### Screenshots section, the GIF first, then one image per still. */
export function screenshotSection(tag, repo = GITHUB_REPO) {
  const title = (name) => name.replace(/\.(png|gif)$/, '').replace(/-/g, ' ')
  return [
    '### Screenshots',
    '',
    `![Syn3h showcase](${assetUrl(tag, SHOWCASE, repo)})`,
    '',
    ...SCREENSHOTS.map((name) => `![${title(name)}](${assetUrl(tag, name, repo)})`),
  ].join('\n')
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
export function draftNotes(tag, from, to, commits) {
  return [
    '(AI Generated)',
    '',
    `## Syn3h ${tag}`,
    '',
    'TODO: one line deck, the most meaningful outcomes, as "X, Y and Z"',
    '',
    `<!-- Draft from git log ${from}..${to}, ${commits.length} commits. Rewrite these as shipped`,
    'behaviour for players, merge related lines, and delete this comment. Wording rule: tag',
    'beams, never lasers or weapons; vehicles get stuck in lava, never destroyed.',
    '',
    ...commits.map((c) => `- ${c.replace(/--/g, '- -')}`),
    '-->',
    '',
    '### Features',
    '',
    '- TODO',
    '',
    '### Fixes',
    '',
    '- TODO',
    '',
    '### Play',
    '',
    `Open ${PLAY_URL} in a browser, choose a vehicle and press Play.`,
    '',
    '- TODO: the controls that matter for this release',
    '',
    '### Known issues',
    '',
    '- TODO: from ops/KNOWN-ISSUES.md as it stood when this release shipped',
    '',
    screenshotSection(tag),
    '',
  ].join('\n')
}

/**
 * The GitHub release body from a notes file: HTML comments removed, blank runs collapsed.
 * Throws if the file is not in the agreed shape or still holds a TODO.
 */
export function renderNotes(text, tag) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  const lines = body.split('\n')
  const problems = []
  if (lines[0] !== '(AI Generated)') problems.push('the first line must be exactly "(AI Generated)"')
  if (lines[1] !== '') problems.push('a blank line must follow "(AI Generated)"')
  if (lines[2] !== `## Syn3h ${tag}`) problems.push(`the heading must be "## Syn3h ${tag}"`)
  if (!lines[4] || lines[4].startsWith('#')) problems.push('a one line deck must follow the heading')
  for (const section of ['Features', 'Fixes', 'Play', 'Known issues', 'Screenshots']) {
    if (!lines.includes(`### ${section}`)) problems.push(`missing "### ${section}"`)
  }
  if (/\bTODO\b/.test(body)) problems.push('the notes still contain TODO')
  if (/[–—]/.test(body)) problems.push('the notes contain an en or em dash')
  if (problems.length) throw new Error(`Notes for ${tag} are not ready:\n  ${problems.join('\n  ')}`)
  return body
}

/** Every release-download URL the body links for this tag, by file name. */
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

function asTag(text) {
  return parseVersion(text).tag
}

function releasesTsvPath() {
  return process.env.SYN3H_RELEASES_TSV || resolve(REPO, '..', 'Syn3h-stable', 'releases.tsv')
}

/** releases.tsv rows with their versions, or [] if this checkout has no record beside it. */
function recordedReleases() {
  const path = releasesTsvPath()
  if (!existsSync(path)) return []
  return releasesFromTsv(readFileSync(path, 'utf8'))
}

/** Every version known: local v tags, notes files and releases.tsv, newest last. */
function knownVersions() {
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: REPO, encoding: 'utf8' }).split('\n')
  const notes = existsSync(NOTES_DIR) ? readdirSync(NOTES_DIR).map((f) => f.replace(/\.md$/, '')) : []
  const record = recordedReleases().map((r) => r.version)
  const all = new Set([...tags, ...notes, ...record].filter(isVersion).map(asTag))
  return [...all].sort(compareVersions)
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

function shellQuote(arg) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Resolve a ref to its full commit, or null. */
function commitOf(ref) {
  try { return run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() } catch { return null }
}

/** Ask a URL for its headers, following redirects. Returns the final status. */
async function headStatus(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  return response.status
}

async function publish(tag, { assetsDir, dryRun, yes }) {
  if (!dryRun && !yes) {
    throw new Error('publish creates a public GitHub release. Pass --dry-run to see the plan, or --yes-publish to do it.')
  }
  if (!assetsDir) throw new Error('publish needs --assets <dir>')
  const dir = resolve(assetsDir)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no assets directory at ${dir}`)
  const assets = readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()).sort()
  const body = renderNotes(readFileSync(notesPath(tag), 'utf8'), tag)

  // Every image the notes link must be uploaded, or the release page shows broken images.
  const missing = referencedAssets(body, tag).filter((name) => !assets.includes(name))
  const problems = missing.map((name) => `the notes link ${name}, which is not in ${dir}`)
  for (const name of assets) if (statSync(join(dir, name)).size === 0) problems.push(`${name} is empty`)

  // The commit: the version tag if it exists here, else the release-N commit from releases.tsv.
  const record = recordedReleases().find((r) => r.version === tag)
  const tagCommit = commitOf(tag)
  const recordCommit = record ? commitOf(record.commit) : null
  const commit = tagCommit || recordCommit
  if (!commit) problems.push(`no local tag ${tag} and no releases.tsv row with a commit for it`)
  if (tagCommit && recordCommit && tagCommit !== recordCommit) {
    problems.push(`tag ${tag} is ${tagCommit.slice(0, 7)} but releases.tsv says ${record.release} is ${recordCommit.slice(0, 7)}`)
  }

  const notesFile = dryRun ? `<temporary file holding the body below>` : join(mkdtempSync(join(tmpdir(), 'syn3h-notes-')), 'body.md')
  const steps = []
  if (!tagCommit && commit) {
    const message = record ? `Syn3h ${tag} (${record.release}, ${record.milestone})` : `Syn3h ${tag}`
    steps.push(['git', 'tag', '-a', tag, commit, '-m', message])
  }
  steps.push(['git', 'push', 'origin', `refs/tags/${tag}`])
  steps.push(['gh', 'release', 'create', tag, '--repo', GITHUB_REPO, '--verify-tag', '--title', `Syn3h ${tag}`, '--notes-file', notesFile,
    ...assets.map((name) => join(dir, name))])

  const print = (line) => process.stdout.write(`${line}\n`)
  print(`${dryRun ? 'DRY RUN: ' : ''}publish Syn3h ${tag} to https://github.com/${GITHUB_REPO}/releases/tag/${tag}`)
  print(`Commit: ${commit ?? 'unknown'}${record ? ` (${record.release}, ${record.milestone}, shipped ${record.shipped})` : ''}`)
  print(`Notes: ${notesPath(tag)}`)
  print(`Assets (${assets.length}) from ${dir}:`)
  for (const name of assets) print(`  ${name}  ${statSync(join(dir, name)).size} bytes`)
  if (problems.length) {
    print('Problems:')
    for (const p of problems) print(`  ${p}`)
  }
  print('Commands:')
  for (const step of steps) print(`  ${step.map(shellQuote).join(' ')}`)
  print('Then check that each of these answers 200:')
  for (const name of assets) print(`  ${assetUrl(tag, name)}`)
  if (dryRun) {
    print('Release body:')
    print('-----')
    process.stdout.write(body)
    print('-----')
    print(problems.length ? `DRY RUN: ${problems.length} problem(s); a real publish would stop before any command.` : 'DRY RUN: nothing was tagged, pushed or published.')
    return problems.length ? 1 : 0
  }
  if (problems.length) throw new Error('publish stopped before any command; see Problems above')

  // gh refuses to create a release that exists; check first for a clear message.
  try {
    run('gh', ['release', 'view', tag, '--repo', GITHUB_REPO, '--json', 'tagName'])
    throw new Error(`a GitHub release for ${tag} already exists`)
  } catch (error) {
    if (String(error.message).includes('already exists')) throw error
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
      const date = when ? new Date(when) : new Date()
      console.log(nextVersion(date, knownVersions()))
      return 0
    }
    case 'versions': {
      const record = new Map(recordedReleases().map((r) => [r.version, r]))
      for (const v of knownVersions()) {
        const r = record.get(v)
        console.log(r ? `${v}\t${r.release}\t${r.milestone}\t${r.commit}\t${r.shipped}` : v)
      }
      return 0
    }
    case 'draft': {
      const [version, from, to] = positional
      if (!version || !from || !to) throw new Error('usage: draft <version> <from-tag> <to-tag> [--force]')
      const tag = asTag(version)
      const path = notesPath(tag)
      if (existsSync(path) && !args.includes('--force')) throw new Error(`${path} exists; pass --force to replace it`)
      writeFileSync(path, draftNotes(tag, from, to, commitSubjects(from, to)))
      console.log(`Wrote ${path}`)
      return 0
    }
    case 'render': {
      const [version] = positional
      if (!version) throw new Error('usage: render <version>')
      const tag = asTag(version)
      process.stdout.write(renderNotes(readFileSync(notesPath(tag), 'utf8'), tag))
      return 0
    }
    case 'publish': {
      const [version] = positional
      if (!version) throw new Error('usage: publish <version> --assets <dir> (--dry-run | --yes-publish)')
      return publish(asTag(version), { assetsDir: option(args, '--assets'), dryRun: args.includes('--dry-run'), yes: args.includes('--yes-publish') })
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


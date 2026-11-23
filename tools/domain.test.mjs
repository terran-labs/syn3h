// tools/domain.sh against a stand-in Cloudflare API: a fake curl first on PATH that keeps the
// zone, its records, the Worker's Custom Domains and redirect rules in a JSON file. Nothing here
// reaches Cloudflare or any address.
// Bugs caught: attaching a host takes down another (wrangler's deploy replaced the whole Custom
// Domain set; a stand-in that drops www.syn3h.com on attach must fail the run loudly), a host
// outside its zone or an unknown zone, www.mira.cc served as a second origin, a removed record
// that was not exported, a rollback that detaches a host attached before, parking cleanup
// without confirmation, a redirect step that is not idempotent, and a dry run that changes
// anything or prints the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./domain.sh', import.meta.url))
const TOKEN = 'fake-token-domain-test-7f3a'

/** The fake curl: answers Cloudflare API calls from state.json and logs every call. */
const FAKE_CURL = `#!/usr/bin/env node
const fs = require('fs')
const file = process.env.FAKE_CF_STATE
const s = JSON.parse(fs.readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
try { fs.readFileSync(0) } catch {}
const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET'
const url = new URL(args.find(a => a.startsWith('https://')))
if (url.host !== 'api.cloudflare.com') {
  // A public address. www.mira.cc redirects once its rule exists; other hosts answer as
  // state.public says: { status, location, ws } (ws: the /ws upgrade answers 101).
  const rule = Object.values(s.rulesets).some(rs => rs.rules.some(r => r.description === 'www.mira.cc to mira.cc'))
  const pub = url.host === 'www.mira.cc' && rule ? { status: 302, location: 'https://mira.cc' + url.pathname + url.search } : s.public[url.host]
  if (args.includes('Upgrade: websocket')) { process.stdout.write(pub?.ws ? '101' : '000'); process.exit(pub?.ws ? 28 : 7) }
  if (!pub) { process.stdout.write('000 '); process.exit(6) }
  process.stdout.write(pub.status + ' ' + (pub.location ?? '')); process.exit(0)
}
// A transient failure of the route to the API: no answer at all.
if ((s.failApi ?? []).some(prefix => url.pathname.replace('/client/v4', '').startsWith(prefix))) process.exit(7)
const body = args.includes('--data') ? JSON.parse(args[args.indexOf('--data') + 1]) : undefined
const path = url.pathname.replace('/client/v4', '')
s.log.push([method, path + url.search, body ?? null])
const ok = (result) => ({ success: true, errors: [], result })
let out
const zone = s.zones.find(z => z.name === url.searchParams.get('name'))
let m
if (method === 'GET' && path === '/zones') out = ok(zone ? [{ id: zone.id, name: zone.name, account: { id: 'acct-1' } }] : [])
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/dns_records$/)) && method === 'GET') out = ok(s.records.filter(r => r.zone_id === m[1]))
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/dns_records\\/export$/))) { process.stdout.write('; zone file'); process.exit(0) }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/dns_records$/)) && method === 'POST') { const r = { id: 'rec-' + s.log.length, zone_id: m[1], ...body }; s.records.push(r); out = ok(r) }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/dns_records\\/([^/]+)$/)) && method === 'DELETE') { s.records = s.records.filter(r => r.id !== m[2]); out = ok({ id: m[2] }) }
else if (path === '/accounts/acct-1/workers/domains' && method === 'GET') out = ok(s.domains.filter(d => [...url.searchParams].every(([k, v]) => d[k] === v)))
else if (path === '/accounts/acct-1/workers/domains' && method === 'PUT') {
  if (s.dropOnAttach) s.domains = s.domains.filter(d => d.hostname !== s.dropOnAttach)
  const d = { id: 'dom-' + s.log.length, ...body }; s.domains.push(d); out = ok(d)
}
else if ((m = path.match(/^\\/accounts\\/acct-1\\/workers\\/domains\\/([^/]+)$/)) && method === 'DELETE') { s.domains = s.domains.filter(d => d.id !== m[1]); out = ok(null) }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/rulesets\\/phases\\/http_request_dynamic_redirect\\/entrypoint$/))) out = s.rulesets[m[1]] ? ok(s.rulesets[m[1]]) : { success: false, errors: [{ code: 10003, message: 'not found' }] }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/rulesets$/)) && method === 'POST') { s.rulesets[m[1]] = { id: 'rs-1', ...body, rules: body.rules.map((r, i) => ({ id: 'rule-' + i, ...r })) }; out = ok(s.rulesets[m[1]]) }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/rulesets\\/([^/]+)\\/rules$/)) && method === 'POST') { const rs = s.rulesets[m[1]]; rs.rules.push({ id: 'rule-' + rs.rules.length, ...body }); out = ok(rs) }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/rulesets\\/([^/]+)\\/rules\\/([^/]+)$/)) && method === 'DELETE') { const rs = s.rulesets[m[1]]; rs.rules = rs.rules.filter(r => r.id !== m[3]); out = ok(rs) }
else if ((m = path.match(/^\\/zones\\/([^/]+)\\/pagerules$/))) out = ok([])
else out = { success: false, errors: [{ message: 'fake curl: unexpected ' + method + ' ' + path }] }
fs.writeFileSync(file, JSON.stringify(s))
process.stdout.write(JSON.stringify(out))
`

function world(fn, { dropOnAttach = null, extraDomains = [], publicHosts = {}, failApi = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-domain-test-'))
  try {
    const store = join(dir, 'store'), bin = join(dir, 'bin'), state = join(dir, 'state.json')
    mkdirSync(store); mkdirSync(bin)
    const rec = (id, type, name, content, zone = 'zone-mira', zone_name = 'mira.cc') => ({ id, zone_id: zone, zone_name, type, name, content, proxied: true, ttl: 1 })
    writeFileSync(state, JSON.stringify({
      log: [], rulesets: {}, dropOnAttach, public: publicHosts, failApi,
      zones: [{ id: 'zone-mira', name: 'mira.cc' }, { id: 'zone-syn', name: 'syn3h.com' }],
      // The registrar's imported parking records, as the Orchestrator found them, plus mail.
      records: [rec('r-apex', 'A', 'mira.cc', '192.64.119.207'), rec('r-www', 'A', 'www.mira.cc', '192.64.119.207'),
        rec('r-star', 'A', '*.mira.cc', '192.64.119.207'), { ...rec('r-mx', 'MX', 'mira.cc', 'mail.example'), proxied: false },
        rec('r-syn-www', 'A', 'www.syn3h.com', '104.21.92.125', 'zone-syn', 'syn3h.com')],
      domains: [{ id: 'dom-live', hostname: 'www.syn3h.com', service: 'syn3h', zone_id: 'zone-syn' }, ...extraDomains],
    }))
    writeFileSync(join(bin, 'curl'), FAKE_CURL, { mode: 0o755 })
    const run = (args, { token = true, env = {} } = {}) => spawnSync('/bin/sh', [script, ...args], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, FAKE_CF_STATE: state, SYN3H_DOMAIN_STORE: store,
        SYN3H_CLOUDFLARE_TOKEN_FILE: join(dir, 'no-token-file'), ...(token ? { CLOUDFLARE_API_TOKEN: TOKEN } : {}), ...env },
    })
    const read = () => JSON.parse(readFileSync(state, 'utf8'))
    const exportDir = (zone) => { const d = readdirSync(join(store, 'dns')).filter(n => n.endsWith('-' + zone)).sort().at(-1); return d && join(store, 'dns', d) }
    const setState = (patch) => writeFileSync(state, JSON.stringify({ ...read(), ...patch }))
    fn({ run, read, setState, exportDir, changes: () => read().log.filter(([method]) => method !== 'GET') })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr)
const fails = (r, pattern) => { assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, pattern) }

test('the zone is a parameter with an allow-list, and hosts must belong to it', () => world(({ run }) => {
  fails(run(['export', '--zone', 'example.com']), /refusing zone example\.com: only syn3h\.com mira\.cc/)
  fails(run(['attach', 'mira.cc', 'www.syn3h.com', '--owner-approved']), /one hostname at a time/)
  fails(run(['attach', 'www.syn3h.com', '--zone', 'mira.cc', '--owner-approved']), /refusing host www\.syn3h\.com: only mira\.cc and www\.mira\.cc/)
  fails(run(['attach', 'www.mira.cc', '--owner-approved']), /must only redirect to mira\.cc/)
  fails(run(['attach', 'mira.cc']), /--owner-approved/)
  fails(run(['attach', 'mira.cc', '--owner-aproved']), /unknown option --owner-aproved/)
  fails(run(['clean-parking', '--zone', 'syn3h.com', '--confirm-delete']), /mira\.cc zone only/)
  fails(run(['attach', 'mira.cc', '--owner-approved']), /no export of mira\.cc from the last two hours/)
}))

test('attach removes only the exported record at the host, attaches it alone, and keeps www.syn3h.com', () => world(({ run, read, exportDir, changes }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  assert.ok(existsSync(join(exportDir('mira.cc'), 'worker-domains.json')))
  const before = changes().length
  const out = run(['attach', 'mira.cc', '--owner-approved'])
  ok(out)
  assert.deepEqual(changes().slice(before), [
    ['DELETE', '/zones/zone-mira/dns_records/r-apex', null],
    ['PUT', '/accounts/acct-1/workers/domains', { hostname: 'mira.cc', service: 'syn3h', zone_id: 'zone-mira' }],
  ])
  assert.deepEqual(read().domains.map(d => d.hostname).sort(), ['mira.cc', 'www.syn3h.com'])
  assert.match(out.stdout, /Still attached: www\.syn3h\.com mira\.cc/)
  assert.ok(!out.stdout.includes(TOKEN) && !out.stderr.includes(TOKEN))
  ok(run(['attach', 'mira.cc', '--owner-approved']))
  assert.equal(changes().length, before + 2, 'a second attach changed something')
}))

test('attach fails loudly if a host attached before is gone afterwards', () => world(({ run }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  fails(run(['attach', 'mira.cc', '--owner-approved']), /LOST: www\.syn3h\.com is no longer attached/)
}, { dropOnAttach: 'www.syn3h.com' }))

test('rollback detaches only what attach added and restores its record', () => world(({ run, read, exportDir }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  ok(run(['attach', 'mira.cc', '--owner-approved']))
  const ex = exportDir('mira.cc')
  fails(run(['rollback', ex, 'www.syn3h.com']), /refusing host www\.syn3h\.com: only mira\.cc/)
  ok(run(['export', '--zone', 'syn3h.com']))
  fails(run(['rollback', exportDir('syn3h.com'), 'www.syn3h.com']), /refusing to detach www\.syn3h\.com: it was attached before/)
  ok(run(['rollback', ex, 'mira.cc']))
  const s = read()
  assert.deepEqual(s.domains.map(d => d.hostname), ['www.syn3h.com'])
  assert.ok(s.records.some(r => r.name === 'mira.cc' && r.type === 'A' && r.content === '192.64.119.207'))
}))

test('clean-parking lists exactly the parking records, needs confirmation, and restore undoes it', () => world(({ run, read, exportDir, changes }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  const listed = run(['clean-parking'])
  fails(listed, /--confirm-delete/)
  assert.match(listed.stdout, /A www\.mira\.cc -> 192\.64\.119\.207[\s\S]*A \*\.mira\.cc -> 192\.64\.119\.207/)
  assert.doesNotMatch(listed.stdout, /MX|A mira\.cc ->/)
  assert.equal(changes().length, 0)
  ok(run(['clean-parking', '--confirm-delete']))
  assert.deepEqual(changes().map(([m, p]) => `${m} ${p}`).sort(), ['DELETE /zones/zone-mira/dns_records/r-star', 'DELETE /zones/zone-mira/dns_records/r-www'])
  ok(run(['restore', exportDir('mira.cc'), '*.mira.cc', 'www.mira.cc']))
  assert.deepEqual(read().records.filter(r => r.name !== 'mira.cc' && r.zone_id === 'zone-mira').map(r => r.name).sort(), ['*.mira.cc', 'www.mira.cc'])
}))

test('redirect-www needs the parking record gone, then sets it up once', () => world(({ run, read, exportDir, changes }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  fails(run(['redirect-www', '--owner-approved']), /www\.mira\.cc still has other records \(A 192\.64\.119\.207\): run tools\/domain\.sh clean-parking first/)
  ok(run(['clean-parking', '--confirm-delete']))
  ok(run(['export', '--zone', 'mira.cc']))
  const out = run(['redirect-www', '--owner-approved', '--dry-run'])
  ok(out)
  assert.match(out.stderr, /DRY RUN: POST https:\/\/api\.cloudflare\.com\/client\/v4\/zones\/zone-mira\/dns_records \{"type":"AAAA","name":"www\.mira\.cc","content":"100::","proxied":true,"ttl":1/)
  assert.match(out.stderr, /DRY RUN: POST .*\/zones\/zone-mira\/rulesets \{"name":"redirects","kind":"zone","phase":"http_request_dynamic_redirect","rules":\[\{"description":"www\.mira\.cc to mira\.cc","expression":"\(http\.host eq \\"www\.mira\.cc\\"\)","action":"redirect","action_parameters":\{"from_value":\{"status_code":302,"preserve_query_string":true,"target_url":\{"expression":"concat\(\\"https:\/\/mira\.cc\\", http\.request\.uri\.path\)"\}\}\}\}\]\}/)
  assert.ok(!out.stderr.includes(TOKEN) && !out.stdout.includes(TOKEN))
  const before = changes().length
  // The stand-in answers the closing check of https://www.mira.cc/ once the rule exists.
  ok(run(['redirect-www', '--owner-approved']))
  const s = read()
  assert.ok(s.records.some(r => r.name === 'www.mira.cc' && r.type === 'AAAA' && r.content === '100::' && r.proxied))
  assert.deepEqual(s.rulesets['zone-mira'].rules.map(r => r.description), ['www.mira.cc to mira.cc'])
  const after = changes().length
  assert.equal(after - before, 2)
  ok(run(['redirect-www', '--owner-approved']))
  assert.equal(changes().length, after, 'a second redirect-www changed something')
  ok(run(['redirect-www-rollback', exportDir('mira.cc')]))
  const undone = read()
  assert.deepEqual(undone.rulesets['zone-mira'].rules, [])
  assert.ok(!undone.records.some(r => r.name === 'www.mira.cc'))
}))

test('a dry run without a token prints every change and makes no call', () => world(({ run, read, exportDir }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  const calls = read().log.length
  const out = run(['attach', 'mira.cc', '--owner-approved', '--dry-run'], { token: false })
  ok(out)
  assert.match(out.stderr, /DRY RUN: DELETE https:\/\/api\.cloudflare\.com\/client\/v4\/zones\/zone-mira\/dns_records\/r-apex/)
  assert.match(out.stderr, /DRY RUN: PUT https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/\{account_id\}\/workers\/domains \{"hostname":"mira\.cc","service":"syn3h","zone_id":"zone-mira"\}/)
  assert.match(out.stdout, /Attached before: www\.syn3h\.com/)
  assert.equal(read().log.length, calls, 'a dry run without a token called the API')
  assert.ok(!existsSync(join(exportDir('mira.cc'), 'attached-mira.cc.json')))
}))

// After the switch (docs/MIRA-CUTOVER.md, step 7): www.syn3h.com redirects to mira.cc and stays
// attached only for its socket; mira.cc serves the game.
const switched = {
  extraDomains: [{ id: 'dom-mira', hostname: 'mira.cc', service: 'syn3h', zone_id: 'zone-mira' }],
  publicHosts: {
    'www.syn3h.com': { status: 302, location: 'https://mira.cc/', ws: true },
    'mira.cc': { status: 200, ws: true },
  },
}

test('after the switch, check www.syn3h.com reports the redirect and the socket instead of failing', () => world(({ run }) => {
  ok(run(['export', '--zone', 'syn3h.com']))
  const out = run(['check', 'www.syn3h.com'], { env: { SYN3H_SHORT_CHECK: '1' } })
  ok(out)
  assert.match(out.stdout, /Redirect ok, certificate verified: https:\/\/www\.syn3h\.com\/ -> https:\/\/mira\.cc\//)
  assert.match(out.stdout, /WSS ok: upgrade to \/ws on www\.syn3h\.com/)
  assert.match(out.stdout, /Still attached: mira\.cc www\.syn3h\.com/)
  assert.match(out.stdout, /Still serving: https:\/\/mira\.cc\//)
  assert.match(out.stdout, /CHECK OK: www\.syn3h\.com redirects to mira\.cc and keeps its socket/)
}, switched))

test('a previously attached host may redirect to mira.cc only if its socket still upgrades', () => world(({ run, setState }) => {
  ok(run(['export', '--zone', 'mira.cc']))
  setState({ public: { 'www.syn3h.com': { status: 302, location: 'https://mira.cc/', ws: false }, 'mira.cc': { status: 302, location: 'https://mira.cc/', ws: true } } })
  fails(run(['check', 'mira.cc']), /https:\/\/www\.syn3h\.com\/ redirects to mira\.cc but wss:\/\/www\.syn3h\.com\/ws did not upgrade/)
  setState({ public: { 'www.syn3h.com': { status: 301, location: 'https://elsewhere.example/', ws: true }, 'mira.cc': { status: 302, location: 'https://mira.cc/', ws: true } } })
  fails(run(['check', 'mira.cc']), /https:\/\/www\.syn3h\.com\/, attached before, answered "301 https:\/\/elsewhere\.example\/"/)
  setState({ public: { 'www.syn3h.com': { status: 302, location: 'https://mira.cc/', ws: true }, 'mira.cc': { status: 302, location: 'https://mira.cc/', ws: true } } })
  assert.match(run(['check', 'mira.cc']).stdout, /Still attached for its socket: https:\/\/www\.syn3h\.com\/ redirects to mira\.cc, wss:\/\/www\.syn3h\.com\/ws upgrades/)
}, switched))

test("release.sh's short check survives a failed API read, but never a host missing from a list it read", () => world(({ run, setState }) => {
  ok(run(['export', '--zone', 'syn3h.com']))
  setState({ failApi: ['/zones', '/accounts'] })
  const short = run(['check', 'www.syn3h.com'], { env: { SYN3H_SHORT_CHECK: '1' } })
  ok(short)
  assert.match(short.stderr, /WARNING: could not read the account from the API; attachment of mira\.cc www\.syn3h\.com not verified/)
  fails(run(['check', 'www.syn3h.com']), /could not read the account from the API/)
  setState({ failApi: ['/accounts'] })
  const listFails = run(['check', 'www.syn3h.com'], { env: { SYN3H_SHORT_CHECK: '1' } })
  ok(listFails)
  assert.match(listFails.stderr, /WARNING: could not read the Worker's domains from the API/)
  setState({ failApi: [], domains: [{ id: 'dom-live', hostname: 'www.syn3h.com', service: 'syn3h', zone_id: 'zone-syn' }] })
  fails(run(['check', 'www.syn3h.com'], { env: { SYN3H_SHORT_CHECK: '1' } }), /LOST: mira\.cc is no longer attached/)
}, switched))

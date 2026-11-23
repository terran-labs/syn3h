// The rename to Mira must never touch a name that goes over the wire. If it did, a page already
// open on an older build would stop understanding a new player's vehicle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addBridge, renameText } from './rename-to-mira.mjs'

test('the protocol vehicle kind list is byte-identical after the rename', () => {
  const source = readFileSync(new URL('../shared/protocol.ts', import.meta.url), 'utf8')
  const kinds = source.split('\n').find((l) => l.includes('export const VEHICLE_KINDS'))
  assert.ok(kinds.includes("'buggy-syn3h'"))
  const renamed = renameText(source).text.split('\n').find((l) => l.includes('export const VEHICLE_KINDS'))
  assert.equal(renamed, kinds)
})

test('case rules, kept names and idempotence', () => {
  const before = "Syn3h's syn3h.quality.v2 SYN3H_URL window.syn3hNet 'buggy-syn3h' https://www.syn3h.com/ /tmp/syn3h-heavy-v2 the original Syn3h game"
  const once = renameText(before).text
  assert.equal(once, "Mira's mira.quality.v2 MIRA_URL window.miraNet 'buggy-syn3h' https://www.syn3h.com/ /tmp/syn3h-heavy-v2 the original Syn3h game")
  assert.equal(renameText(once).text, once)
  assert.equal(renameText('x = "Syn3h" // rename-keep').text, 'x = "Syn3h" // rename-keep')
  // The domain written as a regular expression in a test stays too.
  assert.equal(renameText(String.raw`/www\.syn3h\.com\/\?v=/`).text, String.raw`/www\.syn3h\.com\/\?v=/`)
})

test('scripts that read a MIRA_ variable load the legacy bridge first, once', () => {
  const js = addBridge('tools/x.mjs', "import a from 'a'\nconst u = process.env.MIRA_URL\n")
  assert.equal(js.split('\n')[0], "import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md")
  assert.equal(addBridge('tools/x.mjs', js), js)
  const sh = addBridge('tests/ui/run.sh', '#!/bin/sh\n# comment\necho "$MIRA_URL"\n')
  assert.equal(sh.split('\n')[2], '. "$(dirname "$0")/../../tools/lib/legacy-env.sh" # legacy environment names, see docs/NAMES.md')
  assert.equal(addBridge('src/a.ts', 'const MIRA_X = 1\nprocess.env'), 'const MIRA_X = 1\nprocess.env')
})

test('the Worker name that tools/domain.sh sends to the Custom Domains API stays syn3h', () => {
  for (const line of ['WORKER=syn3h', "{ hostname: 'mira.cc', service: 'syn3h', zone_id: 'z' }", '{"hostname":"mira.cc","service":"syn3h"}', '`service: "syn3h"`'])
    assert.equal(renameText(line).text, line)
})

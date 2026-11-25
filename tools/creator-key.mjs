#!/usr/bin/env node
/**
 * Make a new creator key (server/creator.ts). Prints ONLY its SHA-256, for
 *   npx wrangler secret put CREATOR_KEY_SHA256                       (production)
 *   npx wrangler secret put CREATOR_KEY_SHA256 -c wrangler.staging.toml   (staging, beta.mira.cc)
 * and writes the activation links, which hold the key itself, to
 * ~/.config/syn3h/creator-links.txt (mode 600): first the bare key, to paste into Settings >
 * Dimensional portal (revealed by five taps on the lobby's version label), the primary route and the
 * only one into an iPhone Home Screen app; then the links, which work but stay in that browser's
 * history and history sync. The key is never printed.
 *
 * Rotation: rerun this, set the new hash on both Workers, and paste the new key on each device.
 * Devices holding the old key lose the badge at their next join.
 *
 *   node tools/creator-key.mjs
 */
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOSTS = ['https://mira.cc', 'https://beta.mira.cc']
// 24 bytes = 192 bits, 32 base64url characters (server/creator.ts KEY_PATTERN).
const key = randomBytes(24).toString('base64url')
const hash = createHash('sha256').update(key).digest('hex')

const dir = join(homedir(), '.config', 'syn3h')
mkdirSync(dir, { recursive: true, mode: 0o700 })
const file = join(dir, 'creator-links.txt')
const body = [
  `# Mira creator key, made ${new Date().toISOString()}. Private: anyone with it can wear the creator mark.`,
  `# Key SHA-256 (the CREATOR_KEY_SHA256 secret): ${hash}`,
  '',
  '# Paste it in: tap the version label five times in the lobby, then open Settings >',
  '# Dimensional portal, paste and press Open. Once on each device, the iPhone Home Screen app too.',
  `Key: ${key}`,
  '',
  '# Links, the second way. A link leaves the key in that browser\'s history, and in history',
  '# sync if it is on: use one only on a browser you do not sync, and delete the history entry',
  '# afterwards. A Home Screen app cannot be reached by a link at all.',
  ...HOSTS.map((host) => `${host}/#creator=${key}`),
  '',
].join('\n')
writeFileSync(file, body, { mode: 0o600 })
chmodSync(file, 0o600) // an existing file keeps its old mode through writeFileSync
console.log(hash)
console.error(`Links written to ${file} (mode 600). Set the hash above as CREATOR_KEY_SHA256 on both Workers.`)

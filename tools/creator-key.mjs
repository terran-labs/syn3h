#!/usr/bin/env node
/**
 * Make a new creator key (server/creator.ts). Prints ONLY its SHA-256, for
 *   npx wrangler secret put CREATOR_KEY_SHA256                       (production)
 *   npx wrangler secret put CREATOR_KEY_SHA256 -c wrangler.staging.toml   (staging, beta.mira.cc)
 * and writes the activation links, which hold the key itself, to
 * ~/.config/syn3h/creator-links.txt (mode 600). The owner opens a link once on each device;
 * the page stores the key and removes it from the address bar. The key is never printed.
 *
 * Rotation: rerun this, set the new hash on both Workers, and open the new link on each device.
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
  `# Mira creator links, made ${new Date().toISOString()}. Private: anyone with a link can wear the badge.`,
  '# Open one once on each of your devices; the page keeps the key and clears it from the address bar.',
  `# Key SHA-256 (the CREATOR_KEY_SHA256 secret): ${hash}`,
  ...HOSTS.map((host) => `${host}/#creator=${key}`),
  '',
].join('\n')
writeFileSync(file, body, { mode: 0o600 })
chmodSync(file, 0o600) // an existing file keeps its old mode through writeFileSync
console.log(hash)
console.error(`Links written to ${file} (mode 600). Set the hash above as CREATOR_KEY_SHA256 on both Workers.`)

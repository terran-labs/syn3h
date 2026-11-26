/**
 * What a host serves for a frozen file (ops/RELEASE.md, beta channel). Production hosts serve the
 * frozen bytes exactly. A beta host (shared/channel.ts: beta.* and any workers.dev address, which
 * includes production's own workers.dev name) serves HTML and plain text with every
 * https://mira.cc/ rewritten to its own origin, and HTML with X-Robots-Tag: noindex (server/worker.ts,
 * forBeta). Checkers compare what was served against `expectedServed`, never the raw frozen bytes.
 */
import { channelOf } from '../../shared/channel.ts'

export const isBetaHost = (base) => channelOf(new URL(base).hostname) === 'beta'

/** Is `contentType` one the beta Worker rewrites (forBeta: text/html and text/plain)? */
export const rewritten = (contentType) => /^text\/(html|plain)\b/i.test(contentType ?? '')

/** The bytes `base` should serve for a frozen file with this content type. */
export function expectedServed(bytes, base, contentType) {
  if (!isBetaHost(base) || !rewritten(contentType)) return bytes
  return Buffer.from(Buffer.from(bytes).toString('utf8').replaceAll('https://mira.cc/', new URL(base).origin + '/'))
}

/** On a beta host an HTML answer must say noindex; elsewhere nothing is required. */
export function robotsProblem(base, headers) {
  if (!isBetaHost(base)) return null
  const type = headers.get('content-type') ?? ''
  if (!/^text\/html\b/i.test(type)) return null
  return headers.get('x-robots-tag') === 'noindex' ? null : `HTML at ${base} is not marked X-Robots-Tag: noindex`
}

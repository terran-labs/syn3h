/**
 * Which release channel a page or request belongs to, from its hostname alone (the owner,
 * 25 November 2026: beta and production releases). https://beta.mira.cc is a custom domain on the
 * staging Worker, and the same frozen build is later promoted to mira.cc with no rebuild, so the
 * channel is decided at run time, never baked into the files. Any workers.dev address of a
 * deployment counts as beta too: it is never the public site.
 */
export type Channel = 'beta' | 'production'
export function channelOf(hostname: string): Channel {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  return host.startsWith('beta.') || host.endsWith('.workers.dev') ? 'beta' : 'production'
}

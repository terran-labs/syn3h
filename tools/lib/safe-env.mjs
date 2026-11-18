/**
 * The environment for a browser a check launches: the caller's, minus anything that looks like
 * a credential. A crashed Chrome writes a minidump that records its environment; on 17 Nov 2026
 * smoke Chromes inherited the release's Cloudflare token and wrote it into crash dumps.
 *
 * CHROME_HEADLESS=1 also tells Chrome's crash reporter not to upload: dumps stay on this machine.
 */
export const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|CLOUDFLARE/i

/** A copy of env without credential-looking variables, plus CHROME_HEADLESS=1. */
export function browserEnv(env = process.env) {
  const out = {}
  for (const [name, value] of Object.entries(env)) if (value !== undefined && !SECRET_NAME.test(name)) out[name] = value
  out.CHROME_HEADLESS = '1'
  return out
}

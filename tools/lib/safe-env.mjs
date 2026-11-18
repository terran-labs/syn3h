/**
 * The environment for a browser a check launches: the caller's, minus anything that looks like
 * a credential. A crashed Chrome writes a minidump that records its environment; on 17 Nov 2026
 * smoke Chromes inherited the release's Cloudflare token and wrote it into crash dumps.
 *
 * It also sets CHROME_HEADLESS=1, which Chromium documents as keeping crash dumps local (not
 * uploaded) for Linux and headless builds. Do not rely on it on macOS desktop Chrome: there the
 * guarantee is Crashpad's own setting, which has uploads off on this machine (17 Nov 2026).
 */
export const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|CLOUDFLARE/i

/** A copy of env without credential-looking variables, plus CHROME_HEADLESS=1. */
export function browserEnv(env = process.env) {
  const out = {}
  for (const [name, value] of Object.entries(env)) if (value !== undefined && !SECRET_NAME.test(name)) out[name] = value
  out.CHROME_HEADLESS = '1'
  return out
}

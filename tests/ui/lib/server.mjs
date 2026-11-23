// The dev server a browser check drives. tools/browser-checks.mjs starts one for each check, with
// its room server, on free ports, and passes its address as MIRA_URL. A check run without it stops
// at once and says how to run it, rather than waiting on a port nothing serves.
import '../../../tools/lib/legacy-env.mjs' // SYN3H_URL still sets MIRA_URL, see docs/NAMES.md

/** MIRA_URL, or stop with the command that runs `name` (the file's name in tests/ui) properly. */
export function serverUrl(name) {
  const url = process.env.MIRA_URL
  if (url) return url.endsWith('/') ? url : `${url}/`
  console.error(`${name}: no dev server. Run: /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs ${name}`)
  process.exit(2)
}

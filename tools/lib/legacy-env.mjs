/**
 * Until 22 November 2026 the game was called Syn3h and its environment variables were
 * SYN3H_*. They are MIRA_* now. Scripts outside the repository (lane harnesses in /tmp, the
 * Orchestrator's habits) may still set the old names, so this copies every SYN3H_<X> to
 * MIRA_<X> unless MIRA_<X> is already set. Scripts import it before reading any MIRA_ variable.
 * Remove after 22 December 2026 (docs/NAMES.md).
 */
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith('SYN3H_') || value === undefined) continue
  const renamed = 'MIRA_' + name.slice('SYN3H_'.length)
  if (process.env[renamed] === undefined) process.env[renamed] = value
}

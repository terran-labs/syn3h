/** New browser-edition vocabulary, not recovered Syn3h names. Keep edits here. */
const starts = ['Ba', 'Be', 'Bo', 'Da', 'De', 'Do', 'Fa', 'Fe', 'Fi', 'Ga', 'Ge', 'Go', 'Ka', 'Ke', 'Ki', 'La', 'Le', 'Lo', 'Ma', 'Me', 'Mo', 'Na', 'Ne', 'No', 'Pa', 'Pe', 'Po', 'Ra', 'Re', 'Ro', 'Ta', 'Te', 'To', 'Va', 'Ve', 'Vo', 'Za', 'Ze', 'Zi']
const middles = ['la', 'li', 'lo', 'ma', 'mi', 'mo', 'na', 'ni', 'no', 'ra', 'ri', 'ro', 'ta', 'ti', 'to', 'va', 'vi', 'vo']
const endings = ['bon', 'dak', 'den', 'dor', 'fin', 'gon', 'lek', 'lin', 'lon', 'mar', 'nak', 'nix', 'pel', 'pon', 'rek', 'rin', 'ron', 'tek', 'tin', 'tor', 'vek', 'vin', 'von', 'zun']
const botJobs = ['Bolt Inspector', 'Dust Clerk', 'Spare Pilot', 'Snack Probe', 'Cone Marshal', 'Junior Moon', 'Rust Auditor', 'Hull Intern']
const worldPlaces = ['Reach', 'Basin', 'Drift', 'Rest', 'Shelf', 'Hollow', 'Minor', 'Probably Solid']
export type NameKind = 'bot' | 'player' | 'world'
/** Stable across clients and runtimes. Names are labels, never unique identifiers. */
export function generateName(seed: number | string, kind: NameKind): string {
  const text = `${kind}:${seed}`
  let state = 2166136261
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619) >>> 0
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return (n ^ n >>> 14) >>> 0 }
  const pick = (items: readonly string[]) => items[next() % items.length]
  const name = pick(starts) + pick(middles) + pick(endings)
  return kind === 'bot' ? `${name} ${pick(botJobs)}` : kind === 'world' ? `${name} ${pick(worldPlaces)}` : name
}

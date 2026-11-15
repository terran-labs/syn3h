/** Enable only with the Multiplayer lane's tested Explore server handoff. */
export const EXPLORE_AVAILABLE = false
export const modeChoices = [
  { value: 0, label: 'Tag game' },
  { value: 1, label: 'King of the Hill' },
  ...(EXPLORE_AVAILABLE ? [{ value: 2, label: 'Explore' }] : []),
]
export function modeName(value: number): string {
  return value === 0 ? 'Tag game' : value === 1 ? 'King of the Hill' : value === 2 ? 'Explore' : 'Unknown mode'
}

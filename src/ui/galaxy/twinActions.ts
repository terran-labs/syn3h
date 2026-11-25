export type TwinAction = 'public' | 'private' | 'choose'

/** A preview is a recipe and its displayed seeds. This never reads or changes the shared world. */
export function twinWorldCode(recipeId: string, seed: number, nameSeed = 0): string {
  const base = `${recipeId}.${seed}`
  return nameSeed === 0 ? base : `${base}~world.nameSeed=${nameSeed}`
}

export function nextTwinControl(current: number, count: number, direction: -1 | 1): number {
  if (count === 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

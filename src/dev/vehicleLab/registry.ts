/**
 * Every exhibit, found by convention: each file in exhibits/ that exports one or more
 * LabExhibit values (named or default, singly or in an array) is listed. Adding a file is all a
 * vehicle lane does. Ordering and duplicate handling are in tree.ts (collectExhibits).
 *
 * Each file loads on its own. The live lab (tools/lab-live.mjs) shows every lane's latest
 * commit, reviewed or not, so one lane's broken file must not blank the lab for the others:
 * a file that fails to load is listed in `failures` and the rest carry on.
 */
import { present } from './presentation'
import { collectExhibits } from './tree'

export interface ExhibitFailure { file: string; error: string }

const loaders = import.meta.glob('./exhibits/*.ts')
const modules: Record<string, unknown> = {}
export const failures: ExhibitFailure[] = []
await Promise.all(Object.entries(loaders).map(async ([path, load]) => {
  try {
    modules[path] = await load()
  } catch (error) {
    console.error(`Vehicle lab: ${path} failed to load`, error)
    failures.push({ file: path.replace('./exhibits/', ''), error: error instanceof Error ? error.message : String(error) })
  }
}))

// Named and ordered by the lab's own rules, whatever each lane's file calls itself.
export const exhibits = present(collectExhibits(modules))

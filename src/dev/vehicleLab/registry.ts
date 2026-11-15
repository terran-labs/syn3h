/**
 * Every exhibit, found by convention: each file in exhibits/ that exports one or more
 * LabExhibit values (named or default, singly or in an array) is listed. Adding a file is all a
 * vehicle lane does. Ordering and duplicate handling are in tree.ts (collectExhibits).
 */
import { collectExhibits } from './tree'

export const exhibits = collectExhibits(import.meta.glob('./exhibits/*.ts', { eager: true }))

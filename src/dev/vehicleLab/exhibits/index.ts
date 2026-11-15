/**
 * Vehicles the lab can show, by URL id (vehicle-lab.html?vehicle=<id>). To add yours, write one
 * exhibit file beside these and add it here. See docs/vehicle-lab.md.
 */
import type { LabExhibit } from '../types'
import { buggy } from './buggy'
import { gameSkins } from './gameSkins'
import { tank } from './tank'

export const exhibits: Record<string, LabExhibit> = Object.fromEntries([buggy, gameSkins, tank].map(e => [e.id, e]))

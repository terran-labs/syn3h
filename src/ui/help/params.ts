/**
 * "Control tips": the short help right of the minimap that teaches a vehicle's keys by use
 * (lessons.ts). Personal, under Controls with the other input settings. Off by default (the
 * owner, 26 November 2026: on the buggy it said the obvious); the code stays, and may come back
 * for the jet only. Off, nothing of the tips is drawn, measured or observed.
 */
import { defineParam } from '../../../shared/params'

export const controlTips = defineParam<boolean>({
  id: 'help.tips', label: 'Control tips', group: 'Input', scope: 'client', default: false,
})

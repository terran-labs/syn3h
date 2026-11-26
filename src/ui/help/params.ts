/**
 * "Control tips": the short help right of the minimap that teaches a vehicle's keys by use
 * (lessons.ts). Personal, under Controls with the other input settings.
 */
import { defineParam } from '../../../shared/params'

export const controlTips = defineParam<boolean>({
  id: 'help.tips', label: 'Control tips', group: 'Input', scope: 'client', default: true,
})

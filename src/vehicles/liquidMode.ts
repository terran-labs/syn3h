import { defineParam } from '../../shared/params'

/** Keep approved handling until the selectable liquid model has passed driving review. */
export const liquidLegacyEscape = defineParam<boolean>({
  id: 'liquid.legacyEscape', label: 'Legacy liquid handling', group: 'Liquid',
  scope: 'world', default: true,
})

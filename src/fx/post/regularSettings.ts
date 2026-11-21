import { defineParam } from '../../../shared/params'

function knob(name: string, label: string, measured: number, min: number, max: number, step: number) {
  return defineParam<number>({ id: 'glass.' + name, label, group: 'Glass', scope: 'client', default: measured, min, max, step })
}

export const regularSettings = {
  frost: knob('frostWidth', 'Frost width (pt)', 15.5, 1, 32, .5),
  tint: knob('tintStrength', 'Tint strength', 1, 0, 1.5, .01),
  brightness: knob('faceBrightness', 'Face brightness offset', 0, -.3, .3, .01),
  rim: knob('rimHighlight', 'Rim highlight', 1, 0, 2, .01),
  hair: knob('outerHairline', 'Outer hairline', 1, 0, 1.5, .01),
  saturation: knob('saturation', 'Backdrop saturation', 1, 0, 2, .01),
  growth: knob('pressGrowth', 'Press growth offset', 0, -.12, .2, .01),
  lift: knob('pressBrightness', 'Press brightness', 1, 0, 2, .01),
  appearance: knob('appearance', 'Appearance (0 follow device, 1 light, 2 dark)', 0, 0, 2, 1),
}

export function regularOverrides() {
  return Object.values(regularSettings).filter(p => p.value !== p.def.default)
    .map(p => p.def.id + '=' + p.value).join(', ')
}

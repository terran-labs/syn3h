/**
 * The line-up: every vehicle the game ships, side by side at true scale, each built by the
 * game's own `createVehicle` (see gameVehicles.ts). For judging relative size and final polish
 * across the set, which one vehicle at a time cannot show. Opens as a comparison; pick one
 * name in the sidebar to look at it alone.
 *
 * The tank has a Body slider while its design is undecided: 0 is the original model, then the
 * round nine and round eight bodies (TANK_BODIES in tankDesigns/preview.ts). It dresses the tank through
 * `previewTankBody`, in this page only, and the tank rebuilds in place.
 */
import { TANK_BODIES, previewTankBody } from '../../../vehicles/tankDesigns/preview'
import { gameVehicles } from './gameVehicles'
import type { LabExhibit } from '../types'

/** Left to right. The Mars Explorer buggy is leaving the game and is not in the set. */
const SET = ['game-buggy', 'game-jet', 'game-hovercraft', 'game-tank']
const members = SET.map(id => gameVehicles.find(e => e.id === id)).filter((e): e is LabExhibit => !!e)

export const lineup: LabExhibit = {
  id: 'lineup',
  title: 'Line-up: all vehicles to scale',
  section: 'In the game',
  order: 1,
  paramGroups: [],
  heading: () => 'The game\'s vehicles side by side, at true scale',
  defaultDesign: () => 'all',
  async designs() {
    return members.map(e => ({ id: e.id, name: e.title, notes: ['As the game builds it', 'Compare all shows the whole set at true scale'] }))
  },
  async build(info, ctx) {
    const member = members.find(e => e.id === info.id)!
    const model = await member.build((await member.designs())[0], ctx)
    if (info.id !== 'game-tank') return model
    return {
      ...model,
      controls: [...model.controls ?? [], {
        kind: 'slider', id: 'lineup.tankBody', label: 'Tank body (0 the shipped Sherpa, 1 to 3 round ten, then rounds nine and eight)', group: 'Tank',
        min: 0, max: TANK_BODIES.length, step: 1, value: 0, onChange: value => previewTankBody(TANK_BODIES[Math.round(value) - 1]?.id ?? null),
      }],
    }
  },
}

/**
 * Dev-only demonstration of vehicle materialization without editing src/main.ts.
 *
 *   npx vite --port <free port> --strictPort --config tests/vehicles2/materialize.vite.config.ts
 *
 * Injects, right after main builds the shell, the three lines the Vehicles lane will add for
 * real: construct Materialize with the synthesized swoosh, materialize the player at spawn,
 * and expose it. Press M in game to materialize the player again where it stands.
 * `window.miraMaterialize` is the instance, for the console.
 */
import {mergeConfig,type Plugin} from 'vite'
import base from './vite.config'

const anchor='const { shell, audio } = initGameShell(game, player, terrain)'
const inject:Plugin={
  name:'vehicle-materialize-demo',
  transform(code,id){
    if(!id.endsWith('/src/main.ts')||!code.includes(anchor))return
    const lines=[
      `const materialize = game.add(new Materialize(game, terrain, { onCue: (cue, position, hold) => { if (cue === 'materializeStart') audio.play('materialize', position, { seconds: hold }) } }))`,
      `void materialize.prewarm()`,
      `materialize.begin(player)`,
      `Object.assign(window, { miraMaterialize: materialize })`,
      `addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) materialize.begin(player) })`,
    ]
    return {code:"import {Materialize} from './vehicles/effects/Materialize';\n"+code.replace(anchor,anchor+'\n  '+lines.join('\n  ')),map:null}
  },
}
export default mergeConfig(base,{plugins:[inject]})

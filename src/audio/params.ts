import { defineParam } from '../../shared/params'

const mix = (id: string, label: string, value: number) => defineParam({
  id: `audio.${id}`, label, group: 'Audio', scope: 'client', default: value, min: 0, max: 1, step: 0.01,
})
export const masterVolume = mix('master', 'Master volume', 0.8)
export const musicVolume = mix('music', 'Music volume', 0.35)
export const effectsVolume = mix('effects', 'Effects volume', 0.7)
export const engineVolume = mix('engine', 'Engine volume', 0.24)
export const dirtVolume = mix('dirt', 'Ground rumble', 0.22)
export const windVolume = mix('wind', 'Wind volume', 0.4)
export const muted = defineParam({ id: 'audio.muted', label: 'Mute audio', group: 'Audio', scope: 'client', default: false })
export const crossfade = defineParam({ id: 'audio.crossfade', label: 'Music crossfade (s)', group: 'Audio', scope: 'client', default: 2, min: 0.1, max: 8, step: 0.1 })
export const engineIdle = defineParam({ id: 'audio.engineIdle', label: 'Engine idle (Hz)', group: 'Audio', scope: 'client', default: 36, min: 20, max: 70, step: 1 })
export const engineRange = defineParam({ id: 'audio.engineRange', label: 'Engine pitch range', group: 'Audio', scope: 'client', default: 95, min: 20, max: 180, step: 1 })

export const lobbyFade = defineParam({ id: 'audio.lobbyFade', label: 'Lobby fade (s)', group: 'Audio', scope: 'client', default: 10, min: 0.1, max: 20, step: 0.1 })

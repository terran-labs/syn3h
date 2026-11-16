import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseResume, safeResumePosition, prepareResume, ResumeSession, RESUME_MAX_AGE, type ResumeSnapshot } from '../../src/core/resume'
import { LobbyAddress } from '../../src/ui/LobbyAddress'
import { defineParam, params, worldSeed } from '../../shared/params'
const saved = (): ResumeSnapshot => ({ version: 1, savedAt: Date.now(), room: 'lobby', seed: 1, wasHost: true, world: {}, kind: 'buggy', colors: {body:'#123456',accent:'#abcdef'}, p:[10,12,20], q:[0,0,0,1], v:[1,2,3], w:[0,0,0], wingsOpen:true,special:true,cameraMode:2,timeOfDay:10 })
afterEach(() => { vi.unstubAllGlobals(); params.set('world.seed', 1) })
describe('resume validation', () => {
  it('accepts fresh matching saves, rejects stale, future and different worlds', () => {
    const s = saved(), raw = JSON.stringify(s)
    expect(parseResume(raw, 'Lobby', 1)).toEqual(s)
    expect(parseResume(raw, 'other', 1)).toBeNull()
    expect(parseResume(raw, 'lobby', 42)).toBeNull()
    expect(parseResume(raw, undefined, undefined, s.savedAt + RESUME_MAX_AGE)).toBeNull()
    expect(parseResume(raw, undefined, undefined, s.savedAt - 1)).toBeNull()
    for (const change of [{q:[0,0,0,0]}, {v:[999,0,0]}, {colors:{}}, {world:{x:'oops'}}, {p:[null,0,0]}]) expect(parseResume(JSON.stringify({...s,...change}))).toBeNull()
  })
  it('rejects ground, liquid and the map edge', () => {
    const s = saved(), terrain = {size:100,heightAt:()=>10,liquidHeightAt:()=>0}
    expect(safeResumePosition(s,terrain)).toBe(true)
    expect(safeResumePosition({...s,p:[10,10,20]},terrain)).toBe(false)
    expect(safeResumePosition(s,{...terrain,liquidHeightAt:()=>12})).toBe(false)
    expect(safeResumePosition({...s,p:[50,12,20]},terrain)).toBe(false)
  })
  it('explicit navigation wins and only world settings can be restored', () => {
    defineParam({id:'resume.test.client',label:'test',group:'test',scope:'client',default:0})
    const s = {...saved(), seed:42,world:{'world.gravity':5,'resume.test.client':1}}
    const storage = {getItem:()=>JSON.stringify(s)}
    expect(prepareResume(new URLSearchParams('seed=1'),storage)).toBeNull()
    expect(prepareResume(new URLSearchParams('vehicle=jet'),storage)).toBeNull()
    expect(prepareResume(new URLSearchParams(),storage)?.seed).toBe(42)
    expect(worldSeed.value).toBe(42)
    expect(prepareResume(new URLSearchParams('seed=1'), {getItem:()=>JSON.stringify({...s,entrySeed:1})})?.seed).toBe(42)
    expect(params.get('resume.test.client')?.value).toBe(0)
  })
  it('waits for welcome, restores once, then saves without replaying held throttle', () => {
    vi.stubGlobal('window',new EventTarget()); vi.stubGlobal('document',new EventTarget())
    const s = saved(), writes: string[] = [], teleport=vi.fn(), rotation=vi.fn(), linear=vi.fn()
    const network={connected:false,isHost:true,setProfile:vi.fn()}
    const player={kind:'buggy',spawnSlot:0,colors:s.colors,teleport,body:{setRotation:rotation,setLinvel:linear,setAngvel:vi.fn()},postPhysics:vi.fn(),input:{special:false},setColors:vi.fn(),getState:()=>({...s,input:{}})}
    const game={input:{state:{special:false}}},toast=vi.fn()
    const session=new ResumeSession({game,player,terrain:{size:100,heightAt:()=>10,spawnPoint:()=>({position:{},heading:0})},room:'lobby',saved:s,network,storage:{setItem:(_k:string,v:string)=>writes.push(v)},toast} as any)
    session.update(2); expect(teleport).not.toHaveBeenCalled(); expect(writes).toHaveLength(0)
    network.connected=true; session.update(.1)
    expect(teleport).toHaveBeenCalledTimes(1); expect(linear.mock.calls[0][0].toArray()).toEqual(s.v)
    expect(game.input.state.special).toBe(true); expect(toast).toHaveBeenCalledOnce()
    session.update(2); expect(teleport).toHaveBeenCalledTimes(1); expect(writes).toHaveLength(1)
    session.dispose()
  })
  it('keeps the entry seed when periodic and lifecycle saves run in the clean lobby', () => {
    const windowEvents = new EventTarget(), documentEvents = new EventTarget()
    vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents)
    const location = { href: 'https://syn3h.com/?room=lobby&seed=1', get search() { return new URL(this.href).search } }
    vi.stubGlobal('location', location)
    const address = new LobbyAddress(location, { state: null, replaceState(_state, _title, url) { location.href = String(url) } })
    const s = saved(), writes: string[] = []
    const session = new ResumeSession({
      game: { input: { state: { special: true } } },
      player: { kind: 'buggy', colors: s.colors, wingsOpen: true, getState: () => s },
      terrain: {}, room: 'lobby', saved: null, entrySearch: address.playURL().search,
      storage: { setItem: (_key: string, value: string) => writes.push(value) },
    } as any)
    try {
      session.update(.1)
      params.set('world.seed', 42) // Host edits the world after entry with seed=1.
      address.showLobby()
      expect(location.search).toBe('')
      session.update(2)
      windowEvents.dispatchEvent(new Event('pagehide'))
      documentEvents.dispatchEvent(new Event('visibilitychange'))
      expect(writes).toHaveLength(3)
      for (const raw of writes) {
        expect(parseResume(raw)?.entrySeed).toBe(1)
        expect(parseResume(raw)?.seed).toBe(42)
        // The original explicit link still resumes this edited world, not a reset.
        expect(prepareResume(new URLSearchParams('room=lobby&seed=1'), { getItem: () => raw })?.seed).toBe(42)
      }
      expect(location.href).toBe('https://syn3h.com/')
    } finally { session.dispose() }
  })

})

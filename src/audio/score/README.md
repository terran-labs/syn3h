# Adaptive score

The default music of Syn3h. Nothing in it is a recording: a seeded composer writes the
music one sixteenth note at a time and a fixed Web Audio graph plays it. It ships as code
in the first bundle and costs no download.

| File | What it is |
|---|---|
| `Composer.ts` | Pure music theory. Seed and mood in, notes and drum hits out. No Web Audio, so it runs in unit tests. |
| `ScoreSynth.ts` | The instruments: pads, drone, choir, arpeggio, bass, drums, bells, riser, impact, hall and delay. |
| `Score.ts` | The conductor. Smooths game state into a mood and schedules the composer's output ahead of the audio clock. |
| `demo.ts`, `/score.html` | The lab. Every mood input has a slider and there is a button per scene. |

## What the game feeds it

| Game state | Where it comes from | What it does to the music |
|---|---|---|
| Speed, throttle | the local vehicle | Intensity: arpeggio, then bass and kick, then a half-time low drum; tempo rises from 60 to 100 |
| Tag beams | beams sent and landed near the listener, being tagged | Heat that decays over about nine seconds; raises intensity and turns the harmony dark |
| Altitude, height above ground | the local vehicle | Lift: choir, brighter filters, the sequencer line an octave up, dorian harmony |
| Lava nearby | `lavaProximity` | Phrygian harmony, a growling bass when it is also intense |
| Submersion | vehicle below `liquidHeightAt` | A lowpass on the whole mix, engine and effects included, and a bigger hall |
| Match | `Shell.setMatchState` | Holding the hill is triumph (bells and choir forward), a contested hill is tension |
| World seed | `worldSeed`, or `audio.score.seed` | Key, chord progressions, arpeggio shapes and melody |

The harmony changes mode at the next chord boundary, at most two bars away, and lands the
change with a sub drop.

## The arc

A steady texture never raises a hair, so sections of eight bars follow a six-part cycle:

| Section | What happens |
|---|---|
| theme | The world's theme is stated on the theremin. Each seed has one theme of four phrases and it never changes, so its return is recognised. |
| still | The melody rests. Pads, drone and pulse only. |
| build | The bass holds the dominant under moving chords. A string section enters on the beat. |
| climb | The strings double their pace, the theme's rising phrase repeats, an endless-rise tone and a noise swell grow, the choir opens its mouth, a drum roll, then half a bar where only the hall's tail is left. |
| release | The key lifts a minor third and turns to the major (the relative major of a natural minor key). The full theme returns an octave up on brass and theremin, with organ, bell and the women of the choir, about 4 dB above the climb. A dark mood keeps its release in the minor. |
| afterglow | The major lingers; only the theme's closing phrase is heard. |

Every second chord arrives with its third suspended and resolves a bar later.

Play can jump the arc. `Score.cue('surge')` starts the last two bars of a climb, so a release
lands a few seconds later. Taking off does this by itself (after 1.2 s of real flight), a
capture does it through `accent`, and a win brings the release at once. Surges are at least
40 seconds apart: a release that comes too often stops meaning anything.

## Instruments that are more than oscillators

| Instrument | Technique | File |
|---|---|---|
| Plucked strings | Physical modelling (Karplus-Strong) | `pluck.worklet.js` |
| Choir | Twenty glottal-pulse singers through five formants that move from "oo" to "ah" | `choir.worklet.js` |
| Shimmer | Granular octave-up cascade into the hall | `shimmer.worklet.js` |
| Bell | Modal synthesis: eight inharmonic partials | `ScoreSynth.ts` |
| Pipe organ | Additive: drawbar harmonics in one periodic wave | `ScoreSynth.ts` |
| Endless rise | Shepard and Risset: eight octave-spaced sines under a fixed envelope | `ScoreSynth.ts` |

The worklets are plain JavaScript because the browser loads them as modules. Each loads on
its own; if one fails the score plays on without it (the choir falls back to filtered saws).

## Cost, and the lighter tier

`audio.score.lite` ("Lighter score (for phones)") builds a cheaper set of instruments: no sung
choir (filtered saws stand in), no shimmer, halo or endless rise, fewer oscillators, and a
1.6 second hall in place of 5.5. The music is the same. The quality system may set it, and
the score sets it itself after two strained readings from the browser's audio counters
(`renderCapacity` or `playbackStats`), where a browser has them.

Measured with `node tests/audio/score-load.mjs`, busiest passage (a release in a full chase),
on a loaded M-series Mac: full about 15% of one core, lighter about 8%. Scaled to a CPU four
times slower that is 58% and 32%; six times slower, 87% and 48%. Those scalings are
arithmetic, not measurements: nothing here has been run on a phone. Chrome's CPU throttle
does not slow the audio thread, so its zero underruns prove nothing.

Where the cost sits (percent of one core): the 5.5 s hall 5.0, the 1.6 s hall about 1.6,
sixty oscillators 1.5, the choir worklet 1.2, thirty filters 1.0, pluck and shimmer worklets
0.4 and 0.3.

## Tuning

`audio.score.energy`, `audio.score.tempo`, `audio.score.reverb` and `audio.score.seed` are in
the parameter registry under "Adaptive score". Layer thresholds are in `levels()` and
`Composer.step`; instrument levels are in `ScoreSynth.setLevels`.

## Checks

```sh
npx vitest run tests/audio/score.test.ts          # composer: in key, deterministic, layers
SYN3H_NO_ROOM_SERVER=1 npx vite --port 5188 &     # then, in real Chromium:
node tests/audio/score-render.mjs                 # renders each scene offline, measures it,
                                                  # writes WAVs to tests/audio/artifacts
node tests/audio/score-game.mjs                   # the score inside the game
```

The render check cannot tell whether the music is good, only that it is audible, unclipped,
stereo and that each input moves it the right way. Judge it by ear in the lab.

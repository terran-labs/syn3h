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

A steady texture never raises a hair, so sections of eight bars follow a four-part cycle:

| Section | What happens |
|---|---|
| theme | The theremin states a melody: a pickup, a leap to a long held note, a stepwise fall. |
| still | The melody rests. Pads, drone and pulse only. |
| build | The bass holds the dominant under moving chords, the filters open, a halo and a noise swell grow, then half a bar of near silence. |
| release | The key lifts a minor third. The theme returns an octave up; pipe organ and high choir enter; the level rises about 5 dB. |

Every second chord arrives with its third suspended and resolves a bar later. `Score.cue('build')`
starts a build on demand; the lab has a button for it.

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

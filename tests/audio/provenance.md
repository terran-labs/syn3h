# Vehicle sound recovery

The November 2026 search found no original engine clips to reuse. The replacement
engine and game cues are new synthesis, not recovered Syn3h recordings.

- `syn3h-client/Assets/_Core/Scripts/Vhicl*.cs` has no audio assignments. The lone
  clip match is `Vhicl.cs:229`, a commented camera farClipPlane assignment.
- `syn3h-client/Assets/_Actors/Packages/` vehicle scripts and prefabs have no
  AudioSource or audio clip assignments.
- `_Actors/Assets/Equipment/LaserAuto.prefab:69` and `LaserSnipe.prefab:69` reference
  GUID `6fa3464fabc714be19198ef42dee796e`, resolved by
  `_Core/Audio/LaserShot.mp3.meta`.
- `_Actors/Assets/Equipment/Components/PlasmaSparks.prefab:158` and
  `PlasmaSparksSnipe.prefab:158` reference `240e79cff18d441adb71689321ba0180`,
  resolved by `_Core/Audio/LaserHit.mp3.meta`. Both originals already ship.
- The client audio inventory is `_Core/Audio/` (Materialize, Screenshot, LaserShot,
  LaserHit, Classic, Ambient, Carefree, Space Station, Kai Engel) and `_Core/Sounds/`
  (WaterSource, WaterLoop, Wind). No engine recording is present.
- `syn3h-player-proprietary/` has 93 audio files, all under NWH or Enviro package
  directories. Engine samples, including tank, racecar and fan recordings, are
  under `NWH/Vehicle Physics 2/Sound/` and `NWH/Dynamic Water Physics 2/Sounds/`.
- `syn3h-client-proprietary-libraries/` has three audio files, all AQUAS package
  underwater/splash recordings. No proprietary-tree samples were copied.

Paths above are relative to `/tmp/syn3h-research/legacy/`. These trees were read
as source data only. The recorded music and effects that once shipped from `public/audio`
were removed on 15 November 2026 at the owner's direction; everything heard is synthesised.

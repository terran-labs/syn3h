# Audio sources

`SpaceStation.mp3` is a compressed copy of the owner-supplied Syn3h asset
`Assets/_Core/Audio/Space Station SLOW LOOP.wav`. It is the default title track in this
browser edition. Conversion used ffmpeg with `libmp3lame -q:a 4`; source duration is
139.636 seconds. The original WAV is not duplicated here.

The recovered Unity controller actually references Kai Engel's “Chance”. No
track-specific redistribution licence was found in the supplied repositories, so that
file is excluded. Space Station is a deliberate substitute, not a claim that it was
that controller's selected track.

Classic, Carefree and Ambient remain optional legacy tracks. Ambient is byte-identical
in the supplied Mars Explorer and Syn3h repositories. Effects and wind are the supplied
original game assets, reused with the owner's authorization.

Vehicle engines, energy fields, lava ambience and game/UI cues are new Web Audio
synthesis in `src/audio/`. No NWH, Enviro or AQUAS sound samples are redistributed.
The vehicle audio search and exact original effect GUIDs are recorded in
`tests/audio/provenance.md`.

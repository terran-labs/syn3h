# Volumetric cloud checks

`post.clouds` defaults to 1 on the full post tier. Setting it to zero, reducing graphics
quality, shedding post effects or disposing the chain restores the existing sky layer.
Zero coverage, density or atmosphere suppresses the volume without changing registered
weather settings. Both WebGPU and WebGL 2 use the same procedural shader.

The volume marches 24 samples through a curved shell or a flat slab and takes three light
samples for cloud self-shadowing. It runs at half resolution, then uses depth-aware
upsampling. It does not cast cloud shadows on terrain. The reflection capture retains the
existing sky clouds; reflections do not trace the camera's volume.

The existing dimensionless elevation maps to `post.cloudBase * (0.5 + elevation)` metres.
The base defaults to 300 m and thickness to 160 m. At the existing scale of 0.0002, density
cells are about 120 m across. Whole lattice cell counts make every octave tile-periodic.
Changing scale can therefore step between cell counts; this control is not continuous.
Wind offset continues through quality changes. Its phase is local, not synchronized across
clients, and the volume does not match the old projected sky shapes exactly.

Run each command through `/Users/vtn/dev/Syn3h/tools/heavy.sh`, one job at a time:

* `node tools/cloud-check.mjs URL OUTPUT [--webgl]`: curved and flat layers, inside views,
  foreground depth, horizon intersection, moon direction, suppression and release.
* `node tools/cloud-invariants.mjs URL OUTPUT [--webgl]`: frozen view translated one world
  tile in X, drifting quality transition, vacuum/preset/air restoration, actual reflection
  pixels with the camera fallback hidden. Z and negative coordinates use the same periodic
  construction but are not separate browser cases in this tool.
* `node tools/post-entry-check.mjs URL OUTPUT [--webgl]`: ordinary lobby entry, defaults,
  day/night rendering, quality tiers and explicit off/on restoration.
* `node tools/post-profile.mjs URL OUTPUT --clouds`: cloud off/on/on/off at 1080p. Record
  host load and timing spread; a loaded-host sample does not establish a device budget.

The fallback unit tests inject a reflection capture failure and verify restoration without
changing the capture schedule. Browser tests check reflection pixels on both backends;
the unit mock alone cannot establish that GPU behavior.

Physical iPad performance remains unmeasured. Cloud appearance still needs owner feedback,
as do the existing aerial perspective and tone choices. Temporal antialiasing is separate.

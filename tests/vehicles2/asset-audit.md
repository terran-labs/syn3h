# Vehicle asset audit

Source baseline: `580466b`. Counts are file bytes, not compressed HTTP transfer sizes.
This is source reachability and GLB inspection, not a fresh browser request trace.

| Loaded asset | Bytes | Reachable caller |
| --- | ---: | --- |
| buggy.glb | 348928 | LoadedBuggySkin Syn3h wheels and components; buggy lab |
| buggy-boxarm.glb | 293012 | LoadedBuggySkin Syn3h body |
| buggy-classic.glb | 84644 | LoadedBuggySkin classic body |
| buggy-classic-wheel.glb | 484624 | LoadedBuggySkin classic wheels |
| tank.glb | 12556 | Tank game hull |
| tanktread.glb | 115204 | Tank game tracks |
| jet.glb | 335568 | VehiclePreview chooser; geometry regression |

All eight GLBs declare zero images and zero textures. Live mesh geometry remains an
owner-authorized exception. The game jet uses procedural GameJet, but the chooser still
loads jet.glb through its dynamic vehicle-kind path. Classic remains in the supported
factory, chooser, resume and wire kinds. Removing those selectors is a separate product
change; neither classic GLB nor the chooser jet is dead.

Syn3h buggy unique mesh bytes: 641940. Classic: 569268. Hovercraft: 38828.
Tank: 127760, with the track file reused for multiple tracks. Game jet: zero GLB bytes;
its physics still imports jet-collider.json. All eight shipped GLBs total 1713364 bytes.
These are per-file totals, not a claim about browser caching or request multiplicity.

Deleted armor-scales.jpg (65536 bytes) and thruster-glow.png (70710 bytes): 136246 bytes
removed from the shipped asset tree. Repository search found no runtime caller. Shared
procedural paint and glow already replaced their use. The only remaining image-loader
helper, textureViews, had no production imports; its obsolete helper test is removed too.
No expected runtime request reduction is claimed for deleting already-unused files.

Validation: typecheck and 229 tests in 34 files passed through the absolute shared heavy
wrapper with at most two test workers. This covers all vehicle2 tests plus the repository
bitmap guard. The tightened guard forbids vehicle bitmap files and image-loader calls,
and inspects GLB JSON chunks for embedded or referenced images/textures. The browser
capture script has no bitmap exceptions now; no new browser run was needed for dead
asset removal. Eight other tracked bitmaps remain outside this lane at the baseline.

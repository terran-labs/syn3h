# Owner follow-on acceptance

Prepared from the overnight direction and current source. The owner has now authorized
independent follow-on implementation while aircraft evasion remains unfinished.
The acceptance checks below preserve lane ownership and existing release safeguards.

## Performance and adjustable tiers

Reuse `QualityController`, its governor and `mira:quality` events. Do not introduce a
second controller that fights manual settings or the existing automatic ladder.
Provide understandable tier controls on ordinary entry, including touch. Exercise
moving up and down during play, automatic mode, manual choices, reload and recovery.
Keep physics, room authority and gameplay outcomes independent of render quality.

Measure representative worlds, water, a mixed bot fleet and multiplayer before and
after changes on the same scene, resolution, backend and hardware. Report frame-time
distribution and stalls, draw counts, triangles, physics cost and relevant resource
cost. Distinguish shared-host browser measurements from real phone/tablet evidence.
Do not promise all WebGPU hardware is fast based on one desktop or emulation.

## Toggleable diagnostics and recommendations

The existing F3 panel shows FPS, frame time, p90, physics time, draw calls and triangles.
Extend or reuse that path. Provide a discoverable touch control without a special URL,
a bounded history chart, current tier and backend, and available hardware information.
Label unavailable or estimated hardware data honestly. Avoid additional GPU contexts
or adapter probes solely for display; reuse startup observations where possible.

Show useful diagnostics when WebGPU startup or device operation fails, including the
selected fallback and an actionable recovery option. Opening, closing, rejoining and
reloading must not accumulate listeners, sampling loops or charts. Keep diagnostic
history bounded and verify its own frame cost.

Sustained low FPS should offer one compact floating recommendation with Ignore and
Lower tier actions. Define its observation window from measured behavior, excluding
loading, hidden tabs, menus and interrupted frames. Coordinate with the existing
governor: show the effective tier, respect deliberate choices, suppress repeated
prompts after Ignore, and avoid offering a lower tier when already at the minimum.
Test recovery, repeated slow periods, manual changes and automatic shedding together.

## Cursor, tools, bots and multiplayer

Reuse the current right rail and bottom-left minimap vignette. Verify pointer capture,
Escape, Exit world, native form controls, held-key release, touch stick clearance and
readability against bright worlds. Do not create duplicate interface controls.

Verify all four tools with host and guest, bot ownership, reconnect, host transfer,
explicit off settings and relevant world seams. Preserve playful autonomous behavior;
scripted encounters establish lifecycle correctness, not natural encounter frequency.
Aircraft evasion remains unfinished until an implemented design has useful escapes
without harming previously safe encounters across fresh cases and full Pester lifetime.

## Visibly transparent water

Above-water captures must show identifiable submerged ground and objects through the
surface. Shallow tint alone and transparent falling sheets do not satisfy this.
Cover sea, lake/pool and river paths, including the separate waves-off fallback.
Preserve opaque lava, dry worlds, wave phase, buoyancy and existing vehicle behavior.

Review shallow and deep views, moving waves, shores, above/below-water transitions,
reflections, underwater effects and transparent vehicle canopies on both backends.
Check sorting, depth artifacts and the temporal-history exclusions for displaced water.
Provide sensible quality fallbacks while retaining visible shallow-water transparency.
Measure frame/resource cost and verify two clients share wave timing; do not claim
real-device performance from desktop screenshots. No baked texture is needed merely
to prove transparency: retain the procedural design principle.

## Delivery

Each handoff names exact source, evidence and limitations. The sole integrator accepts
combined source and owns deployment and rollback. Update the morning brief with what
is actually live and what still needs hardware or owner visual review.

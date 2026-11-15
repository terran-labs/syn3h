# Hovercraft studies

Round one stays in `designs.ts` and `NextHover.ts`. Round two lives in `heritage.ts`
and `HeritageHover.ts`, round three in `round3.ts` and `Round3Hover.ts`. All three
appear under the hovercraft in the shared vehicle lab; a round is never deleted.

The owner rejected round one's proportions and requested five variants closer to
the original hovercraft, including its rear spoiler, at roughly the buggy's size.
The original mesh has broad shoulders, a pinched waist, rear haunches, an inset
cockpit, a raised central chrome thruster and a spanning rear wing on swept supports.
Round two uses those features rather than the first round's aircraft and lunar themes.

Reference measurements in metres, with forward along negative Z:

| Reference | Width | Length | Height |
| --- | --- | --- | --- |
| Original hovercraft GLB | 2.519 | 3.150 | 1.003 |
| Approved Box arm buggy, including straight tyres | 2.690 | 4.009 | Suspension dependent |

The buggy lead confirmed its approved details: sculpted flares, substantial box
supports with accent ribs, larger headlights with chrome rings, and two stacked
tail bars per side contained inside the rear panel. Round two adapts these as body
quarters, spoiler supports and light fittings. It does not add wheels or suspension.
The shared force field canopy and usable cockpit are owner requirements; the
buggy's existing interior has not received separate visual approval.

The five parameter sets are Original, Flare, Box, Arch and Sweep. All use the
same original-derived hull stations. Shoulder width, waist width, rear width,
spoiler height and rake, chine lip, accent ribs and spoiler bridge are explicit
parameters. Their colours remain editable in the lab. All geometry is generated;
no new mesh or image files are loaded.

These are lab studies. The game's collision hull and ride camera do not change.
Near and mid geometry come from the shape kit at different resolutions; far uses
an explicit hull, cockpit and spoiler silhouette in one draw. Budget and scale
assertions are in `hover-heritage.test.ts`. Tests, cockpit sightline checks, rendered
comparison and timing measurements must pass before this round is ready to publish.

## Round three

On 15 November 2026 the owner accepted round two's proportions and rejected its
fittings: the headlights and tail lamps sat at fixed coordinates and hung in the air
beside the hull. He asked for ten explorations and reinterpretations of the original,
with styling from the approved jet and buggy.

The rule for round three is that nothing is placed by coordinate. Each fitting asks
the hull where its skin is and is generated from the answer: headlamp pods faired into
the nose or a light bar on the nose's own outline, tail bars in a socket turned to lie
along the stern or a band on the stern's outline, vents as bulges of the hull's skin,
spoiler supports rooted below the deck. Each fitting records an anchor point that must
be inside the hull. `floating()` returns the anchors that are not, and
`hover-round3.test.ts` requires none.

A design is a recipe over one hull: nose lamps (socket, twin, visor), tail lamps (bars,
band), thruster (the original stalk, the jet's hex ring, twin booms, through the
stern), spoiler (classic, box, hex, fins, tee, arch, duck), vents, stripe and chine,
plus hull multipliers. From the buggy: recessed lamps in dark sockets, centre stripe,
flank vents, box supports with accent ribs. From the jet: the six-sided ring, faceted
accent plates, twin booms, drooped accent tips.

`Round3Hover` steps the generator's detail down until a level fits its triangle budget,
so a design with more fittings spends fewer triangles on its hull, not more in total.

`GameHover` and the `hover.body` parameter let the game's hovercraft wear a study with
its cockpit and detail levels. They currently cover round two. The original mesh stays
the default until the owner picks a design.

# Ten exploration tanks

Round six is rejected. Its separate force-field dome sat above a hull bulge that already
represented the cockpit. These designs replace that construction with one shell, with real
window openings cut into it. They are appearance studies, not replacements for the game tank.

## Brief carried forward

- Exploration, no visible cannons or other weapons.
- Six independent tread assemblies and a broad stance. The owner also
  specified roughly twice the buggy's size; these studies target about 5.4 m wide and 8 m long.
- A deep, substantial body. Retain the Rover's generous proportions without its floating bumper.
- A front cockpit tall enough to occupy, integrated into the hull's roofline.
- Six individual fenders. Rear fenders sweep back and down. Each travels with its own tread.
- One fixed hull pivot and a stout carrier for each tread; avoid fragile-looking linkages.
- Large headlamps, simple tail lamps and wear shoes continuous with the lower hull.
- Industrial and aerospace forms rather than SUV styling, spoilers or decorative chrome.

## Directions

| Design | Main exploration |
| --- | --- |
| Foundry | Heavy tractor, blunt cab and a recessed machinery deck |
| Whiteout | Long insulated polar station with pressure ports |
| Selene | Rounded lunar observation cabin with a low radiator tail |
| Caspian | Ship-like keel, substantial chines and a descending flight deck |
| Ballast | Wide quarry crawler with deep sills and a low work bed |
| Sherpa | Tall alpine observation front, narrow waist and rising rear shoulders |
| Kiln | Deep heat-shield body with a compact cabin and ribbed cooling back |
| Bathys | Rounded subglacial pressure body with circular ports and a tapered stern |
| Salt Runner | Shallow desert prow, forward observation wedge and low rear deck |
| Ark | Forward command room and a stepped habitation body |

## Reference and implementation

The six-pod arrangement is carried forward; the early red and purple studies
establish the owner's preference for triangular treads, fender flares and a heavy central body.
The [Lun reference the owner supplied](https://en.wikipedia.org/wiki/Lun-class_ekranoplan)
informs Caspian's keel and upper-deck proportions. [NASA's rover concepts](https://www.nasa.gov/reference/jsc-rovers/)
inform Selene's occupied pressure volume. Polar expedition photographs, including the
[Kharkovchanka traverse](https://www.southpolestation.com/trivia/igy1/dralkin1.html), inform
Whiteout's long insulated body. These are fictional designs, not historical reconstructions.

`round7.ts` owns the ten silhouettes. `expeditionKit.ts` builds the hull, window openings,
interior scale cues, lamps and independently articulated carriers. No new bitmap assets are used.
The existing lab preview materials are retained for comparison with prior rounds. The chosen
game model will still need the shared material roles, three production detail levels and draw
call consolidation. The two study levels vary tread tessellation, not the body silhouette.

The default tank exhibit opens this round. Previous rounds remain available as design history.
The game tank is unchanged until the owner chooses a design.

## Validation

The default study level measures 8,950 to 11,964 triangles and 64 draws per vehicle. All ten
were captured and inspected from the front, side and rear without page errors. Foundry was
also inspected in motion, at night, from the cockpit and at a 390 px phone viewport.
TypeScript and 18 tank tests pass, including checks for six independent carriers, fixed
pivots, level treads during suspension travel, finite geometry and the triangle limit.
These checks do not establish game performance or production readiness.

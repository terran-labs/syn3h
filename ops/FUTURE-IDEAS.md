# Future playgrounds

Living research backlog, requested 15 November 2026. These are proposals, not shipped
features. Current fixes, the About guide and showcase keep priority. Portal work is
authorized at low priority; the other toys are research until selected for implementation.
Terrain editing is a separate future project.

The [vehicle studio and community research](VEHICLE-STUDIO-RESEARCH.md) adds expandable
entries for generated bodies and mechanics, a shape editor, model-assisted recipes,
personal universes, friends and tentative subscriptions. It records the owner's long-term
community ambition separately from untested implementation and revenue hypotheses.

Use the expandable entries below in the admin Future Ideas section. At each release
planning pass, revisit entries whose prerequisites changed. Recommend one bounded next
experiment when capacity allows; do not silently start the entire backlog.

<details>
<summary>Portal gun: lend someone a shortcut through space</summary>

**Owner's design:** each player maintains one independent blue/orange pair and places
both ends. Everyone may traverse any completed pair. Repeating the selected gear number
or pressing its button toggles the endpoint color. Proposed replacement behavior: placing
blue replaces that owner's blue endpoint, and likewise for orange. An incomplete pair
must visibly say it is unlinked and must not transport anyone.

**Trust:** aiming at either endpoint reveals its maker using the vehicle-label visual
language. Show an endpoint identifier as well as color. Ownership comes from the room's
player identity, not a client-supplied display name. Replacing an endpoint must update
the pair atomically so a traveler cannot use a stale destination.

**First experiment:** stationary portals on suitable terrain, with procedural rings,
an energy surface and synthesized cues. A live view through the portal is a separate
rendering milestone, not a prerequisite for useful transport. Specify surface clearance,
minimum aperture for every vehicle and a safe exit before allowing traversal.

**Hard parts:** swept crossing at high speed; transforming pose and velocity between
portal frames; curved-world coordinates and wrap seams; prevention of immediate return
loops; simultaneous travelers; replacement while crossing; disconnect cleanup and late
join. Grapples attached across a teleport need an explicit policy before shipping.
Reject obstructed exits rather than depositing a vehicle inside terrain or another body.

**Ready to ship when:** two people can place independent pairs, use each other's pairs,
replace endpoints and reconnect without divergent destinations. Test every vehicle,
Zorb, fast crossings, obstruction, seam crossings and bounded visual cost. Maker labels
must remain readable without exposing identity beyond the player's public game name.

</details>

<details>
<summary>Construction kit: blocks, walls and launch ramps</summary>

**Experience:** arrange a few clean sci-fi shapes into a stunt course. Snap pieces to a
grid or compatible sockets, preview placement, rotate, undo and remove your own pieces.
Start with blocks, walls and wedges. Keep geometry and collision generated from the same
dimensions so a beautiful ramp does not conceal an invisible curb.

**First experiment:** a bounded number of stationary pieces in a room. Share validated
creation, transform and deletion events rather than treating each piece as a moving
physics body. This still needs consistent collision geometry and ordered revisions.

**Questions to settle:** room versus permanent persistence, edit permissions, occupied
placement, spawn protection, world-wrap representation and cleanup after an owner leaves.
Start with room lifetime and owner deletion as proposed defaults, not settled policy.

**Ready for recommendation when:** current multiplayer ownership is documented and a
small placement prototype proves smooth driving across joined ramps. Measure collider
and draw cost before choosing a room budget. Terrain modification remains out of scope.

</details>

<details>
<summary>Force-field trampolines: turn a landing into another flight</summary>

**Experience:** a translucent energy membrane bends and pulses beneath a vehicle, then
launches it along the pad's normal. Procedural ripples communicate the impulse. A tilted
pad can turn a canyon into a cooperative aerial course.

**First experiment:** a stationary bounded pad with an entry-triggered impulse, speed
cap and rearm rule. Avoid applying the impulse every frame a vehicle overlaps the pad.
Define whether mass changes the result and make the visual response agree with it.

**Validation:** slow arrival, fast arrival, resting on the pad, multiple vehicles,
Zorb, side entry and network correction. Test a chain of pads for runaway energy.
Recommend after static placement and shared trigger ownership are proven.

</details>

<details>
<summary>Acceleration corridors: build a runway toward the impossible jump</summary>

**Experience:** directional light bands show where a field will push you. Place a field
before a ramp, or arrange several into an airborne obstacle course.

**First experiment:** bounded acceleration in a visible volume, with a maximum speed
and clear direction. Use elapsed simulation time, not render-frame count. Specify how
overlapping fields combine and whether reverse entry brakes or accelerates the traveler.

**Validation:** different frame rates, repeated entry, opposing fields, fast boundary
crossings and a vehicle already faster than the configured limit. Recommend after the
trampoline's shared trigger and ownership behavior has been tested.

</details>

<details>
<summary>Shared giant bouncy balls and other moving toys</summary>

**Experience:** several vehicles shove one enormous ball through a valley, launch it
off a ramp or invent a game with no scoreboard. Later candidates include rolling drums,
lightweight hoops and pendulums. Begin with a sphere because its collision shape is simple.

**Networking research:** the difficult part is consistent contact under latency, not
necessarily the local sphere solver. Independent client simulations can disagree when
several people collide with the same ball. Compare a single simulation authority with
client prediction against authority transfer. The latter adds handoff and simultaneous
contact problems; it should not be the first assumption.

**First experiment:** one ball, two people, bounded speed and a recover/reset action.
Record positions, impulses and corrections under delay and packet disruption. Evaluate
late join, authority departure, sleeping/waking, world seams and rapid repeated impacts.
Choose authority from the actual room architecture after inspection; do not assume the
room server already runs the game's rigid-body simulation.

**Ready for recommendation when:** the existing vehicle collision/network contract is
documented, an authority can be maintained through disconnects, and the prototype has
measured correction error and traffic cost. Only then expand the toy count or add joints.

</details>

<details>
<summary>A common maker label for things people leave behind</summary>

Every persistent player-created artifact should carry a stable artifact ID, creator ID
and revision, with its public creator name resolved from room identity. Show the same
small sci-fi maker label on deliberate aim or close inspection, with human-readable
state such as unlinked, active or awaiting its owner. Avoid covering the world in labels.

Reuse the vehicle labels' typography, color accents, depth/curvature handling, reduced
motion behavior and contrast rules. Keep artifact interaction separate from vehicle
label data. Occlusion, accessibility and crowded scenes need validation before reuse is
considered complete. Bots must not impersonate human creators.

</details>

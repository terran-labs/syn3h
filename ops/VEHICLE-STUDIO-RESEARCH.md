# Vehicle studio and player-owned universes

Research brief, 15 November 2026. Low priority relative to current delivery. This records
the owner's long-term direction and proposed experiments, not product commitments or
authorization to launch a paid service. No model calls, subscriptions or infrastructure
have been purchased for this research.

## Owner's direction

Players should create their own vehicles inside Syn3h: distinctive bodies, mechanical
systems and handling with an understandable engineering rationale. A simple shape editor
could capture the silhouette, then frontier models could propose fins, wings, chrome,
lights and other details in the established Syn3h style. Random generation should produce
fresh designs, while extensive customization lets people develop a favorite.

The owner wants to build another community of hundreds of thousands of players, drawing
on his experience building a large community in his late teens. That is an ambition and
an owner-reported history, not a verified current audience or a growth forecast. Proposed
subscriptions would fund personal universes, customized planets and deeper creation tools.
Friends lists and online presence would help people return to one another.

The stated prices were “399” and “1499.” Working interpretation: $3.99 and $14.99 per
month, currency and decimal placement unconfirmed. Do not publish prices or entitlements
as decided. The research can proceed without settling them now.

<details>
<summary>Start with a blueprint that explains the machine</summary>

A proposed versioned vehicle recipe contains seed, generator version, mechanical
archetype, body control points, component graph, material roles and creator provenance.
The component graph describes where wheels, suspension, motors, wings, thrusters and
mass sit. Geometry, collision, handling and synthesized sound derive from the same recipe.
Save the resolved recipe as well as the seed: changing a generator must not change a
player's existing vehicle silently.

Separate visual variation from mechanical variation. A cosmetic fin need not affect
flight, but a functional wing must use the area and force application point that the
simulation actually represents. Show the distinction in the editor. Engine lore should
describe the chosen simulation rules rather than invent a physical explanation afterward.

Fresh random seeds do not guarantee unique silhouettes. Use a large identifier space,
recipe hashes and optional similarity checks; avoid promising mathematical uniqueness.
An explicit copy or remix should remain possible. Reproducibility supports multiplayer,
ownership, saved garages and debugging.

</details>

<details>
<summary>Generate bodies from a shape language, then expose an editor</summary>

Syn3h already contains useful foundations. The jet's GameJet constructs close, medium
and far models from a shared design; HoverBody accepts a design builder, material roles
and detail budgets. These are authored procedural designs, not a general player studio.
Unique designs also reduce the benefit of caches currently shared by matching craft.

Begin with a constrained family: mirrored hull sections, a few cross-section handles,
cockpit placement and sockets for functional parts. Generate hull surfaces by lofting
sections; use extrusions for panels and revolved profiles for nozzles or wheel details.
Three.js provides extrusion and lathe geometry primitives, but joining them into attractive,
valid vehicles remains project work. See [ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html)
and [LatheGeometry](https://threejs.org/docs/pages/LatheGeometry.html).

Proposed editor progression: proportion sliders, silhouette handles, component placement,
then selective asymmetry and advanced sections. Keep undo, symmetry locks, clear selection
and a test-drive return path from the first prototype. Avoid starting with unrestricted
mesh editing, where self-intersections and fragile collision shapes dominate the work.

Encode the current style in inspectable rules: panel proportions, trim thickness,
material roles, restrained emissive regions, lamp placement and readable silhouettes.
Generate low-detail versions from the recipe rather than simplifying arbitrary output
at every spawn. Establish triangle, draw, material, transparent-surface and compile budgets
from device measurements. Build expensive geometry outside the frame loop and measure
arrival hitches when many different vehicles enter a room.

</details>

<details>
<summary>Make handling follow the mechanical design</summary>

Start with one wheeled family and a bounded operating envelope. Component masses and
positions determine total mass, center of mass and inertia. Wheelbase, track, steering
limits, tire model and suspension define contact behavior. Motor torque curves, gearing
and wheel radius define available drive force, subject to traction. Distinguish these
from convenience assists such as stability control and auto-leveling.

Rapier supports mass, center of mass and angular inertia, including contributions from
colliders. Explicit mass properties and collider densities must be coordinated to avoid
counting mass twice. This enables the proposed foundation but does not automatically
derive a drivetrain or aerodynamic model. See
[Rapier mass properties](https://rapier.rs/docs/user_guides/javascript/rigid_body_mass_properties/).

Use simple compound collision shapes or bounded convex parts for the first generated
vehicles. A detailed chrome grille does not need its own collider. Compare the contact
envelope with the visible body so the player can judge clearance. Extend to jets only
after force directions, thrust offsets, wing forces and stability have explicit contracts.

Generate a factual handling card from the recipe and measured trials: acceleration,
braking, turning, slope holding, landing recovery and flight stability where applicable.
The explanation should say which changes caused the result. Do not claim engineering
accuracy from a plausible-looking mesh or from an AI-written description.

</details>

<details>
<summary>Use frontier models as constrained design collaborators</summary>

Proposed flow: the player edits a rough shape and supplies intent; the model returns a
typed recipe patch selecting supported parts and bounded parameters. A validator checks
it, the procedural builder produces candidate vehicles, and test-drive measurements
accompany the preview. The player chooses what to keep and can undo or remix it.

Do not run model-generated JavaScript in the game. Use a small declarative vocabulary
with geometry, simulation and resource limits. Preserve the player's locked silhouette
and mechanical constraints, and show what changed. Mechanical suitability requires
validation even when the output parses correctly.

The ordinary game can continue loading procedural data rather than downloaded models
or texture packs. Model-produced pictures may help internal art direction, but a picture
is not a drivable body. No new runtime binary exception is implied by this proposal.

Compare procedural-only, model-guided recipes and offline model-assisted generator
authoring. Measure accepted designs per attempt, latency, cost including retries,
silhouette fidelity, style consistency, playability and editing effort. Current frontier
model suitability remains unbenchmarked. Select providers and allowances after that
evaluation; do not promise unlimited generations at either tentative subscription price.

</details>

<details>
<summary>Personal universes, planets and a social home</summary>

A proposed universe is persistent configuration and creations, plus permissions and
active room instances. It need not keep a physics process running while nobody is there.
Persist seeds, generator versions, settings, vehicle recipes, placed artifacts and
revisions. Define backup, export, restoration and migration behavior before charging
people to maintain a world.

Separate account identity from temporary room identity. Model ownership and roles
explicitly: owner, editor, invited visitor and public visitor. Friends lists need mutual
acceptance, blocking, visibility controls and opt-in joinability. Presence is an expiring
signal, not proof a person is still connected; reconnects and multiple devices need
reconciliation. A friend's private universe must not become discoverable through presence.

The existing room architecture uses Durable Objects. Cloudflare's hibernation API can
retain WebSocket connections while an idle object stops executing; it does not make
active simulation free or persist arbitrary in-memory state automatically. See
[WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
Research account storage, durable revisions and live rooms as separate concerns before
choosing additional services. No replacement networking stack is proposed here.

Hundreds of thousands of registered players, monthly active players and simultaneous
players are different capacity targets. Estimate active rooms, players per room,
messages per second, saved data and generation jobs separately. Test reconnect bursts
and regional latency before making a scale claim.

</details>

<details>
<summary>Subscription hypotheses and a community worth returning to</summary>

Proposed packaging for research, not decided entitlements:

| Offering | Candidate value | What must be measured |
|---|---|---|
| Free exploration | Join friends, use the core vehicles, discover public worlds | Retention, invitation success, room and support cost |
| Tentative $3.99 monthly | A modest persistent home universe and saved creations | Storage, active-room usage, support and payment overhead |
| Tentative $14.99 monthly | More creation capacity, advanced studio tools and a bounded model allowance | Successful-generation cost, retries, heavy-user usage and margin |

Recommendation: keep basic friendship and joining accessible, and sell creation capacity
and hosting rather than superior competitive handling. This is a proposal to support the
owner's social vision, not an approved business rule. Players need clear behavior when a
subscription ends: preserve or export their work under a stated retention policy, rather
than making an unexpected deletion part of the product.

Build the cost sheet from measured usage. Monthly contribution per payer equals collected
revenue less payment costs, hosting, storage, bandwidth, model jobs, support and other
variable costs. Include failed generations and free visitors supported by paid worlds.
Track heavy-use percentiles as well as averages. No conversion, retention or margin
forecast is justified yet, and current vendor prices must be checked when evaluating a
specific offering.

Research the social loop with a small cohort: discover a world, meet someone, make
something together, save it, and return through an invitation or an agreed event. Observe
whether people return voluntarily and whether creators can welcome newcomers. Expansion
also needs understandable reporting, room moderation and creator attribution. Monetization
should fund the experience people value; it should not interrupt an evening of exploration.

</details>

## Bounded next experiments

1. Inventory the existing procedural builders and vehicle physics contracts. Produce a
   field map linking visible dimensions to simulation inputs; list what is cosmetic.
2. Prototype a recipe for one family with a small curated seed set. Rebuild it on two
   clients, compare geometry and collision hashes, and measure construction/frame costs.
3. Add silhouette handles and a test-drive loop. Require readable shapes, valid collision,
   recoverable edits and handling within an agreed envelope before widening the grammar.
4. Compare model-assisted recipe edits against procedural-only suggestions using the same
   requests. Decide whether the measurable improvement warrants latency and expense.
5. Prototype saved universe revisions, access roles, invitations and presence separately.
   Verify persistence, recovery and privacy with a small invited group.
6. Use observed return visits and measured costs to propose subscription entitlements.
   Pricing, billing implementation and production rollout require a later concrete decision.

These experiments remain pending. Revisit at release-planning checkpoints when current
fixes and their validation no longer consume the available capacity.

## Evidence and limitations

Source inspection: src/vehicles/jetgen/GameJet.ts, src/vehicles/hover/HoverBody.ts and
src/vehicles/Syn3hBuggy.ts in the current integration checkout. Existing lazy model levels,
shared geometry caches, material roles and explicit suspension/drive behavior provide
starting points; they do not prove arbitrary generated designs will work.

Primary documentation linked above was read on 15 November 2026. It establishes available
building blocks only. No studio prototype, model benchmark, load test, paid-service
experiment or commercial viability test has run. Earlier local performance comments are
not fresh measurements for this proposal.

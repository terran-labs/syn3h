# Mars Explorer: technical architecture

How the original game works, read from the source on 2026-11-14. Paths are relative to
`unity/Assets/` in [terran-labs/unity3d-marsxplr](https://github.com/terran-labs/unity3d-marsxplr)
(MIT). Line numbers refer to that repository at its current `master`.

Claims are marked **[code]** when read directly from a file, and **[inference]** when deduced.

## Shape of the project

- Unity 4.6.1f1, almost entirely UnityScript (`.js`). About 7,900 lines of game script
  outside Standard Assets and the Whirld loader. **[code]**
- Scenes load in the order `Init`, `Lobby`, `InitGame`, `Game` (`_Scenes/`). Worlds
  ("Whirlds") live under `Whirlds/`: Freestyle, Lava Racer, Foxholes, Fort Boxy, Unity Island.
- The three biggest scripts are `Settings.js` (1,865 lines, the slider UI and its sync),
  `Game.js` (1,401, session and game mode) and `Lobby.js` (1,078, server list and hosting).
- The fan fork [VIA256/unity3d-marsxplr](https://github.com/VIA256/unity3d-marsxplr) is on
  Unity 6000.6.8f1 and builds for WebGL. Its commit log shows it got there by removing
  networking file by file ("temp remove networking: Vehicle", and so on), so it is single
  player. It is a useful visual reference and nothing we need to build on.

## The finding that matters most

**No vehicle uses Unity's `WheelCollider`.** Every vehicle is one rigid body plus raycasts
plus forces applied by hand in `FixedUpdate`. The whole vehicle physics layer is about 1,000
lines. That means the handling can be ported almost line for line onto any physics engine
that offers a rigid body, `castRay`, and `addForceAtPoint`. We do not have to approximate
the feel with someone else's car controller.

## Vehicles

Shared conventions: `vehicle.input` is a Vector4 (x steer, y pitch or drive, z throttle,
w yaw), `vehicle.brakes` and `vehicle.specialInput` are booleans. Forces use Unity's default
`ForceMode.Force` unless stated.

### Buggy (`Martian Assets/Vehicles/Buggy/Components/Scripts/Buggy.js`)

| Property | Value | Line |
| --- | --- | --- |
| Mass | 30 | 195 |
| Centre of mass | z = 0.2, y = `buggyCG * suspensionRange * 0.5` | 193-194 |
| Wheel radius | 0.30 | 48 |
| Suspension range | 0.4 at rest, 0.2 at top speed, 0.5 with wings open | 188 |
| Front steer angle | 40 degrees at rest falling to 30 at `buggySpeed` | 304 |
| Rear steer angle | 20 degrees at rest falling to 0 (counter steer) | 306 |

Algorithm, default "modified Yoggy" path (lines 392-425 and 428-433):

1. A virtual motor has a scalar `motorSpeed`. Throttle accelerates it, with acceleration
   fading to zero as it approaches `buggySpeed * 10`. Drag pulls it back, 50 times harder
   when braking.
2. For each of four wheels, raycast down the chassis `-up` axis for
   `suspensionRange + wheelRadius`.
3. On a hit, compute compression (0 to 1) and the wheel's velocity in wheel space.
4. Friction is `buggyTr * 9 * lerp(0.5, 1, compression) * max(1, (20 - speed) / 4)`. So grip
   is strongest at low speed and with loaded suspension.
5. Apply at the contact point: sideways force `-vx * friction`, drive force
   `-(vz - motorSpeed) * friction`, each clamped to 1000.
6. Feed the slip back into the motor: `motorSpeed += (vz - motorSpeed) * friction * dt / motorTorque`.
7. Suspension, applied at the wheel mount along chassis up:
   `-vy * buggySh + compression * 20 * mass`.

Extras: if a wheel stands on another rigid body it inherits a quarter of that body's velocity
(405), which is why you can ride on other vehicles. An experimental `buggyNewPhysics` path
exists (310-353) with static and dynamic friction states, but its sync key is commented out
in `Settings.js`, so the default path is the one players knew.

**Wings.** Space toggles `specialInput`, which opens wings (501-513) and turns the buggy
into a glider (210-281): above a stall threshold velocity is redirected along the nose each
step, pitch and roll torques scale with `buggyFlightAgility`, drag scales with speed over
`buggyFlightDrag`, and a "dihedral" term levels the wings when there is no steering input.
Flying low over lava adds a thermal lift (265-267).

**Water and lava.** Buoyancy uses a handful of float point transforms with a skip force at
high speed (455-466), so the buggy planes across liquid. Self righting applies a torque when
it rests inverted (487-495).

### Hovercraft (`Vehicles/Hovercraft/Components/Hovercraft.js`, 61 lines)

- Mass 50, centre of mass y = -0.3, inertia tensor forced to (15, 15, 15). (14-18)
- One raycast straight down, 30 units. Liquid counts as ground. (34-38)
- Hover force along craft up: `(hoverHeight - distance) * hoverHover`. (46)
- Anti collision: if the ground got closer since last step, add a velocity change along the
  ground normal of `min((last - distance) * hoverRepel, 10)`. (47)
- Aligning torque toward the ground normal, stronger when close. (49)
- Thrust is forward only. Sideways velocity is damped at `-10 * vx`. (25)
- A second raycast upward makes it duck under overhangs. (40-43)
- Steering torque: pitch 30, yaw 100, roll 200, with roll cut off past 40 degrees. (57-61)

### Tank (`Vehicles/Tank/Components/Scripts/`)

- Six track segments, three per side, 2.5 apart, each its own rigid body tied to the hull
  with a `ConfigurableJoint` (`Tank.js` 14-32, `TankTrack.js` 16-24).
- Drive happens inside `OnCollisionStay` of each track (`TankTrack.js` 37-109). Per contact:
  sideways drag `-vx * 150`, a small constant lift of 10, and forward force equal to motor
  power, or `-vz * 50` rolling drag when the motor is idle.
- Motor power is `tankPower * max(0.1, tankSpeed - vz) / tankSpeed`, smoothed over 2.5 s.
- Steering is skid steer: turning cuts power to the inside tracks. With no throttle, the
  two sides push in opposite directions at half power and the tank spins in place. (69-100)
- The force is applied above the contact by `tankGrip`, which is what lets it climb.
- Parked braking sets drag to 10000 below speed 3 (`TankMe.js` 7-12). Belly up recovery
  applies 5000 up and a large righting torque (26-40).

The jointed track bodies are the one part worth redesigning. Remote copies already swap
them for "simple tracks" (`Tank.js` 68-80), which shows the joints were a cost.

### Jet (`Vehicles/Jet/Components/Jet.js`, 219 lines)

Two modes, toggled by `specialInput`. It starts in hover mode (39).

- **Hover mode** (102-136): lift `throttle * hoverThrustFactor * weight` along craft up,
  auto levelling torque, steering torques scaled by mass, drag proportional to speed.
- **Flight mode** (139-189):
  - Air density falls with altitude: 1.225 at sea level to 0.188 at 5000. (143-144)
  - Angle of attack is the normalised local vertical velocity. (149)
  - Stall factor blends in below `jetStall` speed or at extreme angle of attack. (150-151)
  - Vectored main thruster: `throttle * 5 * weight * 0.99`, tilted by pitch input. (154-155)
  - Control torques scale with speed over stall speed and with air density. (158)
  - Lift is `jetLift * density * vz^2 * 15 * Cl`, with `Cl` clamped to 0.3. (169-172)
  - Drag is three times stronger sideways and vertically than forward. (187)
- Buoyancy iterates every vertex of the body collider mesh (196-204). A port should use a
  few float points instead.

## Networking

Built on Unity's legacy `Network` API with a master server for the lobby and optional NAT
punch through (`Lobby.js` 161-195, 363-391; `Game.js` 1101).

**Authority.** Each player simulates their own vehicle and tells everyone else where it is.
There is no server side physics.

- The owner sends position and rotation by RPC `sP` at `Network.sendRate`
  (`VehicleLocal.js` 17-20). Inputs go as RPC `s4`, quantised to tenths, at most once a
  second (22-26). No code sets `Network.sendRate`, so Unity's default of 15 per second
  applies. **[inference]**
- Receivers keep a 15 slot buffer of timestamped states (`VehicleNet.js` 16) and render the
  vehicle in the past by an interpolation delay of `max(0.1, ping * 1.5 + jitter * 8)`
  seconds (79). When the buffer runs dry they extrapolate for up to one second and then mark
  the player "Not Responding" (110-126).

**Why ramming works.** A remote vehicle within 40 units of the local player stays a live
dynamic rigid body. Each frame it is moved 10 percent of the way toward its interpolated
network pose and given the estimated velocity (`VehicleNet.js` 59, 92-97). Farther away it
becomes kinematic and is placed exactly. So nearby vehicles collide with real physics on
every client, and each client resolves its own vehicle's reaction. This is cheap, feels
good at low latency, and is trivially cheatable.

**Game mode.** Tag. One vehicle is "it" (`Vehicle.js` 15); ramming passes it on with a three
second cooldown (258-260). Lasers and sniper shots are RPCs (`fR`, `fS`, `fRl`, `fSl`).
A "Xorb" turns a vehicle into a rolling ball (`VehicleMe.js` 80-87).

## The settings system

This is the feature to carry forward. `Settings.js` declares about 55 world and vehicle
parameters (lines 66-128), draws a slider for each (lines 741-1271), and serialises them all
into one string of `key:value;` pairs (`packServerPrefs`, 1737-1806). The host broadcasts
that string with RPC `sSS` (1535) and every client applies it. Only the host or an admin can
change shared values.

Original slider ranges, which are the right starting defaults for the rebuild:

| Parameter | Default | Range |
| --- | --- | --- |
| World gravity | 9.81 | 0.81 to 18.81 |
| View distance | 5000 | 300 to 9700 |
| Lava altitude | -300 | -100 to 100 |
| Buggy power | 1.0 | 0.5 to 1.5 |
| Buggy speed | 30 | 5 to 55 |
| Buggy traction | 1.0 | 0.1 to 1.9 |
| Buggy shocks | 70 | 20 to 120 |
| Buggy centre of gravity | -0.4 | -0.1 to -0.7 |
| Buggy flight drag | 300 | 50 to 550 |
| Buggy flight agility | 1.0 | 0.5 to 1.5 |
| Tank power | 2000 | 500 to 3500 |
| Tank speed | 25 | 10 to 40 |
| Tank grip | 0.1 | 0 to 0.2 |
| Tank centre of gravity | -0.2 | 1 to -1.4 |
| Hover height | 15 | 5 to 25 |
| Hover force | 100 | 20 to 180 |
| Hover repel | 2.5 | 0.5 to 4.5 |
| Hover thrust | 220 | 20 to 420 |
| Jet hover drag | 0.01 | 0.005 to 0.015 |
| Jet drag | 0.001 | 0.0005 to 0.0015 |
| Jet steer | 20 | 5 to 35 |
| Jet lift | 0.5 | 0.1 to 0.9 |
| Jet stall speed | 20 | 1 to 39 |
| Laser speed | 180 | 20 to 340 |
| Xorb speed | 7 | 0.001 to 14 |
| Network interpolation | 0 (auto) | 0 to 0.5 |

## Terrain and worlds

- Terrain is Unity's built in `Terrain` with heightmaps and splat maps stored in binary
  `TerrainData` assets. `TerrainController.js` rewrites a sea floor splat channel whenever
  the sea level slider moves.
- The "Whirld" system (`Whirld/Core/WhirldIn.js`, 1,286 lines) loads community worlds at
  runtime from a text format plus asset bundles. Not studied in detail.
- Lava and sea are planes at `lavaAlt` with custom shaders (`Whirlds/Classics/Lava/Lava.shader`,
  `Whirld/ResourceSources/Sea/`). Every vehicle has its own buoyancy code against that altitude.

## Reusable assets

You own these and have authorised their reuse.

- Models: `Vehicles/Tank/Components/Meshes/Tank.blend` and `TankTread.blend`,
  `Vehicles/Hovercraft/Components/Model/Hovercraft.3ds`, `Vehicles/Buggy/Components/Buggy Wheels Simple.blend`.
  The buggy body and jet meshes were not found as source files here; the Syn3h repo has
  `Buggy.blend` and `Core Jet.blend`.
- Music and effects: `Martian Assets/Audio/` holds `Classic.mp3`, `Carefree.mp3`,
  `Ambient.mp3`, `LaserShot.mp3`, `LaserHit.mp3`, `Materialize.mp3`.
- Conversion to glTF needs Blender, which is not installed on this machine.

## Porting hazards

1. **Handedness.** Unity is left handed with +Z forward. Three.js and Rapier are right
   handed. Mirroring Z flips the sign of torques about X and Y. Port one vehicle, verify
   every input direction, then reuse the convention.
2. **Drag.** The scripts set `rigidbody.drag` every step, sometimes to 50 or 10000, and
   sometimes proportional to speed. Unity applies drag as `v *= 1 - drag * dt`. Rapier's
   damping uses `v *= 1 / (1 + drag * dt)`. Apply drag ourselves inside the vehicle code so
   the numbers keep their meaning.
3. **Timestep.** The constants were tuned at Unity's fixed timestep. `TimeManager.asset` is
   binary and I did not decode it; Unity's default is 0.02 s. Run the simulation at a fixed
   50 Hz with render interpolation.
4. **Euler angles.** Flight code reads `transform.eulerAngles` for roll and pitch. Derive
   them from the quaternion in the same YXZ order Unity uses.
5. **Layer masks.** Raycasts filter by layer (`terrainMask`, layer 4 for liquid, layer 14
   for vehicles). Map these to Rapier collision groups up front.

## Not studied

`Game.js` game flow, `Lobby.js`, the bot driver (`VehicleBot.js`), camera
(`CameraVehicle.js`), rockets, minimap, and the Whirld loader were skimmed or skipped. None
of them blocks the weekend goal.

# Syn3h actor inventory

Inspected the supplied `syn3h-client`, `syn3h-player-proprietary` and
`syn3h-client-proprietary-libraries` snapshots. Paths below are relative to
`syn3h-client/Assets` unless stated otherwise. This records available source,
not proof that every candidate shipped as a playable vehicle.

| Actor | Model and prefab | Behavior source and availability |
| --- | --- | --- |
| Buggy | `_Actors/Packages/Buggy/Components/Meshes/Buggy.blend`, `Buggy Wheels Simple.blend`; `_Actors/terra.buggy.prefab` | `_Actors/Packages/Buggy/Components/Scripts/VhiclBuggy.cs` |
| Jet | `_Actors/Packages/Jet/Components/Core Jet.blend`; older `Jet.jas`; `_Actors/terra.jet.prefab` | `_Actors/Packages/Jet/Components/VhiclJet.cs` |
| Hovercraft | `_Actors/Packages/Hovercraft/Components/Model/Hovercraft.jas`; `_Actors/Packages/Hovercraft/Hovercraft.prefab`. Alternative SketchUp component files and old 3DS also present. | Prefab controller GUID `f6aa30511de264fde964ac9c24f8b0b9` is absent in all three Syn3h snapshots. It resolves to Mars Explorer `Hovercraft.js` in the separate upstream source. Browser port retains that controller. |
| Android | `_Actors/Packages/Android/Android.blend` and its materials | No Android controller or actor prefab found. Model importer includes a Default Take. Not ported. |
| WeasleyMobile / MagicalCar | `_Actors/WeasleyMobile.prefab` | Composition references missing source prefabs `b883c715a05288141acf272c0c8fdaa6` and `7d28eb8cac9a69d4eb066db1df985ff4`. No resolved model or driver. |
| Nightmaragog | `_Actors/Nightmaragog.prefab` | Source prefab `bc600cce01eb57a409f4e69025868a2c` is missing, as is its other referenced asset `7cf2e21f08ba96340b61fc60381ad6af`. No resolved model or driver. |
| Sea monster | `_Scenes/Tholus/Sea Monster/SeaMonster.fbx`, interior and exterior textures/materials alongside it | Scene model; no dedicated controller found. No evidence here that it is playable. |

Shared actor behavior lives in `_Core/Scripts/Vhicl.cs`, `VhiclLocal.cs` and
`VhiclBot.cs`. Equipment and display actors are also present: `_Actors/Assets/Equipment/LaserAuto.prefab`,
`LaserSnipe.prefab` with `Components/VhiclLaser.cs`; `_Actors/Assets/Prefabs/ORB.prefab`,
`Marker.prefab`, `Marker Me.prefab`, `Marker Quarry.prefab` and `Components/VhiclPrefab.cs`.
These are not additional drivable vehicles.

## Proprietary repositories

Both proprietary snapshots contain vendor packages rather than additional resolved
Syn3h actor definitions. NWH Vehicle Physics 2 includes demo **MonsterTruck,
Euro Truck, RocketCarrier, Sports Car and Niva** under its `_Demo/Vehicles/`
directory. Their models and prefabs are in each named subdirectory; generic driving
code is `Scripts/Vehicle/VehicleController.cs` in player-proprietary and
`Scripts/VehicleController/VehicleController.cs` in client-proprietary-libraries.

NWH Dynamic Water Physics 2 includes **Queen Mary 2, TorpedoBoat, MotorBoat,
Submarine and Racer** under `Models/Ships/`, with ship prefabs under `Prefabs/Ships/`
and control code under `Scripts/ShipController/`. In player-proprietary these
packages start at `NWH/`; in client-proprietary-libraries they start at `Assets/NWH/`.
Their presence does not establish that Syn3h used them as selectable vehicles.

No tank model, prefab or dedicated controller was found in any of the three
snapshots. The public client has commented tank branches in `VhiclBot.cs` and an
old collision comment in `VhiclLocal.cs`. NWH includes generic controller comments
about tank rotation, fuel tank code and tank engine audio. None is a Syn3h tank.
The separately supplied Mars Explorer source does contain a tank.

## Search evidence and limits

Enumerated actor packages, actor prefabs and model files, indexed every `.meta`
GUID across all three repositories, and resolved the hovercraft, car and Nightmaragog
references against that index. Searched scripts and serialized scenes/prefabs for
tank, tracked vehicle, hovercraft and actor names. This inventory applies to the
supplied snapshots; missing prefab references may have existed elsewhere.

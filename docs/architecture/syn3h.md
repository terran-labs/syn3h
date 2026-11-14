# Syn3h (Unity): technical architecture

What the 2021 to 2022 Unity version of Syn3h was built from, read on 2026-11-14 from the
`terran-labs` GitHub organisation. This is a survey, not a line by line study: I read
project settings, the package manifest, the script inventory, and the headers of the key
scripts. Anything not listed under "Verified" is unread.

## Repositories

| Repository | Visibility | Licence | Contents |
| --- | --- | --- | --- |
| `syn3h-client` | public | GPL-3.0 | The Unity project. 65 C# files, about 10,800 lines. Last push 2022-06-01. |
| `syn3h-player-2020-urp-experiments` | public | GPL-3.0 | URP rendering experiments. Not read. |
| `syn3h-interface` | public | GPL-3.0 | Not read. |
| `syn3h-cloud`, `syn3h-cloud-sockets`, `syn3h-www` | public | GPL-3.0 | About 14 KB each. Not read. |
| `syn3h-player-proprietary` | private | none | Paid third party Unity assets (see below). |
| `syn3h-client-proprietary-libraries` | private | none | Not read beyond the top level. |
| `syn3h-client-proprietary-resources` | private | none | Not cloned. |

Licence note: the public Syn3h code is GPL-3.0 while Mars Explorer is MIT. You own both, so
you can relicense your own code however you like. It only matters if the new project takes
contributions or reuses third party code from those repos.

## Verified

**Engine.** Unity 2021.2.5f1, C#, built in render pipeline with Post Processing 3.1.1,
Burst, Jobs and the new Input System (`ProjectSettings/ProjectVersion.txt`,
`Packages/manifest.json`).

**Vehicles are Mars Explorer's, translated.** `Vhicl.cs`, `VhiclBuggy.cs` (625 lines),
`VhiclJet.cs` (228), `VhiclNet.cs`, `VhiclLocal.cs`, `VhiclMe.cs`, `VhiclBot.cs` and
`VhiclSkidmarks.cs` are C# ports of the UnityScript originals. `CoreSettings.cs` carries the
same buggy and jet parameters with the same defaults, except `jetDrag`, which is 0.0001
here against 0.001 in Mars Explorer.

**Vehicle roster in the public client.** `_Actors/Packages/` holds Buggy, Jet, Hovercraft
and Android. The hovercraft has a prefab and model but I found no hovercraft script, and
there is no tank at all. For the rebuild, the hovercraft and tank physics come from Mars
Explorer, and the buggy and jet can be cross checked against both.

**Networking moved to Photon.** `VhiclLocal.cs` sends the same `sP` and `s4` RPCs through
`PhotonNetwork` and `photonView` (lines 28-35). Most of `VhiclNet.cs` is commented out,
including the interpolation buffer. `CoreGameSparks.cs` and `CoreController.cs` reference a
GameSparks backend. Both services have since changed hands or shut down, so none of this is
reusable.

**Environment came from asset store packages.** The private `syn3h-player-proprietary`
repository contains Digger, Enviro Sky and Weather, MapMagic, MicroSplat, NWH, Visual Design
Cafe and Wrld. The public scripts wrap them: `CoreMapMagic.cs` (procedural terrain),
`CoreEnviro.cs`, `CoreTrueSky.cs`, `CoreUSky.cs` and `CoreSky.cs` (three interchangeable sky
systems behind a `CoreSkyMode` enum), `CoreHydroform.cs` (water), `CoreVegitationStudio.cs`,
`DynamicReliefTerrainQuality.cs`. The time of day and sea level controls in `CoreSettings.cs`
(`TimeSunrise`, `TimeSunset`, `TimeSpeedMax`, `SeaAltitudeMin`, `SeaAltitudeMax`) are the
ancestors of the sliders you want now.

**Real world terrain was attempted twice and both attempts are commented out.**

- `CoreWrld.cs` drove the WRLD3D SDK from a latitude and longitude in settings.
- `CoreGeoEngine.cs` drove the Online Maps asset with Bing Maps elevation, switching zoom
  level by camera altitude.
- `CoreFloatingOrigin.cs` (109 lines) recentres the world around the player, which any
  planet scale system needs. `LobbyCustomLocationSearch.cs` let players search for a place.

**Worlds.** Scenes named Valerius, Xylia, Mirador, Earth, Lucidar, Tholus, Ymir, Ammir and
Lobby.

## Housekeeping you should know about

- `Assets/_Core/Scripts/CoreSettings.cs` in the **public** `syn3h-client` repository contains
  a hard coded WRLD API key. WRLD's service may well be dead, but a committed key in a public
  repo is worth revoking or scrubbing.
- `_Core/Audio/Kai Engel - Chance.mp3` is by its filename a third party track. Check its
  licence before shipping it. The other audio files carry over from Mars Explorer.

## What carries over to the browser rebuild

| From Syn3h | Use |
| --- | --- |
| Buggy and jet C# ports | A second, typed reading of the same physics. Handy when a UnityScript expression is ambiguous. |
| `Buggy.blend`, `Core Jet.blend`, `Android.blend` | Vehicle models, once converted to glTF. |
| Time of day and sea level controls | Design precedent for the environment sliders. |
| Floating origin | Needed only when we stream real world terrain. |
| Everything from the asset store | Nothing. Those packages are Unity only and their licences do not cover a web port. |

The practical lesson of Syn3h's architecture is that it leaned on seven commercial Unity
packages for terrain, sky, water and vegetation. The web rebuild has to own those systems or
pick open ones, and that is where its real engineering cost sits. The vehicle code was never
the hard part.

## Questions the private source could answer

1. Is there a Syn3h hovercraft or tank script anywhere, or did only the buggy and jet ship?
2. NWH is a vehicle physics vendor. Was an NWH controller ever used for a Syn3h vehicle, and
   did it feel better than the hand written buggy?
3. Which sky system won: Enviro, TrueSky or uSky, and what did players actually adjust?
4. How far did the WRLD and Online Maps experiments get before they were commented out, and
   what killed them: performance, cost, collision quality or licensing?

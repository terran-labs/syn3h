# Syn3h interface reconstruction

Source inspected on 2026-11-14, before implementation. Source files were read, never executed.

## What the checkout actually contains

The usable layout is in `syn3h-client/Assets/_Core/Resources/_Runtime.prefab`, not the lobby scene alone. `_Scenes/_Lobby.unity` supplies the world and starfield. Both are text YAML, as are the UI prefabs and animation clips inspected. No binary layout file blocked recovery.

This checkout contains a later **Terra** rebrand: the files named `Logo.svg`, `logo.png`, `1024.png` and `432x163.png` visibly say Terra, and lobby links point at Terra.vision. The supplied Terran Labs brand-resource image actually says Syn3h. Use that Syn3h image, preserving the recovered interface treatment rather than shipping a Terra logo. `CoreUi.cs`, `LobbyScreens.cs`, `CoreAudio.cs` and `LobbyStarfield.cs` are fully commented out in this revision. They establish historical intent, not proof that this exact revision ran that way.

## Lobby flow recovered from serialized objects

The central window is 800 by 600 Unity UI units. `Screens` is centred at `(0, -60)`. The index has a 275 by 300 left column at `(-180, -10)` for a lobby message and About/Settings/Community links, with a 350-wide right column for destination buttons. Buttons generally use 20-point text; the standalone lobby-button prefab is 220 by 70. The active lobby destination buttons are Earth, Mirador, Xylia and Ammir. An alternate in-game column contains those destinations, Return to Game and Exit World; several actions are serialized inactive.

| Screen | Recovered content and destination |
| --- | --- |
| Index | Logo above the window, lobby message, destination buttons, About/Community, Exit, build version. Settings exists but is inactive in this prefab. |
| Worlds | “Worlds to Explore”; Earth, Mirador, Xylia, Ammir, Lucidar, Tholus, Valerius, Dune, Multiplayer and Custom World objects. World buttons call `LoadScene`; Back returns to Index. Some objects are inactive. |
| Earth | “Destination: Earth”; location search on the left and favourite cities on the right. Search calls location loading; Back returns to Index. |
| Stream World | “Load your custom world.” URL input, GO, supported `.utw` note and Back. |
| Streaming World | “Prepare to Explore”, percentage/message and Cancel. Selected automatically in Working mode. |
| Multiplayer | Coming-soon text and a Terra.vision link, not a recovered server browser. |
| Settings / About | Heading, Back and localized content hooks. Full historical copy is not present locally. |
| Downloading Update | Progress and Cancel. Relevant to the old native client, not this browser build. |

For the browser rebuild, keep the index/secondary-screen/Back flow and column proportions. Plug the working player/room setup, buggy colours, volcano, world/sky controls, music, scores and advanced sliders into those screens. Do not label unavailable Earth destinations, `.utw` import or desktop updater actions as working features. This content substitution is a deliberate adaptation.

## Transitions, logo and background

`LobbyScreens` switches the entire central screen along **depth**, not from the left or right. `_Runtime.prefab` sets `TransitionSpeed: 2`, `TransitionZOffset: -30`, `ActivationDelay: 1`. During the first second, quadratic ease-in-out moves local Z from 0 to -30 and fades alpha 1 to 0. At the midpoint it swaps screens. During the second second, quadratic ease-out returns Z to 0 and alpha to 1. The initial fast transition skips the outgoing half. The script's default three-second activation delay is overridden by the serialized one-second value.

`Logo Enter.anim` lasts 2.75 seconds: position `(0,225,50)` to `(0,225,0)` with zero endpoint tangents. Blue emission grows from 0 through 0.5 at 0.75 seconds to 2.5 at 2.75 seconds; green ends at 0.43165 and red remains zero. `Logo Idle.anim` is a one-second looping **empty clip**, with no rotation, scale or pulse keys. The persistent glow/particles provide the idle appearance. `Logo Exit.anim` moves Z back to 50 over 2.833333 seconds. The controller blends state changes over 0.25 seconds using `logo_visible`.

`CameraSlider.anim` separately moves camera Z from -10.037736 at 0 seconds, through -8.5867815 at 1.5 and -2.1729817 at 2, to 0 at 2.5; its clip ends at 5 seconds. `CoreUICamera` adds smoothed cursor/gyroscope parallax. These world-space depths do not map exactly to CSS pixels; matching perceived scale requires a running reference.

`LobbyStarfield` specifies downward random velocity `(0,-0.009,0)`. The scene also contains a Starfield particle system. The browser version can use slow particles behind the central logo without claiming an exact reproduction of Unity bloom and particle lighting.

## HUD and panels

`CoreUi` defines HUD, Locked, Fullscreen, Working and Diagnostics modes. HUD alpha fades linearly over 0.75 seconds. Its immediate-mode Core window is 250 pixels wide at `(25,25)`, with world exit/regeneration, vehicles, time, weather, ocean, photography, bots, speed/distance/altitude, graphics and diagnostics.

The newer serialized HUD has a 200-wide left sidebar, 20-unit edge insets, and sections Exit World, Chat, Explore, Create and Settings. Explore contains speed/distance/altitude/environment labels; Chat contains sample messages; headings are about 31 units high. However, the serialized HUD root has zero scale and its camera is named “Camera HUD WIP”. No horizontal panel-slide curves or complete controller for those sidebar sections were recovered. Do not claim a specific left/right slide timing as historical fact. The reusable browser panel switcher will use the recovered depth-and-fade transition; responsive drawer placement is an explicit phone adaptation.

## Visual treatment

The font GUIDs resolve to `Roboto-Thin.ttf` for 20-point lobby buttons and body text, and `Lato-Thin.ttf` for 30-point screen headings and 16-point sidebar headings. Button text is RGB `(0.792,0.792,0.792)` or `#cacaca`; the button image tint is `(0.2,0.22745,0.26667,0.9098)`, approximately `rgba(51,58,68,0.91)`. Headings are white. Secondary links are approximately `#aeaeae`. This is a cool dark, thin-type interface, not the orange Mars Explorer treatment. Use the supplied Syn3h logo with a blue glow, original font files and subdued charcoal panels.

## Music and provenance

The controller's AudioSource GUID resolves to **Kai Engel - Chance.mp3**, not Classic. It loops, starts at volume zero, and `CoreAudio` historically raises volume in Fullscreen/Working and lowers it in HUD at 0.1 volume units per second. Repo-wide searches of the three supplied repositories found no track-specific licence or attribution grant for Chance. Their general GPL licence does not establish a third-party music grant. **Do not copy or ship Chance.**

`Space Station SLOW LOOP.wav` is present in Syn3h's Audio folder, lasts 139.636 seconds and is an owner-supplied alternative, but is not the track referenced by this controller. Use a compressed copy as the default, explicitly recording this substitution. `ffmpeg` is available. Syn3h's `Ambient.mp3` is byte-identical to the already supplied Mars Explorer Ambient file. Keep Classic/Carefree/Ambient as optional legacy tracks, never the default. Exact historical lobby music awaits track-specific permission for Chance or an owner-selected alternative.

## References still needed for exact matching

The source supports a source-based reconstruction, not a claim of pixel-perfect fidelity to the owner's remembered Syn3h release. Needed references are:

1. A full-resolution Syn3h lobby screenshot after the logo settles, identifying which release predates the Terra rebrand.
2. Screenshots of that release's in-game HUD with Explore, Create, Settings and Chat expanded, plus the settings/lobby return screen.
3. A short recording of opening and closing those panels and entering/leaving the lobby, to resolve the unrecovered sidebar motion and logo camera/bloom treatment.

No complete original gameplay/lobby screenshots were found in the supplied UI/interface repositories. The separate `syn3h-interface` is a Preact scaffold with an empty Home route and Play/Settings/Account/Dev header, so it cannot settle the historical layout. `syn3h-www` contains only its licence in this checkout. Remote GameSparks language properties are absent; their original prose cannot be recovered from the empty localization fallback.

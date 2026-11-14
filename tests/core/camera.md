# Syn3h camera port

`ChaseCamera.target` and `update` remain compatible. Prefer `camera.setVehicle(player)` so the camera can read rigid-body velocity, `wingOpen` or `wingsOpen`, optional `kind === 'jet'`, `camSmooth`, `camOffset`, and a world-space `ridePosition` or `ridePos` Object3D. Without this binding, chase derives velocity from interpolated target positions; cockpit uses the original buggy ride height of 0.95 metres.

Controls: C cycles chase, cockpit, orbit, stationary and roam. Right click toggles cockpit, matching Syn3h's Fire2 mapping. Middle drag, Alt + left drag, or pointer-locked mouse movement looks around. Wheel or minus/plus changes distance; hold Z for scope and use the wheel for magnification. In roam, WASD moves horizontally relative to the camera, Q/E moves vertically and Shift runs. Roam captures its movement keys so they do not drive the car. Scoping uses Z because Syn3h's original Shift binding conflicts with this game's brakes. No original keyboard mode-cycle binding was found; C is additive.

## Source and defaults

- `CoreCamera.cs:177` initializes distance at 25 percent of its range. `_Runtime.prefab:8779-8780` supplies 0 to 25, giving 6.25 metres. `terra.buggy.prefab:586` adds CamOffset 3 metres. The total default camera arm is 9.25 metres.
- `_Runtime.prefab:8755-8795` supplies rotation smoothing 10 near and 5 far, distance smoothing 4, FOV smoothing 7, velocity smoothing 0.2, automatic rotation 3, ride rotation 5, vertical bump ratio 0.15, pitch response 1, clearance 0.5 and manual-look recenter delay 3 seconds. These override the C# field initializers.
- `CoreCamera.cs:642-703` aligns chase to velocity above 1 metre per second after the manual-look delay. Ground chase strips chassis roll. Ride rotation aligns to the vehicle. `CoreCamera.cs:733-766` projects the arm behind the smoothed rotation and shortens it against terrain.
- `CoreCamera.cs:409,525,529,773` sets third-person FOV 80 and ride FOV 70, divided by scope magnification in scope mode. There is no speed-based FOV change.
- `terra.buggy.prefab:262-270` supplies the fallback ride point at local Y 0.95. Cockpit hides the local car mesh because the current skins have no cockpit interior.
- `CoreCamera.cs:550-610` supplies the free-camera movement scheme. The shipped prefab uses roam speed 2 and run multiplier 10.

## Deliberate differences

The original speed smoother at `CoreCamera.cs:385` lerps its current value to itself, so speed-based distance never works. `camera.speedDistance` defaults to false to preserve that shipped framing. Enabling it uses the corrected smoother and the original prefab multiplier 0.05. Frame-rate-independent exponential smoothing replaces clamped delta-time lerps. Ground chase ignores nearly vertical motion while stopped to avoid an undefined yaw and a sudden downward view during spawn settling. Target-only binding treats implausible speeds above 200 metres per second as teleports.

The supplied source only references `flightCam` and `gyroCam` inside commented legacy code. The port adds flight alignment to the bound vehicle when wings are open or kind is jet. `camera.flight` defaults true and `camera.gyro` false, matching CoreSettings. Gyro optionally follows vehicle roll in flight and cockpit, smoothed at the original horizon rate of 20; normal driving remains level.

Terrain avoidance samples the complete arm at intervals no larger than 0.25 metres for the default arm, then clamps the final point above terrain. This works with the shared height interface and requires no collider query. It cannot detect overhangs or arbitrary prop meshes. The original sphere cast could detect those when included in its layer mask. Lobby alignment, loading fades, underwater post-processing and a far-plane override remain with their owning systems. CoreCameraUnderwater is entirely commented out in the supplied source; CoreCameraFade controls post-process fade rather than chase behavior.

The original distance and 80-degree FOV are retained even though they make today's smaller Mars Explorer model look small. A closer reference capture sets `camera.distance` to 2; this is a comparison, not a claim about Syn3h defaults. The incoming larger Syn3h model should be judged with the original defaults first.

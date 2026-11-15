# Syn3h camera

`ChaseCamera.target` and `update` remain compatible. Prefer `camera.setVehicle(player)` so the camera can read rigid-body velocity, `wingOpen` or `wingsOpen`, optional `kind === 'jet'`, `camSmooth`, `camOffset`, and a world-space `ridePosition` or `ridePos` Object3D. Without this binding, chase derives velocity from interpolated target positions; cockpit uses a buggy ride height of 0.95 metres.

Controls: C cycles chase, cockpit, orbit, stationary and roam. Right click toggles cockpit. Middle drag, Alt + left drag, or pointer-locked mouse movement looks around. Wheel or minus/plus changes distance; hold Z for scope and use the wheel for magnification. In roam, WASD moves horizontally relative to the camera, Q/E moves vertically and Shift runs. Roam captures its movement keys so they do not drive the car. Scoping uses Z because Shift conflicts with the brakes.

## Defaults

- Distance starts at 25 percent of its 0 to 25 metre range, giving 6.25 metres. The buggy adds a camera offset of 3 metres. The total default camera arm is 9.25 metres.
- Rotation smoothing 10 near and 5 far, distance smoothing 4, FOV smoothing 7, velocity smoothing 0.2, automatic rotation 3, ride rotation 5, vertical bump ratio 0.15, pitch response 1, clearance 0.5 and manual-look recenter delay 3 seconds.
- Chase aligns to velocity above 1 metre per second after the manual-look delay. Ground chase strips chassis roll. Ride rotation aligns to the vehicle. The arm is projected behind the smoothed rotation and shortened against terrain.
- Third-person FOV 80 and ride FOV 70, divided by scope magnification in scope mode. There is no speed-based FOV change.
- The fallback ride point is at local Y 0.95. Cockpit hides the local car mesh because the current skins have no cockpit interior.
- Roam speed 2 and run multiplier 10.

## Smoothing and flight

Speed-based distance is off: `camera.speedDistance` defaults to false. Enabling it uses a speed smoother with multiplier 0.05. Frame-rate-independent exponential smoothing is used rather than clamped delta-time lerps. Ground chase ignores nearly vertical motion while stopped to avoid an undefined yaw and a sudden downward view during spawn settling. Target-only binding treats implausible speeds above 200 metres per second as teleports.

The camera aligns to the bound vehicle in flight when wings are open or kind is jet. `camera.flight` defaults true and `camera.gyro` false. Gyro optionally follows vehicle roll in flight and cockpit, smoothed at a horizon rate of 20; normal driving remains level.

Terrain avoidance samples the complete arm at intervals no larger than 0.25 metres for the default arm, then clamps the final point above terrain. This works with the shared height interface and requires no collider query. It cannot detect overhangs or arbitrary prop meshes. Lobby alignment, loading fades, underwater post-processing and a far-plane override remain with their owning systems.

A closer reference capture sets `camera.distance` to 2; this is a comparison, not a claim about Syn3h defaults. The incoming larger Syn3h model should be judged with the default distance and 80-degree FOV first.

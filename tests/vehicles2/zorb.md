# Zorb mode

Press X to ride inside a force-field ball; press it again to get out. Code is in
`src/vehicles/zorb.ts`, wired through `Vehicle.ts`.

## Size and look

- Radius: the ball's scale is `ramoSpheres * 15 + camOffset` and its radius is half the scale.
  At the default size .5 a buggy (clearance 3) gets 5.25 m, a jet (5) 6.25 m and a hovercraft
  (2) 4.75 m.
- Colours: tag colour (.035, .565, 1, .278) and ram colour (0, 1, 0, .2275). The zorb ball rests
  at the ram colour's alpha .2275; its tint is the vehicle accent.
- Physics material: friction .1 and .1, bounciness .5 (`zorb.bounce` sets it live).
- Shading: a rim of 1 below facing ratio .08, falling to .14 by .78, over a grey marble with thin
  bright ridges tiled 4x4. Both are generated in the shader.

## Direction

Camera-local input directions (x, y, z) become (x, y, -z) in the three.js camera frame. Torques
are axial and become (-x, -y, z), matching `unityTorque`. Tests check three camera headings:
forward input moves away from the camera, right input to its right, back input toward it. The
horizontal spin is about up x velocity, so the ball rolls the way it travels. The torque uses
the full camera transform, so a camera pitched down also yaws the ball a little.

## Behaviour

- The ball appears at once.
- The ball centre sits .35 m above the vehicle's centre of mass. On the pivot, the buggy's mass
  .2 m ahead of it swung the car about 70 degrees nose down at rest.
- Switching off shrinks the ball (ramping to 4 m/s, slower than gravity) and sets the car down
  on its wheels, instead of dropping it from the middle of a 10 m ball. Switching off while
  bouncing can still land the car on its roof; the 3 s upright rescue covers the local player.
- Liquids: the ball floats with its base .4 m under water or lava, drag 1.2 x .15 per second in
  water and lava viscosity x .15 in lava, and the vehicle inside neither heats nor sticks. The
  shared liquid pass measured immersion at the ball centre and held a ball in deep lava forever.
- Controllers: no self righting, no upright rescue, no jet
  hover hold (it thrust along the tumbling jet's up axis), and the hovercraft rides passively (its
  glide grip and drag cut the ball to a third of its speed; its 15 m hover would float it).

## Evidence

`node tests/vehicles2/zorb-capture.mjs` against
`npx vite --port 5206 --strictPort --config tests/vehicles2/zorb-vite.config.ts` writes
`/tmp/syn3h-vehicles2/zorb/contact-sheet.png` and `results.json`: buggy at noon, night and
graphics level 0, each grown, rolling, just after an 18 m drop, and after switching off.
`KIND=jet,hovercraft,tank LABELS=noon` writes the other kinds to a subfolder.

On 14 November 2026: no page or console errors; the camera sat 11.6 m from the ball centre; the
ball rolled at 18 m/s after 2.4 s of W; drop impacts flared alpha to 1.2 to 1.7; every vehicle
ended upright on its wheels, tracks or skirt after switching off. The shield adds one draw call
(146 to 147 at night, 91 to 92 at level 0). Frame times on the shared headless host were too
noisy to attribute; no GPU timing was taken.

Night reads clearly. At noon the swirl and rim are readable but the cyan washes toward white over
bright desert, since an additive layer cannot darken; the contact caustic is subtle by day.

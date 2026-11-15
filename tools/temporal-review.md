# Temporal antialiasing

`post.temporal` defaults to true on the full post tier. Turning it off or selecting a lower
tier restores the existing scene pass with MSAA. The temporal path disables MSAA, writes
motion vectors, and uses Three's TRAA resolve before clouds and the remaining post effects.

The motion pass uses current and previous object/instance transforms and the same sphere
mapping used to draw the world. Bend anchors are copied each frame. A long pause, large
camera translation or abrupt rotation resets history. World seed, planet size, terrain kind,
curvature and camera mode changes rebuild it; resizing uses TRAA's own history reinitialization.

Procedural vertex shaders do not provide previous vertex positions. This includes grass,
water waves, particle billboards and motor sparks. Those pixels explicitly reject temporal
history through an out-of-frame reprojection sentinel. They render the current frame and do
not receive temporal accumulation. This is a deliberate coverage limit, not valid motion
data for a general-purpose motion-blur pass. Camera-based motion blur remains unchanged.

This avoids the original defect: stock velocity compared shader-placed grass and particles
with their original unit geometry, producing large motion vectors in a stationary view.
The object-identity diagnostic isolates that error from terrain and ordinary vehicle meshes.

Validation tools, each run through the shared absolute heavy-job helper:

* `tools/velocity-isolate.mjs URL OUTPUT --custom [--webgl]` checks stationary flat/curved
  geometry, analytic moving-box displacement and actual buggy/instanced-stator movement.
* `tools/temporal-acceptance.mjs URL OUTPUT [--webgl]` checks subpixel convergence, object
  and camera motion, intervening reflection rendering, seam/cut resets, resizing and tiers.
* `tools/post-entry-check.mjs URL OUTPUT [--webgl]` checks normal-entry defaults and the
  combined day/night renderer with GI, clouds and lighting enabled.
* `tools/post-profile.mjs URL OUTPUT --temporal` compares temporal off/on/on/off at 1080p.

CPU curve tests cover snapshot isolation and equivalent seam images. They do not replace
the GPU history and reset checks. Headless captures establish rendering correctness, not
physical iPad performance or the owner's preference for the final look.

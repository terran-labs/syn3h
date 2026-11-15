"""
Build the Syn3h buggy body variations from the original Buggy.blend.

    tools/heavy.sh blender -b --python tools/buggy-bodies/build.py -- \
        <path to Buggy.blend> <out dir for .glb> [<dir for preview renders>] [variant ids...]

Each variation starts from the owner's original body and canopy meshes, reshapes them with smooth
deformations (so the surfacing he sculpted is kept), restyles the spoiler, canopy and trim, and
adds parts the original file does not have (swish tail lights). The result is exported as
<out>/<id>.glb in the game's frame: nose toward -Z, Y up, origin at the vehicle origin, with
materials named Body, Accent, Chrome, Glass, Headlights and TailLights so the skin can tint them.

Blender frame used below: X right, Y back (nose at -Y), Z up. This is the frame the original
Body object evaluates to.
"""
import bpy, bmesh, sys, math, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 and argv[2] != '-' else None
ONLY = argv[3:]

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import VARIANTS  # noqa: E402


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bump(x, centre, half):
    """1 at centre, 0 beyond centre +- half, smooth."""
    t = min(1.0, abs(x - centre) / half)
    return (1 + math.cos(math.pi * t)) / 2


# ---- source meshes -------------------------------------------------------------------------

def evaluated_copy(name, matrix=None):
    """A new mesh datablock with modifiers applied, in world space (optionally re-posed)."""
    src = bpy.data.objects[name]
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg))
    me.transform(matrix if matrix is not None else src.matrix_world)
    return me, [s.material.name if s.material else None for s in src.material_slots]


def load_source():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    body, body_slots = evaluated_copy('Body')
    # The canopy half is stored standing on end and to one side: lay it down along the body
    # (its long axis is world Z in the file) and mirror it. Checked against the Unity prefab and
    # the game loader, which apply the same quarter turn.
    cockpit_src = bpy.data.objects['Cockpit']
    lay = Matrix.Rotation(math.radians(90), 4, 'X') @ cockpit_src.matrix_world
    canopy, _ = evaluated_copy('Cockpit', lay)
    return body, body_slots, canopy


def mirror_x(me):
    bm = bmesh.new(); bm.from_mesh(me)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    dup = bmesh.ops.duplicate(bm, geom=geom)['geom']
    verts = [g for g in dup if isinstance(g, bmesh.types.BMVert)]
    for v in verts: v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=[g for g in dup if isinstance(g, bmesh.types.BMFace)])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bm.to_mesh(me); bm.free()


# ---- materials -----------------------------------------------------------------------------

def material(name, color, metallic=0.0, roughness=0.5, emission=None, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if 'Coat Weight' in b.inputs: b.inputs['Coat Weight'].default_value = coat
    if emission:
        b.inputs['Emission Color'].default_value = (*emission[0], 1)
        b.inputs['Emission Strength'].default_value = emission[1]
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    m.diffuse_color = (*color, alpha)
    return m


def make_materials(v):
    paint = v.get('paint', {})
    return {
        'Body': material('Body', paint.get('body', (0.03, 0.07, 0.55)), 0.55, 0.22, coat=1.0),
        'Accent': material('Accent', paint.get('accent', (0.75, 0.03, 0.03)), 0.5, 0.25, coat=1.0),
        'Chrome': material('Chrome', (0.9, 0.92, 0.95), 1.0, 0.06),
        'Glass': material('Glass', paint.get('glass', (0.01, 0.012, 0.02)), 0.9, 0.04, alpha=paint.get('glassAlpha', 1.0)),
        'Headlights': material('Headlights', (1, 0.96, 0.75), emission=((1, 0.92, 0.6), 3)),
        'TailLights': material('TailLights', (0.9, 0.02, 0.02), 0.2, 0.3, emission=((1, 0.03, 0.02), 2.5)),
        'Dark': material('Dark', (0.012, 0.014, 0.018), 0.3, 0.6),
        'StrutMetal': material('StrutMetal', (0.1, 0.11, 0.125), 0.9, 0.28),
        'Interior': material('Interior', (0.035, 0.038, 0.045), 0.1, 0.75),
        'Glow': material('Glow', paint.get('accent', (0.75, 0.03, 0.03)), emission=(paint.get('accent', (0.75, 0.03, 0.03)), 2.5)),
    }


# ---- shape ---------------------------------------------------------------------------------

Y_NOSE, Y_TAIL, Z_FLOOR, Z_ROOF = -1.956, 2.053, -0.078, 0.934


def deform(co, v):
    """The variation's proportions, as a smooth map of the whole space around the body."""
    x, y, z = co
    s = v.get('shape', {})
    u = (y - Y_NOSE) / (Y_TAIL - Y_NOSE)          # 0 nose .. 1 tail
    h = (z - Z_FLOOR) / (Z_ROOF - Z_FLOOR)        # 0 floor .. 1 roof
    # Length: stretch or shorten the nose and the tail separately, leaving the cabin alone.
    y += (y - (-0.9)) * s.get('nose_len', 0) * smoothstep(-0.9, Y_NOSE, y) * 1.0 if y < -0.9 else 0
    y += (y - 1.0) * s.get('tail_len', 0) * smoothstep(1.0, Y_TAIL, y) if y > 1.0 else 0
    # Waist: pinch the flanks between the axles (a coke bottle plan), widest effect low down.
    x *= 1 - s.get('waist', 0) * bump(u, 0.5, 0.28)
    # Hips and shoulders: swell the body over the rear and front wheels.
    x *= 1 + s.get('hips', 0) * bump(u, 0.82, 0.2) * smoothstep(0.0, 0.5, h)
    x *= 1 + s.get('shoulders', 0) * bump(u, 0.2, 0.2) * smoothstep(0.0, 0.5, h)
    x *= 1 + s.get('width', 0)
    # Nose droop and tail kick: bend the ends down or up.
    z += s.get('nose_drop', 0) * -smoothstep(0.35, 0.0, u) ** 2
    z += s.get('tail_kick', 0) * smoothstep(0.7, 1.0, u) ** 2
    # Belly tuck: lift the lower edge toward the ends for approach and departure clearance.
    z += s.get('tuck', 0) * (1 - h) * (bump(u, 0.0, 0.3) + bump(u, 1.0, 0.3))
    # Cabin: raise or lower everything above the beltline around the cockpit.
    cabin = bump(u, s.get('cabin_at', 0.52), 0.3) * smoothstep(0.55, 1.0, h) * bump(x, 0, 0.9)
    z += s.get('cabin', 0) * cabin
    y += s.get('cabin_shift', 0) * smoothstep(0.5, 1.0, h) * bump(u, 0.52, 0.45)
    # Fender flares: a bulge over each axle, pushed out toward the wheel and raised into a crest
    # above it, so the fenders stand proud of the hood and deck like a Cobra's. The body is
    # waisted to about 0.75 at the axles and the tyres start at 1.07, which is the room there is.
    hoop = spoiler_weight(co)
    for key, at in (('fender_front', 0.16), ('fender_rear', 0.8)):
        f = s.get(key)
        if not f: continue
        # The rear hoop spoiler stands on the haunches behind the wheel: fade the bulge out
        # before it, and leave the hoop itself alone, or the spoiler buckles.
        w = bump(u, at, f.get('length', 0.2)) * (1 - hoop) * (1 - smoothstep(1.45, 1.75, co[1]))
        side = 1 if x >= 0 else -1
        # The tyres stand beside the body up to about z 0.33 at rest (inner edge at x 0.86), so
        # the bulge grows above them, as a fender over the wheel, and stays slim lower down.
        x += side * f.get('out', 0) * w * smoothstep(0.3, 0.75, abs(x)) * smoothstep(0.3, 0.7, h)
        z += f.get('up', 0) * w * bump(abs(x), f.get('crest', 0.62), 0.5) * smoothstep(0.3, 0.9, h)
    # Wheel scallops: draw the lower body in beside each wheel, under the fender line, so the
    # linkage between body and wheel is in the open instead of hidden in a 3 cm gap. The strut
    # mounts sit at x 0.55, so the body is not drawn in past about 0.58 there.
    sc = s.get('scallop', 0)
    if sc:
        w = max(bump(u, 0.165, 0.17), bump(u, 0.82, 0.17)) * (1 - smoothstep(0.38, 0.62, h))
        side = 1 if x >= 0 else -1
        # Pull toward the mount line by a fraction, so the flank stays a curve, not a flat cut.
        if abs(x) > 0.58: x = side * (0.58 + (abs(x) - 0.58) * (1 - min(0.85, sc * 2.6) * w))
    # Hood valley: drop the centre of the hood between the front fenders.
    z -= s.get('hood_valley', 0) * bump(u, 0.2, 0.25) * bump(x, 0, 0.38) * smoothstep(0.4, 0.9, h)
    # Roundness: push the mid height outward a little for a fuller, more inflated section.
    x *= 1 + s.get('round', 0) * bump(h, 0.45, 0.5) * bump(u, 0.5, 0.6)
    z *= 1 + s.get('height', 0)
    return Vector((x, y, z))


def spoiler_weight(co):
    """How much a point belongs to the rear hoop spoiler: high, far back."""
    x, y, z = co
    return smoothstep(1.35, 1.75, y) * smoothstep(0.62, 0.78, z)


def restyle_spoiler(me, v):
    s = v.get('spoiler', {})
    if not s: return
    for vert in me.vertices:
        w = spoiler_weight(vert.co)
        if w <= 0: continue
        x, y, z = vert.co
        z0 = 0.62
        z = z0 + (z - z0) * (1 + (s.get('height', 1) - 1) * w)
        y += s.get('reach', 0) * w
        x *= 1 + (s.get('span', 1) - 1) * w
        vert.co = (x, y, z)


def apply_shape(me, v, canopy=False):
    for vert in me.vertices:
        vert.co = deform(vert.co, v)
    if canopy:
        c = v.get('canopy', {})
        zc = min(vert.co.z for vert in me.vertices)
        yc = sum(vert.co.y for vert in me.vertices) / len(me.vertices)
        for vert in me.vertices:
            vert.co.z = zc + (vert.co.z - zc) * c.get('height', 1)
            vert.co.x *= c.get('width', 1)
            vert.co.y = yc + (vert.co.y - yc) * c.get('length', 1) + c.get('shift', 0)
    else:
        restyle_spoiler(me, v)


# The original tail light is a small kite on each rear corner, centred here (right side), with
# its tip pointing outboard. Larger lights are grown from it: the rear of the body is cut along
# the outline of a scaled kite, as seen from directly behind, and the faces inside take the
# tail light material. The light stays part of the body surface, not a part stuck on top.
TAIL_CENTRE = Vector((0.371, 1.966, 0.421))
# Kite corners as (outboard distance, height) from the centre: tip, top, inner, bottom.
TAIL_KITE = [(0.32, 0.0), (-0.03, 0.097), (-0.05, 0.0), (0.01, -0.06)]


def inside(poly, p):
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > p[1]) != (y2 > p[1]) and p[0] < (x2 - x1) * (p[1] - y1) / (y2 - y1) + x1: hit = not hit
    return hit


def cut_rear(bm, poly, side, slot, front=False):
    """
    Cut the rear of the body along a polygon drawn in the rear view and give the faces inside
    it a material. `poly` is (x, z) in metres; side 1 or -1 mirrors it onto that side, side 0
    uses it as drawn (for shapes that cross the centre line).
    """
    sign = side or 1
    if front:
        rear = lambda f: f.calc_center_median().y < -1.3 and f.normal.y < -0.05 and (side == 0 or f.calc_center_median().x * side > 0)
    else:
        rear = lambda f: f.calc_center_median().y > 1.25 and f.normal.y > 0.05 and (side == 0 or f.calc_center_median().x * side > 0)
    # Only faces under the outline are cut. A cutting plane is endless, so without this every
    # edge of the outline would slice the whole end of the car into slivers.
    lo_x, hi_x = min(p[0] for p in poly) - 0.01, max(p[0] for p in poly) + 0.01
    lo_z, hi_z = min(p[1] for p in poly) - 0.01, max(p[1] for p in poly) + 0.01
    def under(f):
        xs = [sign * v.co.x for v in f.verts]; zs = [v.co.z for v in f.verts]
        return max(xs) > lo_x and min(xs) < hi_x and max(zs) > lo_z and min(zs) < hi_z
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        faces = [f for f in bm.faces if rear(f) and under(f)]
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        # Each edge is a line in the rear view, so a plane parallel to the car's length.
        along = Vector((sign * (x2 - x1), 0, z2 - z1))
        if along.length < 1e-6: continue
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector((sign * x1, 0, z1)), plane_no=Vector((0, 1, 0)).cross(along).normalized(), clear_inner=False, clear_outer=False)
    # Cuts leave many-sided faces whose centre can fall outside them: split before testing.
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if rear(f) and under(f) and len(f.verts) > 3])
    for f in bm.faces:
        c = f.calc_center_median()
        if rear(f) and inside(poly, (sign * c.x, c.z)): f.material_index = slot


def kite(long=1.0, tall=1.0, shift=0.0, lift=0.0):
    """The original tail light outline, scaled about its centre, as a rear view polygon."""
    return [(TAIL_CENTRE.x + a * long + shift, TAIL_CENTRE.z + b * tall + lift) for a, b in TAIL_KITE]


def grown(poly, by):
    """A polygon enlarged about its centroid, for a trim surround."""
    cx = sum(p[0] for p in poly) / len(poly); cz = sum(p[1] for p in poly) / len(poly)
    return [(cx + (x - cx) * by, cz + (z - cz) * by) for x, z in poly]


def capsule(x0, x1, z0, z1, n=5, slant=0.0):
    """A rounded bar as a rear or front view polygon; slant leans its ends (metres at the top)."""
    r = (z1 - z0) / 2; zc = (z0 + z1) / 2
    pts = []
    for k in range(n + 1):
        a = -math.pi / 2 + math.pi * k / n
        pts.append((x1 - r + r * math.cos(a), zc + r * math.sin(a)))
    for k in range(n + 1):
        a = math.pi / 2 + math.pi * k / n
        pts.append((x0 + r + r * math.cos(a), zc + r * math.sin(a)))
    return [(x + slant * (z - zc) / max(r, 1e-6) * 0.5, z) for x, z in pts]


def ellipse(cx, cz, rx, rz, n=12):
    return [(cx + rx * math.cos(2 * math.pi * k / n), cz + rz * math.sin(2 * math.pi * k / n)) for k in range(n)]


def cut_lights(me, shapes, slot_of, front):
    bm = bmesh.new(); bm.from_mesh(me)
    for shape in shapes:
        for side in ((0,) if shape.get('centre') else (1, -1)):
            cut_rear(bm, shape['poly'], side, slot_of(shape['material']), front=front)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me); bm.free()


def grow_tail_lights(me, t, slot_of):
    """
    `t` is either {'long', 'tall', 'shift', 'lift'} (the original kite, scaled) or
    {'shapes': [{'poly': [...], 'material': name, 'centre': bool}, ...]} applied in order, so a
    chrome surround goes first and the lamp is cut inside it.
    """
    if not t: return
    shapes = t.get('shapes') or [{'poly': kite(t.get('long', 1), t.get('tall', 1), t.get('shift', 0), t.get('lift', 0)), 'material': 'TailLights'}]
    bm = bmesh.new(); bm.from_mesh(me)
    if t.get('shapes'):
        # New outlines replace the original kite instead of merging with it.
        old, paint = slot_of('TailLights'), slot_of('Body')
        for f in bm.faces:
            if f.material_index == old: f.material_index = paint
    for shape in shapes:
        for side in ((0,) if shape.get('centre') else (1, -1)):
            cut_rear(bm, shape['poly'], side, slot_of(shape['material']))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me); bm.free()


def clean(me, c):
    """
    Tidy a game-resolution body: weld stray duplicates, drop collapsed faces, make normals
    consistent, and mark creases sharper than `sharp` degrees so the exported normals split
    there. Without the split, smooth shading smears light across every crease, which is what
    made the reshaped bodies look lumpy.
    """
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=c.get('weld', 2e-4))
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    limit = math.radians(c.get('sharp', 42))
    for e in bm.edges:
        fs = e.link_faces
        e.smooth = not (len(fs) == 2 and (fs[0].normal.angle(fs[1].normal, 0) > limit or fs[0].material_index != fs[1].material_index and c.get('split_materials', True)))
    bm.to_mesh(me); bm.free()


def refine(me, r):
    """
    Turn the game-resolution triangle mesh into a smoother surface: pair triangles into quads,
    then subdivide (Catmull-Clark). Edges between two materials are creased so trim, lights and
    stripes keep a crisp outline instead of melting into the paint.
    """
    levels = r.get('levels', 0)
    if not levels: return
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bmesh.ops.join_triangles(bm, faces=bm.faces[:], cmp_materials=True, angle_face_threshold=math.radians(r.get('quad_angle', 40)), angle_shape_threshold=math.radians(r.get('quad_angle', 40)))
    crease = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and fs[0].material_index != fs[1].material_index: e[crease] = r.get('crease', 0.7)
        elif len(fs) == 1: e[crease] = 1.0
        elif len(fs) == 2 and fs[0].normal.angle(fs[1].normal, 0) > math.radians(r.get('sharp', 55)): e[crease] = r.get('sharp_crease', 0.5)
    bm.to_mesh(me); bm.free()
    tmp = bpy.data.objects.new('refineTmp', me); bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new('sub', 'SUBSURF'); mod.levels = levels; mod.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    # Copy the refined geometry back into the caller's datablock.
    bm = bmesh.new(); bm.from_mesh(out); bm.to_mesh(me); bm.free()
    bpy.data.meshes.remove(out)


# ---- added parts ---------------------------------------------------------------------------

def bvh_of(obj):
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.transform(obj.matrix_world)
    tree = BVHTree.FromBMesh(bm)
    return tree, bm


def ribbon_on_surface(name, body_obj, path, width, mat, lift=0.012, mirror=True, direction=None, samples=48):
    """
    A strip of the given width laid on the body along `path`, a list of (x, y, z) guide points
    near the surface. Each sample is projected onto the body (nearest point), so the strip
    follows the sculpted surface, then lifted a hair to avoid z fighting.
    `width` may be a number or a function of t in 0..1 (so swishes can taper).
    """
    tree, bm_body = bvh_of(body_obj)
    pts = [Vector(p) for p in path]

    def spline(t):
        # Catmull-Rom through the guide points.
        n = len(pts) - 1
        f = t * n; i = min(int(f), n - 1); u = f - i
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)

    rows = []
    for k in range(samples + 1):
        t = k / samples
        p = spline(t)
        loc, normal, _, _ = tree.find_nearest(p)
        tangent = (spline(min(1, t + 0.01)) - spline(max(0, t - 0.01))).normalized()
        side = normal.cross(tangent).normalized()
        w = width(t) if callable(width) else width
        row = []
        for e in (-1, -0.33, 0.33, 1):
            q = loc + side * (e * w / 2)
            ql, qn, _, _ = tree.find_nearest(q)
            row.append(ql + qn * lift)
        rows.append(row)
    bm_body.free()
    bm = bmesh.new()
    grid = [[bm.verts.new(p) for p in row] for row in rows]
    for a, b in zip(grid, grid[1:]):
        for j in range(len(a) - 1):
            bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    # Face outward: flip if the first face looks into the body.
    if mirror: mirror_x(me)
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def fix_outward(obj, body_obj):
    """Make every face of a surface decal point away from the body."""
    tree, bm_body = bvh_of(body_obj)
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    flip = []
    for f in bm.faces:
        c = f.calc_center_median()
        _, n, _, _ = tree.find_nearest(c)
        if f.normal.dot(n) < 0: flip.append(f)
    bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(me); bm.free(); bm_body.free()


# ---- cockpit ---------------------------------------------------------------------------------
#
# The canopy is a force field, nearly clear, and the camera sits inside it, so what lies under
# it is on show from both sides. The original body has only a flat deck there. This opens the
# deck and sinks a smooth bowl into the body, as inward-facing geometry of its own ('Interior',
# the shared system's trim role), with a few glowing spots ('Glow', the vehicle's accent light).

TUB = {'y': 0.02, 'half_len': 0.66, 'half_wid': 0.4, 'floor': 0.3, 'eye': 0.8}


def tub_outline(n=20, grow=1.0):
    """The cockpit opening in plan: a rounded rectangle (superellipse), nose at -Y."""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        c, sn = math.cos(a), math.sin(a)
        pts.append((TUB['half_wid'] * grow * (abs(c) ** 0.6) * (1 if c >= 0 else -1), TUB['y'] + TUB['half_len'] * grow * (abs(sn) ** 0.6) * (1 if sn >= 0 else -1)))
    return pts


def cut_cockpit(me):
    """Open the deck under the canopy along the tub outline. Returns the rim, on the body surface."""
    poly = tub_outline()
    bm = bmesh.new(); bm.from_mesh(me)
    deck = lambda f: f.calc_center_median().z > 0.5 and f.normal.z > 0.25 and abs(f.calc_center_median().x) < 0.6 and abs(f.calc_center_median().y - TUB['y']) < 0.85
    lo_x, hi_x = -TUB['half_wid'] - 0.01, TUB['half_wid'] + 0.01
    lo_y, hi_y = TUB['y'] - TUB['half_len'] - 0.01, TUB['y'] + TUB['half_len'] + 0.01
    def under(f):
        xs = [v.co.x for v in f.verts]; ys = [v.co.y for v in f.verts]
        return max(xs) > lo_x and min(xs) < hi_x and max(ys) > lo_y and min(ys) < hi_y
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        faces = [f for f in bm.faces if deck(f) and under(f)]
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        along = Vector((x2 - x1, y2 - y1, 0))
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector((x1, y1, 0)), plane_no=Vector((0, 0, 1)).cross(along).normalized(), clear_inner=False, clear_outer=False)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if deck(f) and under(f) and len(f.verts) > 3])
    gone = [f for f in bm.faces if deck(f) and inside(poly, (f.calc_center_median().x, f.calc_center_median().y))]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(me); bm.free()


def make_tub(body_obj, mats):
    """
    The cockpit interior, built to the opening cut_cockpit made: one smooth bowl from a chrome
    lip on the deck down to a flat bottom, with a few glowing spots set into it. No seat and no
    dash: nobody sits here. Faces point into the cabin, and the bowl is one unbroken surface, so
    it walls the cabin off from the inside of the hull.
    """
    tree, bm_body = bvh_of(body_obj)
    me = bpy.data.meshes.new('Interior')
    names = ['Interior', 'Glow', 'Chrome']
    for n in names: me.materials.append(mats[n])
    bm = bmesh.new()
    n = 20
    outline = tub_outline(n)
    deck = []
    for x, y in outline:
        # On the deck: cast down from above the canopy, a little outside the opening.
        hit, _, _, _ = tree.ray_cast(Vector((x * 1.04, TUB['y'] + (y - TUB['y']) * 1.04, 3)), Vector((0, 0, -1)))
        deck.append(hit.z if hit is not None else 0.7)
    floor = TUB['floor'] + 0.12
    def surface(k, g):
        """The bowl at outline point k (may be fractional), g of the way out from the centre."""
        k0 = int(math.floor(k)) % n; k1 = (k0 + 1) % n; f = k - math.floor(k)
        x = (outline[k0][0] * (1 - f) + outline[k1][0] * f) * g
        y = TUB['y'] + ((outline[k0][1] * (1 - f) + outline[k1][1] * f) - TUB['y']) * g
        top = deck[k0] * (1 - f) + deck[k1] * f - 0.03
        # A steep wall under the lip easing into a flat bottom: depth falls with g to the fourth.
        return Vector((x, y, floor + (top - floor) * g ** 4))
    def ring(g, lift=0.0):
        return [bm.verts.new(surface(k, g) + Vector((0, 0, lift))) for k in range(n)]
    def skin(a, b, material):
        for k in range(n):
            f = bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])); f.material_index = names.index(material)
    rim = [bm.verts.new((x, y, z + 0.004)) for (x, y), z in zip(outline, deck)]
    rings = [ring(g) for g in (0.96, 0.88, 0.74, 0.52, 0.26)]
    skin(rim, rings[0], 'Chrome')
    for a, b in zip(rings, rings[1:]): skin(a, b, 'Interior')
    centre = bm.verts.new(surface(0, 0))
    for k in range(n):
        f = bm.faces.new((rings[-1][k], rings[-1][(k + 1) % n], centre)); f.material_index = 0
    # Glowing spots: small lenses lying on the bowl, a large one at the centre and a ring of
    # small ones on the wall, all below the driver's sight line.
    spots = []
    def spot(k, g, r, m=8):
        c = surface(k, g)
        du = surface(k + 0.5, g) - surface(k - 0.5, g); dv = surface(k, min(1, g + 0.03)) - surface(k, max(0, g - 0.03))
        if du.length < 1e-6: du = Vector((1, 0, 0))
        if dv.length < 1e-6: dv = Vector((0, 1, 0))
        du.normalize(); nrm = du.cross(dv); nrm.normalize(); dv = nrm.cross(du)
        if nrm.z < 0: nrm = -nrm
        edge = [bm.verts.new(c + (du * math.cos(2 * math.pi * j / m) + dv * math.sin(2 * math.pi * j / m)) * r + nrm * 0.003) for j in range(m)]
        crown = [bm.verts.new(c + (du * math.cos(2 * math.pi * j / m) + dv * math.sin(2 * math.pi * j / m)) * r * 0.55 + nrm * (0.003 + r * 0.22)) for j in range(m)]
        top = bm.verts.new(c + nrm * (0.003 + r * 0.3))
        for j in range(m):
            f = bm.faces.new((edge[j], edge[(j + 1) % m], crown[(j + 1) % m], crown[j])); f.material_index = names.index('Glow'); spots.append((f, nrm))
            f = bm.faces.new((crown[j], crown[(j + 1) % m], top)); f.material_index = names.index('Glow'); spots.append((f, nrm))
    spot(0, 0, 0.1, m=10)
    # High on the wall, so the row ahead sits at the bottom edge of the driver's view.
    for k in (1.5, 5, 8.5, 11.5, 15, 18.5): spot(k, 0.86, 0.036, m=6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # recalc decides one way for the whole open shell; the bowl must face up into the cabin.
    spot_faces = {f for f, _ in spots}
    if sum(f.normal.z * f.calc_area() for f in bm.faces if f not in spot_faces) < 0:
        for f in bm.faces:
            if f not in spot_faces: f.normal_flip()
    # Each lens faces out of the bowl, whatever recalc chose for its little island.
    for f, nrm in spots:
        f.normal_update()
        if f.normal.dot(nrm) < 0: f.normal_flip()
    bm.to_mesh(me); bm.free(); bm_body.free()
    for p in me.polygons: p.use_smooth = True
    return me


# ---- suspension linkages -------------------------------------------------------------------
#
# The game places one strut per wheel with a single matrix: its origin on the wheel hub, its
# span running to the body mount (and a little past it, into the body), its thickness axis as
# near vertical as it can be, and it never spins or steers. A strut is modelled here in that
# frame: Blender Z is the span (hub at 0), Blender Y points up, X is the chord (fore and aft).
# Designs are symmetric fore and aft so the same mesh serves all four corners.

MOUNT = Vector((0.55, -1.2, 0.15))   # front right body mount (the prefab's AxelPos)
HUB = Vector((1.1, -1.3, -0.19))     # front right wheel centre at ride height
STRUT_SPAN = 0.83                    # the original Axle mesh's length


def loft(bm, stations, n=8, cap=True):
    """
    Skin a lens shaped section through `stations`: (span, chord, thickness, chord offset, up
    offset). Returns nothing; adds faces to bm. n points round the section.
    """
    rings = []
    for z, c, th, ox, oy in stations:
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            sx, sy = math.cos(a), math.sin(a)
            ring.append(bm.verts.new((ox + c / 2 * sx, oy + th / 2 * (abs(sy) ** 0.8) * (1 if sy >= 0 else -1), z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if cap:
        bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])


def tube(bm, p0, p1, r0, r1, n=6):
    """A round bar between two points in the strut frame."""
    axis = (Vector(p1) - Vector(p0)); length = axis.length; axis.normalize()
    side = axis.cross(Vector((1, 0, 0))); side = side.normalized() if side.length > 1e-3 else Vector((0, 1, 0))
    other = axis.cross(side)
    rings = []
    for p, r in ((Vector(p0), r0), (Vector(p1), r1)):
        rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / n) + other * math.sin(2 * math.pi * k / n)) * r) for k in range(n)])
    for k in range(n): bm.faces.new((rings[0][k], rings[0][(k + 1) % n], rings[1][(k + 1) % n], rings[1][k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[1])


def coilover(piece, bottom, top, spring=0.058, rod=0.022, coils=5):
    """A damper rod with a stack of rings standing in for the coil spring, and end collars."""
    b, t = Vector(bottom), Vector(top)
    piece('Chrome', lambda bm: tube(bm, b, t, rod, rod))
    piece('Chrome', lambda bm: tube(bm, b.lerp(t, 0.1), b.lerp(t, 0.15), spring * 1.15, spring * 1.15, n=8))
    piece('Chrome', lambda bm: tube(bm, b.lerp(t, 0.82), b.lerp(t, 0.87), spring * 1.15, spring * 1.15, n=8))
    for k in range(coils):
        f0 = 0.17 + (0.63 / coils) * k
        piece('Accent', lambda bm, f0=f0: tube(bm, b.lerp(t, f0), b.lerp(t, f0 + 0.63 / coils * 0.62), spring, spring, n=8))


# Top of each shock in the strut frame, per design: the body fitting for it is built there.
SHOCK_TOPS = {}
# Where the box arm carries its shock, in the strut frame.
SHOCK_FOOT = (0, 0.07, 0.2)


def make_shock(mats):
    """
    A shock absorber in its own frame: foot at the origin, one unit long along +Z. The game
    places one per wheel from the foot on the swinging arm to a fixed anchor inside the body,
    scaling it along its length, so the spring closes up as the wheel rises. Its top end is
    plain: it is always buried in the body.
    """
    names = ['Chrome', 'Accent']
    me = bpy.data.meshes.new('Shock')
    for n in names: me.materials.append(mats[n])
    bm = bmesh.new()
    def mark(start, material):
        for f in bm.faces[start:]: f.material_index = names.index(material)
    tube(bm, (0, 0, 0), (0, 0, 1), 0.026, 0.026, n=8)
    tube(bm, (0, 0, 0.05), (0, 0, 0.11), 0.088, 0.088, n=10)
    bm.faces.ensure_lookup_table(); mark(0, 'Chrome')
    # The spring: a helix of wire, four and a half turns.
    start = len(bm.faces)
    turns, per, R, r, z0, z1 = 4.5, 8, 0.066, 0.019, 0.12, 0.97
    stations = []
    count = int(turns * per)
    for k in range(count + 1):
        a = 2 * math.pi * k / per
        c = Vector((R * math.cos(a), R * math.sin(a), z0 + (z1 - z0) * k / count))
        out = Vector((math.cos(a), math.sin(a), 0)); up = Vector((0, 0, 1))
        # Triangular wire: a flat face outward, where it is seen.
        stations.append([bm.verts.new(c + out * r * 0.6 + up * r), bm.verts.new(c + out * r * 0.6 - up * r), bm.verts.new(c - out * r)])
    for a, b in zip(stations, stations[1:]):
        for j in range(3): bm.faces.new((a[j], a[(j + 1) % 3], b[(j + 1) % 3], b[j]))
    bm.faces.new(stations[0][::-1]); bm.faces.new(stations[-1])
    bm.faces.ensure_lookup_table(); mark(start, 'Accent')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return me


def make_strut(kind, mats, shock=True):
    """One strut in the strut frame, as a mesh with material slots [StrutMetal, Chrome, Accent]."""
    L = STRUT_SPAN
    parts = []   # (bmesh builder, material name)
    tops = SHOCK_TOPS.setdefault(kind, [])
    tops.clear()

    def piece(material, build):
        bm = bmesh.new(); build(bm); parts.append((bm, material))

    if kind == 'blade':
        # The original idea, cleaned up: a slim aerofoil that swells where it meets the body.
        piece('StrutMetal', lambda bm: loft(bm, [(0.02, 0.15, 0.07, 0, 0), (0.2, 0.15, 0.055, 0, 0), (0.5, 0.24, 0.06, 0, 0), (L, 0.44, 0.1, 0, 0)]))
        piece('Chrome', lambda bm: loft(bm, [(-0.03, 0.2, 0.11, 0, 0), (0.04, 0.2, 0.11, 0, 0)]))
    elif kind == 'wishbone':
        # A double wishbone seen from above: two slim arms spread at the body, joined at the hub.
        for sx in (-1, 1):
            piece('StrutMetal', lambda bm, sx=sx: loft(bm, [(0.03, 0.08, 0.06, sx * 0.03, 0), (0.45, 0.09, 0.05, sx * 0.14, 0), (L, 0.11, 0.07, sx * 0.24, 0)], n=6))
        piece('Chrome', lambda bm: loft(bm, [(-0.03, 0.2, 0.12, 0, 0), (0.06, 0.2, 0.12, 0, 0)]))
        piece('Chrome', lambda bm: tube(bm, (-0.17, 0, 0.52), (0.17, 0, 0.52), 0.018, 0.018))
    elif kind == 'coilover':
        # A slim lower blade carrying the load, with a spring and damper standing above it.
        piece('StrutMetal', lambda bm: loft(bm, [(0.02, 0.14, 0.06, 0, -0.02), (0.4, 0.17, 0.05, 0, -0.02), (L, 0.3, 0.07, 0, -0.02)]))
        piece('Chrome', lambda bm: loft(bm, [(-0.03, 0.2, 0.12, 0, 0), (0.05, 0.2, 0.12, 0, 0)]))
        piece('Chrome', lambda bm: tube(bm, (0, 0.05, 0.12), (0, 0.2, 0.72), 0.02, 0.02))
        piece('Accent', lambda bm: tube(bm, (0, 0.085, 0.26), (0, 0.17, 0.6), 0.05, 0.05, n=8))
    elif kind == 'frame':
        # An open frame: leading and trailing spars with a brace, light and see-through.
        for sx in (-1, 1):
            piece('StrutMetal', lambda bm, sx=sx: loft(bm, [(0.03, 0.05, 0.07, sx * 0.06, 0), (L, 0.06, 0.09, sx * 0.21, 0)], n=6))
        piece('StrutMetal', lambda bm: tube(bm, (-0.085, 0, 0.2), (0.16, 0, 0.6), 0.016, 0.016))
        piece('StrutMetal', lambda bm: tube(bm, (0.085, 0, 0.2), (-0.16, 0, 0.6), 0.016, 0.016))
        piece('Chrome', lambda bm: loft(bm, [(-0.03, 0.2, 0.12, 0, 0), (0.06, 0.2, 0.12, 0, 0)]))
    elif kind == 'delta':
        # A stub delta wing: narrow at the wheel, broad at the body, so the body seems to reach out.
        piece('StrutMetal', lambda bm: loft(bm, [(0.02, 0.14, 0.06, 0, 0), (0.3, 0.26, 0.055, 0, 0), (0.6, 0.48, 0.07, 0, 0), (L, 0.66, 0.11, 0, 0)]))
        piece('Accent', lambda bm: loft(bm, [(0.1, 0.03, 0.068, 0, 0), (0.62, 0.05, 0.08, 0, 0)], n=6, cap=False))
        piece('Chrome', lambda bm: loft(bm, [(-0.03, 0.2, 0.11, 0, 0), (0.04, 0.2, 0.11, 0, 0)]))
    elif kind == 'co-aarm':
        # A broad A-arm: two deep arms spread wide at the body with a web between them, and one
        # coilover from the arm near the hub up to a tower on the fender.
        for sx in (-1, 1):
            piece('StrutMetal', lambda bm, sx=sx: loft(bm, [(0.02, 0.13, 0.11, sx * 0.05, -0.02), (0.3, 0.14, 0.1, sx * 0.13, -0.02), (L, 0.17, 0.12, sx * 0.34, -0.02)]))
        piece('StrutMetal', lambda bm: loft(bm, [(0.1, 0.2, 0.035, 0, -0.03), (0.5, 0.42, 0.03, 0, -0.03), (0.74, 0.62, 0.03, 0, -0.03)], n=6))
        piece('Chrome', lambda bm: loft(bm, [(-0.04, 0.26, 0.16, 0, 0), (0.07, 0.26, 0.16, 0, 0)]))
        tops.append((0, 0.33, 0.6)); coilover(piece, (0, 0.05, 0.2), tops[-1])
    elif kind == 'co-box':
        # A heavy box section arm, tapered, with a raised rib, and a big single coilover.
        piece('StrutMetal', lambda bm: loft(bm, [(0.02, 0.24, 0.13, 0, -0.02), (0.3, 0.3, 0.12, 0, -0.02), (0.6, 0.46, 0.12, 0, -0.02), (L, 0.6, 0.14, 0, -0.02)], n=8))
        piece('Accent', lambda bm: loft(bm, [(0.12, 0.05, 0.15, 0, -0.01), (0.7, 0.07, 0.15, 0, -0.01)], n=6))
        piece('Chrome', lambda bm: loft(bm, [(-0.04, 0.3, 0.17, 0, 0), (0.06, 0.3, 0.17, 0, 0)]))
        tops.append((0, 0.35, 0.58))
        # shock=False: the shock is its own part, anchored in the body (see make_shock).
        if shock: coilover(piece, SHOCK_FOOT, tops[-1], spring=0.07, rod=0.026)
        else: piece('Chrome', lambda bm: tube(bm, (-0.11, SHOCK_FOOT[1], SHOCK_FOOT[2]), (0.11, SHOCK_FOOT[1], SHOCK_FOOT[2]), 0.04, 0.04, n=8))
    elif kind == 'co-twin':
        # A large aerofoil lower arm with a pair of shocks, one ahead of and one behind the axle.
        piece('StrutMetal', lambda bm: loft(bm, [(0.02, 0.28, 0.1, 0, -0.02), (0.28, 0.3, 0.09, 0, -0.02), (0.55, 0.5, 0.1, 0, -0.02), (L, 0.72, 0.13, 0, -0.02)]))
        piece('Chrome', lambda bm: loft(bm, [(-0.04, 0.3, 0.16, 0, 0), (0.06, 0.3, 0.16, 0, 0)]))
        for sx in (-1, 1):
            tops.append((sx * 0.17, 0.32, 0.6)); coilover(piece, (sx * 0.08, 0.04, 0.22), tops[-1], spring=0.045, rod=0.018)
    elif kind == 'co-fork':
        # Two thick round tubes forking from the hub to the body, braced, with one big coilover.
        for sx in (-1, 1):
            piece('StrutMetal', lambda bm, sx=sx: tube(bm, (sx * 0.05, -0.02, 0.03), (sx * 0.3, -0.02, L), 0.06, 0.075, n=8))
        piece('StrutMetal', lambda bm: tube(bm, (-0.16, -0.02, 0.38), (0.16, -0.02, 0.38), 0.035, 0.035))
        piece('StrutMetal', lambda bm: tube(bm, (-0.25, -0.02, 0.66), (0.25, -0.02, 0.66), 0.035, 0.035))
        piece('Chrome', lambda bm: loft(bm, [(-0.04, 0.28, 0.17, 0, 0), (0.07, 0.28, 0.17, 0, 0)]))
        tops.append((0, 0.36, 0.58)); coilover(piece, (0, 0.03, 0.38), tops[-1], spring=0.068, rod=0.026)
    else:
        raise ValueError(kind)
    names = ['StrutMetal', 'Chrome', 'Accent']
    out = bmesh.new()
    me = bpy.data.meshes.new('Strut')
    for n in names: me.materials.append(mats[n])
    for bm, material in parts:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        for f in bm.faces: f.material_index = names.index(material)
        tmp = bpy.data.meshes.new('tmp'); bm.to_mesh(tmp); bm.free()
        out.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    # from_mesh drops material indices across datablocks unless the slots match, so set again.
    out.to_mesh(me); out.free()
    for p in me.polygons: p.use_smooth = True
    return me


def strut_matrix(hub, mount):
    """Where the game puts a strut, in this file's frame (see the header of this section)."""
    span = (mount - hub).normalized()
    up = Vector((0, 0, 1))
    y = (up - span * up.dot(span)).normalized()
    x = y.cross(span)
    m = Matrix((x, y, span)).transposed().to_4x4(); m.translation = hub
    return m


def corners():
    for sx in (1, -1):
        for sy in (1, -1):
            flip = Vector((sx, sy, 1))
            yield Vector((MOUNT.x * sx, MOUNT.y * sy, MOUNT.z)), Vector((HUB.x * sx, HUB.y * sy, HUB.z))


def swell(bm, tree, centre, out, along, a, b, height, material_index, rings=4, seg=12, sink=0.012):
    """
    A smooth swelling of the body: a bell `height` tall over an ellipse (`a` along `along`, `b`
    across) on the body surface at `centre`, rising along `out`. Its rim lies on the body, just
    under the paint, and leaves it at a grazing angle, so it reads as the body's own surface
    reaching out to carry a part and not as a fitting stuck on. Parts may run into it anywhere.
    """
    u = (along - out * along.dot(out)).normalized(); w = out.cross(u)
    def at(s, j):
        ang = 2 * math.pi * j / seg
        flat = centre + u * (a * s * math.cos(ang)) + w * (b * s * math.sin(ang))
        hit, _, _, _ = tree.ray_cast(flat + out * 0.5, -out, 1.0)
        if hit is None: hit, _, _, _ = tree.find_nearest(flat)
        f = (1 - s * s) ** 2
        # The rim follows the body exactly; the crown is a clean dome over the tangent plane.
        return hit.lerp(flat, f) + out * (-sink + (height + sink) * f)
    loops = [[bm.verts.new(at(1 - k / rings, j)) for j in range(seg)] for k in range(rings)]
    for r0, r1 in zip(loops, loops[1:]):
        for j in range(seg):
            f = bm.faces.new((r0[j], r0[(j + 1) % seg], r1[(j + 1) % seg], r1[j])); f.material_index = material_index
    top = bm.verts.new(at(0, 0))
    for j in range(seg):
        f = bm.faces.new((loops[-1][j], loops[-1][(j + 1) % seg], top)); f.material_index = material_index


def skid_plate(bm, tree, material_index):
    """
    The underside as one smooth metal skid plate: a shallow belly running the length of the
    floor, turned up at the nose and tail like a sled, its edges tucked up into the body. It
    hangs just under the original floor, whose inset panel it covers.
    """
    def under(x, y):
        hit, _, _, _ = tree.ray_cast(Vector((x, y, -2)), Vector((0, 0, 1)))
        return None if hit is None else hit.z
    stations = []
    y = -1.8
    while y <= 1.56:
        mid = under(0, y)
        if mid is not None:
            # The floor ends where the underside climbs into a wheel arch or the body side.
            w = 0.3
            while w < 1.0 and (under(w + 0.03, y) or 9) < mid + 0.1: w += 0.03
            stations.append((y, w, min(under(x, y) or 9 for x in (0, w * 0.5, -w * 0.5, w * 0.9, -w * 0.9))))
        y += 0.24
    # Smooth the width and the keel line so the plate is fair, not a copy of the old floor.
    def smooth(vals):
        return [vals[i] if i in (0, len(vals) - 1) else (vals[i - 1] + 2 * vals[i] + vals[i + 1]) / 4 for i in range(len(vals))]
    ws = smooth(smooth([w for _, w, _ in stations])); zs = smooth([z for _, _, z in stations])
    m = 8
    rows = []
    for i, (y, _, _) in enumerate(stations):
        end = i in (0, len(stations) - 1)
        w = ws[i] * (0.8 if end else 1.0)
        row = []
        for k in range(m + 1):
            t = -1 + 2 * k / m
            # Ends and edges sit inside the body; the belly hangs a little below the old floor.
            z = zs[i] - 0.012 - 0.03 * (1 - t * t) + (0.05 * t ** 4 if not end else 0.05)
            row.append(bm.verts.new((w * t, y, z)))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(m):
            f = bm.faces.new((r0[k], r1[k], r1[k + 1], r0[k + 1])); f.material_index = material_index


def make_sockets(kind, body_obj, mats, towers=(), size=1.0, lamps=None, blend=None):
    """
    Where each strut meets the body: a fitting on the body side so the linkage reads as bolted
    to the structure, not poked through the paint. Found by casting from the wheel hub toward
    the mount onto the finished body, so it follows whatever shape the body has.
    """
    tree, bm_body = bvh_of(body_obj)
    names = ['Chrome', 'Dark', 'Body', 'Accent', 'Headlights']
    me = bpy.data.meshes.new('Sockets')
    for n in names: me.materials.append(mats[n])
    bm = bmesh.new()

    def ellipse_ring(centre, d, chord, e, a, b, n=12):
        return [bm.verts.new(centre + chord * (a * math.cos(2 * math.pi * k / n)) + e * (b * math.sin(2 * math.pi * k / n))) for k in range(n)]

    def skin(r0, r1, material):
        n = len(r0)
        for k in range(n):
            f = bm.faces.new((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k])); f.material_index = names.index(material)

    def disc(ring, material, reverse=False):
        f = bm.faces.new(ring[::-1] if reverse else ring); f.material_index = names.index(material)

    # Headlights as clean new parts: a domed lens in a chrome bezel set over each nose duct. The
    # original lamp is a few faces deep inside the duct; repainting the duct to enlarge it gave a
    # ragged outline, so the lens is its own geometry and covers the duct mouth.
    if lamps:
        rx, rz = lamps['rx'], lamps['rz']
        for side in (1, -1):
            cx, cz = side * lamps.get('x', 0.62), lamps.get('z', 0.33)
            # Rays from in front of the car onto the bezel line find the duct's rim and its lean.
            rim = []
            for k in range(12):
                a = 2 * math.pi * k / 12
                hit, n, _, _ = tree.ray_cast(Vector((cx + rx * 1.15 * math.cos(a), -4, cz + rz * 1.15 * math.sin(a))), Vector((0, 1, 0)))
                if hit is not None: rim.append((hit, n))
            if len(rim) < 6: continue
            # A plane through the rim hits (least squares on y = a x + b z + c) gives the lens's seat.
            import numpy as np
            A = np.array([[h.x, h.z, 1] for h, _ in rim]); yv = np.array([h.y for h, _ in rim])
            ax_, bz_, c_ = np.linalg.lstsq(A, yv, rcond=None)[0]
            normal = Vector((ax_, -1, bz_)).normalized()           # faces forward
            centre = Vector((cx, ax_ * cx + bz_ * cz + c_, cz)) + normal * 0.012
            right = normal.cross(Vector((0, 0, 1))).normalized(); upv = right.cross(normal)
            def lens_ring(r, out):
                return [bm.verts.new(centre + right * (rx * r * math.cos(2 * math.pi * k / 14)) + upv * (rz * r * math.sin(2 * math.pi * k / 14)) + normal * out) for k in range(14)]
            b0, b1, b2 = lens_ring(1.22, -0.03), lens_ring(1.2, 0.012), lens_ring(1.0, 0.018)
            skin(b0, b1, 'Chrome'); skin(b1, b2, 'Chrome')
            l1, l2 = lens_ring(0.72, 0.045), lens_ring(0.36, 0.06)
            skin(b2, l1, 'Headlights'); skin(l1, l2, 'Headlights'); disc(l2, 'Headlights')
            if lamps.get('halo'):
                # A thin chrome ring standing on the lens, a halo around the bright centre.
                h0, h1, h2 = lens_ring(0.62, 0.05), lens_ring(0.56, 0.062), lens_ring(0.5, 0.054)
                skin(h0, h1, 'Chrome'); skin(h1, h2, 'Chrome')
    if blend is not None:
        # The shipped body: no separate fittings. The body itself swells out to take each arm
        # root and each shock, and wears one skid plate underneath.
        for mount, hub in corners():
            d = (hub - mount).normalized()
            hit, normal, _, _ = tree.ray_cast(hub, -d)
            if hit is None: continue
            swell(bm, tree, hit, d, Vector((0, 1, 0)), 0.4, 0.16, 0.11, names.index('Body'))
            # The shock runs from its foot on the arm toward where the rigid coilover's top
            # stood at ride height. Its anchor is the body point nearest that, a little inside.
            m = strut_matrix(hub, mount)
            T = m @ Vector(towers[0])
            p, n, _, _ = tree.find_nearest(T)
            if (T - p).dot(n) < 0: n = -n
            blend.append({'corner': (mount.x, mount.y), 'top': p - n * 0.05})
            swell(bm, tree, p, n, d, 0.2, 0.17, 0.085, names.index('Body'))
        skid_plate(bm, tree, names.index('Chrome'))
    for mount, hub in ([] if blend is not None else corners()):
        d = (hub - mount).normalized()
        hit, normal, _, _ = tree.ray_cast(hub, -d)
        if hit is None: continue
        chord = Vector((0, 1, 0)); chord = (chord - d * chord.dot(d)).normalized()
        e = d.cross(chord)
        if kind == 'collar':
            # A chrome collar the strut passes through.
            a, b = 0.27, 0.12
            r0 = ellipse_ring(hit - d * 0.06, d, chord, e, a, b); r1 = ellipse_ring(hit + d * 0.03, d, chord, e, a, b)
            r2 = ellipse_ring(hit + d * 0.03, d, chord, e, a - 0.035, b - 0.035); r3 = ellipse_ring(hit - d * 0.06, d, chord, e, a - 0.035, b - 0.035)
            skin(r0, r1, 'Chrome'); skin(r1, r2, 'Chrome'); skin(r2, r3, 'Dark')
        elif kind == 'slot':
            # A dark recess with a chrome rim, wide enough for both wishbone arms.
            a, b = 0.34, 0.11
            rim0 = ellipse_ring(hit + d * 0.012, d, chord, e, a + 0.03, b + 0.03); rim1 = ellipse_ring(hit + d * 0.02, d, chord, e, a, b)
            well = ellipse_ring(hit - d * 0.05, d, chord, e, a - 0.02, b - 0.02)
            skin(rim0, rim1, 'Chrome'); skin(rim1, well, 'Dark'); disc(well, 'Dark')
        elif kind == 'pod':
            # A chrome cone reaching out from the body toward the wheel, as in the studio renders.
            k = size
            base = ellipse_ring(hit - d * 0.08, d, chord, e, 0.26 * k, 0.17 * k); mid = ellipse_ring(hit + d * 0.07, d, chord, e, 0.19 * k, 0.12 * k)
            tip = ellipse_ring(hit + d * 0.17, d, chord, e, 0.13 * k, 0.085 * k); mouth = ellipse_ring(hit + d * 0.15, d, chord, e, 0.1 * k, 0.06 * k)
            skin(base, mid, 'Chrome'); skin(mid, tip, 'Chrome'); skin(tip, mouth, 'Dark'); disc(mouth, 'Dark')
        elif kind == 'pocket':
            # A deep dark pocket with a slim chrome edge: the frame disappears into the body.
            a, b = 0.3, 0.13
            rim0 = ellipse_ring(hit + d * 0.01, d, chord, e, a + 0.018, b + 0.018); rim1 = ellipse_ring(hit + d * 0.016, d, chord, e, a, b)
            well = ellipse_ring(hit - d * 0.09, d, chord, e, a - 0.05, b - 0.04)
            skin(rim0, rim1, 'Chrome'); skin(rim1, well, 'Dark'); disc(well, 'Dark')
        elif kind == 'fairing':
            # A body coloured blister that swells out to meet the wing root, with an accent lip.
            base = ellipse_ring(hit - d * 0.1, d, chord, e, 0.46, 0.2); mid = ellipse_ring(hit + d * 0.05, d, chord, e, 0.4, 0.15)
            lip = ellipse_ring(hit + d * 0.13, d, chord, e, 0.35, 0.095); mouth = ellipse_ring(hit + d * 0.115, d, chord, e, 0.32, 0.07)
            skin(base, mid, 'Body'); skin(mid, lip, 'Body'); skin(lip, mouth, 'Accent'); disc(mouth, 'Dark')
        else:
            raise ValueError(kind)
        # Shock towers: where each shock's top meets the body, a paint coloured blister rises
        # from the fender and carries a chrome cup, so the spring has something to push on.
        m = strut_matrix(hub, mount)
        for top in towers:
            T = m @ Vector((top[0], top[1], top[2]))
            p, n, _, _ = tree.find_nearest(T)
            if (T - p).dot(n) < -0.2: continue
            axis = (m.to_3x3() @ Vector((0, 0.72, 0.69))).normalized()   # roughly along the shock
            u1 = n.cross(Vector((0, 1, 0))); u1 = u1.normalized() if u1.length > 1e-3 else Vector((1, 0, 0))
            u2 = n.cross(u1)
            rings = []
            for t, (r, h) in enumerate([(0.17, -0.02), (0.14, 0.035), (0.09, 0.07)]):
                rings.append([bm.verts.new(p + n * h + (u1 * math.cos(2 * math.pi * k / 10) + u2 * math.sin(2 * math.pi * k / 10)) * r) for k in range(10)])
            skin(rings[0], rings[1], 'Body'); skin(rings[1], rings[2], 'Body'); disc(rings[2], 'Dark')
            a1 = axis.cross(n); a1 = a1.normalized() if a1.length > 1e-3 else u1
            a2 = axis.cross(a1)
            cup = lambda c, r: [bm.verts.new(c + (a1 * math.cos(2 * math.pi * k / 10) + a2 * math.sin(2 * math.pi * k / 10)) * r) for k in range(10)]
            c0, c1, c2 = cup(T - axis * 0.05, 0.085), cup(T + axis * 0.03, 0.085), cup(T + axis * 0.055, 0.045)
            skin(c0, c1, 'Chrome'); skin(c1, c2, 'Chrome'); disc(c2, 'Chrome')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me); bm.free(); bm_body.free()
    for p in me.polygons: p.use_smooth = True
    return me


# ---- scene, render, export -----------------------------------------------------------------

def studio():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 860, 560, 100
    world = bpy.data.worlds.new('studio'); scene.world = world; world.use_nodes = True
    nt = world.node_tree; bg = nt.nodes['Background']
    # A soft gradient dome gives the chrome and the clear coat something to reflect.
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.02, 0.02, 0.025, 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (0.9, 0.93, 1.0, 1)
    nt.links.new(ramp.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 1.0
    for loc, energy, size in (((4, -5, 6), 900, 6), ((-5, 3, 4), 500, 8), ((0, 6, 3), 300, 6)):
        light = bpy.data.lights.new('key', 'AREA'); light.energy = energy; light.size = size
        o = bpy.data.objects.new('key', light); o.location = loc
        o.rotation_euler = (Vector((0, 0, 0.3)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(o)
    floor = bpy.data.meshes.new('floor'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30); bm.to_mesh(floor); bm.free()
    fo = bpy.data.objects.new('floor', floor); fo.location = (0, 0, -0.62); scene.collection.objects.link(fo)
    floor.materials.append(material('floorMat', (0.05, 0.05, 0.055), 0.0, 0.35))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 60
    return fo


# name: (direction to the camera, look-at point, framing radius)
VIEWS = {
    'front': ((1.0, -1.25, 0.55), (0, 0, 0.25), 3.3),
    'rear': ((-1.0, 1.25, 0.6), (0, 0, 0.25), 3.3),
    'side': ((1, 0, 0.1), (0, 0, 0.25), 3.3),
    'top': ((0, 0.02, 1), (0, 0, 0.25), 3.3),
    'tail': ((0.35, 1.0, 0.3), (0.0, 1.7, 0.4), 1.6),
    'nose': ((0.0, -1.0, 0.22), (0, 0, 0.3), 3.0),
    'link': ((0.0, -1.0, 0.1), (0.72, -1.3, 0.02), 0.55),
    'corner': ((0.75, -1.0, 0.5), (0.8, -1.3, 0.1), 0.95),
    'cabin': ((0.5, -0.9, 1.0), (0.0, 0.0, 0.6), 0.95),
    'face': ((0.25, -1.0, 0.25), (0.0, -1.7, 0.3), 1.5),
    'linktop': ((0.5, -0.5, 1.0), (0.85, -1.3, 0.0), 0.8),
}


def render_views(prefix, views=VIEWS):
    scene = bpy.context.scene; cam = scene.camera
    for name, (d, centre, radius) in views.items():
        cam.location = Vector(centre) + Vector(d).normalized() * radius * 3.1
        cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f'{prefix}_{name}.png'
        bpy.ops.render.render(write_still=True)


def wheels_for_preview(mats):
    """Stand-in wheels at the game's wheel rest positions, for the preview renders only."""
    objs = []
    tyre_src, _ = evaluated_copy('Wheel Template')
    tyre_mat = material('TyrePreview', (0.02, 0.02, 0.022), 0.0, 0.75)
    tyre_src.materials.clear(); tyre_src.materials.append(tyre_mat)
    for p in tyre_src.polygons: p.material_index = 0
    for sx in (-1, 1):
        for sy in (-1, 1):
            o = bpy.data.objects.new('wheelPreview', tyre_src)
            o.location = (sx * 1.1, sy * 1.3, -0.19)
            bpy.context.scene.collection.objects.link(o); objs.append(o)
    return objs


def build(v):
    body_me, body_slots, canopy_me = load_source()
    mats = make_materials(v)
    scene = bpy.context.scene
    # Hide everything from the source file.
    for o in list(scene.objects): o.hide_render = True
    # Body: remap the file's slots onto our named materials.
    remap = {'Body': 'Body', 'Accent': 'Accent', 'Chrome': 'Chrome', 'Headlights': 'Headlights', 'Tail Lights': 'TailLights'}
    trim = v.get('trim', {})
    names = [trim.get(remap.get(s, 'Body'), remap.get(s, 'Body')) for s in body_slots]
    # materials.clear() resets every face to slot 0, so keep the assignment across it.
    index = [p.material_index for p in body_me.polygons]
    body_me.materials.clear()
    for n in names: body_me.materials.append(mats[n])
    for p, i in zip(body_me.polygons, index): p.material_index = i
    # The file's Accent material covers both the centre stripe and the insides of the scoops.
    # Split them by position so a variation can treat them differently.
    extra_slots = {}
    def slot(name):
        if name not in extra_slots:
            body_me.materials.append(mats[name]); extra_slots[name] = len(body_me.materials) - 1
        return extra_slots[name]
    accent_i = body_slots.index('Accent'); tail_i = body_slots.index('Tail Lights')
    for p in body_me.polygons:
        if p.material_index == accent_i:
            key = 'stripe' if abs(p.center.x) < 0.32 else 'scoop'
            if key in trim: p.material_index = slot(trim[key])
        elif p.material_index == tail_i and 'tail' in trim:
            p.material_index = slot(trim['tail'])
    head_i = body_slots.index('Headlights')
    slot_of = lambda name: tail_i if name == 'TailLights' else head_i if name == 'Headlights' else slot(name)
    if v.get('tail'):
        grow_tail_lights(body_me, v['tail'], slot_of)
    if v.get('head'):
        cut_lights(body_me, v['head'], slot_of, front=True)
    apply_shape(body_me, v)
    # GAME=1 skips the subdivision: the shape changes are smooth deformations of the original
    # game-resolution mesh, so the body keeps its form at the original triangle count.
    if not (os.environ.get('GAME') or v.get('game')): refine(body_me, v.get('refine', {}))
    if v.get('tub'): cut_cockpit(body_me)
    if v.get('clean'): clean(body_me, v['clean'])
    body = bpy.data.objects.new('Body', body_me); scene.collection.objects.link(body)
    for p in body_me.polygons: p.use_smooth = True
    mirror_x(canopy_me)
    canopy_me.materials.clear(); canopy_me.materials.append(mats['Glass'])
    apply_shape(canopy_me, v, canopy=True)
    for p in canopy_me.polygons: p.use_smooth = True
    canopy = bpy.data.objects.new('Canopy', canopy_me); scene.collection.objects.link(canopy)
    parts = [body, canopy]
    if v.get('tub'):
        tub = bpy.data.objects.new('Interior', make_tub(body, mats)); scene.collection.objects.link(tub); parts.append(tub)
    # The strut first: its shock tops decide where the body's towers go.
    strut = None
    if v.get('strut'):
        strut = bpy.data.objects.new('Strut', make_strut(v['strut'], mats, shock=not v.get('blend'))); scene.collection.objects.link(strut)
        strut['own_frame'] = True
    if v.get('socket'):
        anchors = [] if v.get('blend') else None
        o = bpy.data.objects.new('Sockets', make_sockets(v['socket'], body, mats, towers=SHOCK_TOPS.get(v.get('strut'), ()), size=v.get('socket_size', 1.0), lamps=v.get('lamps'), blend=anchors))
        scene.collection.objects.link(o); parts.append(o)
        if anchors:
            shock = bpy.data.objects.new('Shock', make_shock(mats)); scene.collection.objects.link(shock)
            shock['own_frame'] = True
            # For the game, in its own axes (glTF: +Y up, nose toward -Z, after export's half
            # turn): the foot in the strut's frame and each wheel's anchor in the body's, in
            # the game's wheel order (front left, front right, rear left, rear right).
            shock['foot'] = [SHOCK_FOOT[0], SHOCK_FOOT[2], -SHOCK_FOOT[1]]
            order = sorted(anchors, key=lambda a: (a['corner'][1] > 0, a['corner'][0] < 0))
            shock['tops'] = [c for a in order for c in (-a['top'].x, a['top'].z, a['top'].y)]
            parts.append(shock)
    if strut: parts.append(strut)
    for extra in v.get('extras', []):
        kind = extra['kind']
        if kind == 'ribbon':
            path = [deform(Vector(p), v) for p in extra['path']]
            o = ribbon_on_surface(extra['name'], body, path, extra['width'], mats[extra['material']], lift=extra.get('lift', 0.012), mirror=extra.get('mirror', True))
            fix_outward(o, body)
            parts.append(o)
    return parts, mats


def export(parts, path):
    for o in bpy.context.scene.objects: o.select_set(False)
    # The game's nose points to -Z, which is +Y here after the Y up conversion: turn half a turn.
    turn = Matrix.Rotation(math.pi, 4, 'Z')
    for o in parts:
        # The strut is exported in its own frame; the game places it per wheel.
        if not o.get('own_frame'): o.data.transform(turn @ o.matrix_world); o.matrix_world = Matrix.Identity(4)
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_materials='EXPORT', export_extras=True)
    back = turn.inverted()
    for o in parts:
        if not o.get('own_frame'): o.data.transform(back)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for v in VARIANTS:
        if ONLY and ONLY != ['round2'] and v['id'] not in ONLY: continue
        if ONLY == ['round2'] and v.get('round', 1) != 2 and v['id'] != 'v4-widebody': continue
        parts, mats = build(v)
        if PREVIEW:
            os.makedirs(PREVIEW, exist_ok=True)
            studio(); wheels_for_preview(mats)
            placed = []
            for o in parts:
                if not o.get('own_frame'): continue
                o.hide_render = True
                for mount, hub in corners():
                    c = bpy.data.objects.new('strutPreview', o.data); c.matrix_world = strut_matrix(hub, mount)
                    bpy.context.scene.collection.objects.link(c); placed.append(c)
            render_views(os.path.join(PREVIEW, v['id']), {k: VIEWS[k] for k in v.get('views', VIEWS)})
        for o in list(bpy.context.scene.objects):
            if o.name.startswith('strutPreview'): bpy.data.objects.remove(o)
            elif o.name.startswith('wheelPreview') or o.name in ('floor', 'key', 'cam'): o.hide_render = True
        for o in parts: o.hide_render = False
        export(parts, os.path.join(OUT, v['id'] + '.glb'))
        # The chosen body also goes to public/, where the game loads it.
        # SHIP=1 ships a body built on its own (with variant ids given), leaving the review rounds alone.
        if v.get('ship') and (not ONLY or os.environ.get('SHIP')):
            export(parts, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models', v['ship']))
            print('SHIPPED', v['id'], v['ship'])
        tris = sum(len(p.vertices) - 2 for o in parts for p in o.data.polygons)
        print('BUILT', v['id'], 'triangles', tris)
        manifest.append({'id': v['id'], 'name': v['name'], 'notes': v.get('notes', []), 'file': v['id'] + '.glb', 'triangles': tris, 'round': v.get('round', 1), 'gameResolution': bool(v.get('game') or os.environ.get('GAME')),
                         **({'alsoIn': v['alsoIn']} if v.get('alsoIn') else {}), **({'basedOn': v['basedOn']} if v.get('basedOn') else {})})
    if not ONLY or ONLY == ['round2']:
        import json
        with open(os.path.join(OUT, 'index.json'), 'w') as f: json.dump(manifest, f, indent=1)


main()

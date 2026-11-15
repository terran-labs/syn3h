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
    'tail': ((0.7, 1.0, 0.35), (0.3, 1.5, 0.45), 1.5),
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
            o.location = (sx * 1.32, sy * 1.3, -0.1)
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
    apply_shape(body_me, v)
    refine(body_me, v.get('refine', {}))
    body = bpy.data.objects.new('Body', body_me); scene.collection.objects.link(body)
    for p in body_me.polygons: p.use_smooth = True
    mirror_x(canopy_me)
    canopy_me.materials.clear(); canopy_me.materials.append(mats['Glass'])
    apply_shape(canopy_me, v, canopy=True)
    for p in canopy_me.polygons: p.use_smooth = True
    canopy = bpy.data.objects.new('Canopy', canopy_me); scene.collection.objects.link(canopy)
    parts = [body, canopy]
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
        o.data.transform(turn @ o.matrix_world); o.matrix_world = Matrix.Identity(4)
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_materials='EXPORT')
    back = turn.inverted()
    for o in parts: o.data.transform(back)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for v in VARIANTS:
        if ONLY and v['id'] not in ONLY: continue
        parts, mats = build(v)
        if PREVIEW:
            os.makedirs(PREVIEW, exist_ok=True)
            studio(); wheels_for_preview(mats)
            render_views(os.path.join(PREVIEW, v['id']), {k: VIEWS[k] for k in v.get('views', VIEWS)})
        for o in bpy.context.scene.objects:
            if o.name.startswith('wheelPreview') or o.name in ('floor', 'key', 'cam'): o.hide_render = True
        export(parts, os.path.join(OUT, v['id'] + '.glb'))
        tris = sum(len(p.vertices) - 2 for o in parts for p in o.data.polygons)
        print('BUILT', v['id'], 'triangles', tris)
        manifest.append({'id': v['id'], 'name': v['name'], 'notes': v.get('notes', []), 'file': v['id'] + '.glb', 'triangles': tris})
    if not ONLY:
        import json
        with open(os.path.join(OUT, 'index.json'), 'w') as f: json.dump(manifest, f, indent=1)


main()

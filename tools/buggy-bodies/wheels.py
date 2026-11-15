"""
Lower-cost tyre options for the Syn3h buggy, for review in the vehicle lab.

    tools/heavy.sh blender -b --python tools/buggy-bodies/wheels.py -- "$PWD/labs/buggy-wheels" [<preview dir>]

The original tyre is 2,304 triangles a wheel (its tread is real geometry), more than twice the
whole body for a set of four. Each option here is a wheel with the same size and the same chrome
rim ring, built a cheaper way. Every file holds a node `Tyre` centred on the hub with the axle
along X (the frame the game's wheel uses); the lab keeps the original inner wing (the stator).

Blender frame here: X is the axle. The glTF export keeps X.
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None

R, HALF = 0.52, 0.245          # outer radius and half width of the original tyre
RING_IN, RING_OUT = 0.345, 0.40
LUGS = 14


def mat(name, color, metallic, roughness):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = roughness
    return m


def revolve(bm, profile, segs, slot, uv=None, closed=False):
    """Spin an (x, r) profile round the X axis. uv: per profile point v, or None."""
    layer = bm.loops.layers.uv.verify()
    rings = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        rings.append([bm.verts.new((x, r * math.cos(a), r * math.sin(a))) for x, r in profile])
    n = len(profile)
    for k in range(segs):
        a, b = rings[k], rings[(k + 1) % segs]
        for j in range(n if closed else n - 1):
            j2 = (j + 1) % n
            f = bm.faces.new((a[j], a[j2], b[j2], b[j])); f.material_index = slot; f.smooth = True
            if uv:
                us = (k / segs * LUGS, k / segs * LUGS, (k + 1) / segs * LUGS, (k + 1) / segs * LUGS)
                vs = (uv[j], uv[j2], uv[j2], uv[j])
                for loop, u, v in zip(f.loops, us, vs): loop[layer].uv = (u, v)


def lug_box(bm, x0, x1, a0, a1, half_t, height, slot):
    """A slanted tread block from (x0, angle a0) to (x1, angle a1) standing on the tread."""
    def p(x, a, r): return Vector((x, r * math.cos(a), r * math.sin(a)))
    da = half_t / R
    base = [p(x0, a0 - da, R - 0.01), p(x1, a1 - da, R - 0.025), p(x1, a1 + da, R - 0.025), p(x0, a0 + da, R - 0.01)]
    top = [p(x0, a0 - da * 0.8, R + height), p(x1, a1 - da * 0.8, R + height * 0.75), p(x1, a1 + da * 0.8, R + height * 0.75), p(x0, a0 + da * 0.8, R + height)]
    vb = [bm.verts.new(v) for v in base]; vt = [bm.verts.new(v) for v in top]
    faces = [vt] + [[vb[i], vb[(i + 1) % 4], vt[(i + 1) % 4], vt[i]] for i in range(4)]
    for f in faces:
        face = bm.faces.new(f); face.material_index = slot


# Carcass profile from the inner bead on one side, over the tread, to the other bead.
CARCASS = [(-0.2, RING_OUT), (-HALF, 0.44), (-0.235, 0.5), (-0.13, R), (0.13, R), (0.235, 0.5), (HALF, 0.44), (0.2, RING_OUT)]
CARCASS_V = [0, 0, 0.04, 0.2, 0.8, 0.96, 1, 1]
RING = [(-0.2, RING_OUT), (-0.19, RING_IN), (0.19, RING_IN), (0.2, RING_OUT)]


def tread_normal_map(path, size=256):
    """A chevron tread as a tangent space normal map, one lug per tile, tiling round the tyre."""
    v, u = np.mgrid[0:size, 0:size] / size
    d = np.abs(v - 0.5)
    phase = (u + d * 0.9) % 1.0
    lug = ((phase < 0.5) & (d < 0.46)).astype(np.float32)
    # Soften the block edges so the lighting reads as a moulded shoulder, not a paper cut.
    for _ in range(4):
        lug = (lug + np.roll(lug, 1, 0) + np.roll(lug, -1, 0) + np.roll(lug, 1, 1) + np.roll(lug, -1, 1)) / 5
    gu = (np.roll(lug, -1, 1) - np.roll(lug, 1, 1)) * 6
    gv = (np.roll(lug, -1, 0) - np.roll(lug, 1, 0)) * 6
    n = np.stack([-gu, -gv, np.ones_like(gu)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgba = np.concatenate([n * 0.5 + 0.5, np.ones((size, size, 1))], -1).astype(np.float32)
    img = bpy.data.images.new('tread-normal', size, size, alpha=False); img.colorspace_settings.name = 'Non-Color'
    img.pixels = rgba.ravel(); img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    return img


def build(option):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rubber = mat('Tire', (0.02, 0.02, 0.022), 0, 0.8); chrome = mat('Chrome', (0.9, 0.92, 0.95), 1, 0.06)
    accent = mat('Accent', (1.0, 0.35, 0.02), 0.4, 0.3)
    me = bpy.data.meshes.new('Tyre'); me.materials.append(rubber); me.materials.append(chrome); me.materials.append(accent)
    bm = bmesh.new()
    kind = option['kind']
    segs = option.get('segs', 16)
    if kind == 'lug':
        revolve(bm, CARCASS, segs, 0)
        for i in range(LUGS):
            a = 2 * math.pi * i / LUGS
            for sx in (-1, 1):
                lug_box(bm, sx * 0.01, sx * 0.235, a, a + 0.2, 0.05, 0.035, 0)
    elif kind == 'texture':
        revolve(bm, CARCASS, segs, 0, uv=CARCASS_V)
        img = tread_normal_map(os.path.join(OUT, 'tread-normal.png'))
        nt = rubber.node_tree; tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.5
        nt.links.new(tex.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], nt.nodes['Principled BSDF'].inputs['Normal'])
    elif kind == 'band':
        # A smooth tyre with a recessed accent band round the middle of the tread.
        profile = [(-0.2, RING_OUT), (-HALF, 0.44), (-0.235, 0.5), (-0.13, R), (-0.045, R), (-0.04, R - 0.02), (0.04, R - 0.02), (0.045, R), (0.13, R), (0.235, 0.5), (HALF, 0.44), (0.2, RING_OUT)]
        revolve(bm, profile, segs, 0)
        for f in bm.faces:
            c = f.calc_center_median()
            if abs(c.x) < 0.041 and math.hypot(c.y, c.z) > R - 0.04: f.material_index = 2
    revolve(bm, RING, segs, 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new('Tyre', me); bpy.context.scene.collection.objects.link(obj)
    if kind == 'lug':
        for p in me.polygons: p.use_smooth = False
    obj.select_set(True)
    path = os.path.join(OUT, option['id'] + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=False, export_apply=True)
    return len(me.polygons)


OPTIONS = [
    {'id': 'lug', 'name': 'Chunky lugs', 'kind': 'lug', 'notes': ['14 big chevron blocks on a plain carcass', 'Reads as an off-road tyre at any distance']},
    {'id': 'texture', 'name': 'Tread texture', 'kind': 'texture', 'notes': ['Smooth carcass; the tread is a small normal map, so it costs no triangles', 'One 256 pixel texture shared by every wheel in the game']},
    {'id': 'band', 'name': 'Accent band', 'kind': 'band', 'notes': ['Smooth tyre with a recessed band in your accent colour', 'Could glow with the motor like the stator tips']},
]

os.makedirs(OUT, exist_ok=True)
index = []
for o in OPTIONS:
    tris = build(o)
    index.append({'id': o['id'], 'name': o['name'], 'file': o['id'] + '.glb', 'notes': o['notes'], 'triangles': tris})
    print('WHEEL', o['id'], tris)
with open(os.path.join(OUT, 'index.json'), 'w') as f: json.dump(index, f, indent=1)

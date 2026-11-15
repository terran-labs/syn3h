"""
The body variations built by build.py. Every variation keeps the original mesh's own headlight
and tail light faces: the owner asked for those, not invented lights.

Frame: X right, Y back (nose at -1.96, tail at 2.05), Z up (floor -0.08, roof 0.93), metres.

shape    smooth changes of proportion (see deform() in build.py)
spoiler  height / span multipliers and rearward reach of the rear hoop
canopy   height / width / length multipliers and a rearward shift
trim     which material the centre stripe and the scoop interiors take
paint    preview colours only: the game tints Body and Accent per player
notes    what to look at, shown in the gallery
"""

REFINE = {'levels': 1}
NAVY = (0.02, 0.035, 0.3)

VARIANTS = [
    {
        'id': 'v1-heritage', 'name': 'Heritage',
        'notes': ['Your original proportions, untouched', 'Surface smoothed one level', 'Translucent purple canopy as in the last Syn3h build', 'Dark centre stripe'],
        'refine': REFINE,
        'paint': {'body': NAVY, 'accent': (0.03, 0.03, 0.035), 'glass': (0.55, 0.3, 0.8), 'glassAlpha': 0.45},
    },
    {
        'id': 'v2-reference', 'name': 'Reference',
        'notes': ['Pushed toward your studio renders', 'Shorter nose and tail, taller and rounder', 'Pinched waist, fuller rear haunches', 'Taller hoop spoiler', 'Dark glass teardrop canopy, no stripe, dark scoops'],
        'refine': REFINE,
        'shape': {'nose_len': -0.12, 'tail_len': -0.1, 'round': 0.08, 'height': 0.1, 'cabin': 0.06, 'waist': 0.08, 'hips': 0.08, 'tail_kick': 0.08, 'tuck': 0.06},
        'spoiler': {'height': 1.4, 'reach': 0.04},
        'canopy': {'height': 1.25, 'width': 1.04},
        'trim': {'stripe': 'Body', 'scoop': 'Dark'},
        'paint': {'body': (0.03, 0.07, 0.55)},
    },
    {
        'id': 'v3-speedster', 'name': 'Speedster',
        'notes': ['Long and low', 'Stretched nose and tail, dropped nose', 'Low canopy', 'Hoop spoiler flattened into a ducktail', 'Light stripe'],
        'refine': REFINE,
        'shape': {'nose_len': 0.14, 'tail_len': 0.18, 'height': -0.1, 'cabin': -0.05, 'nose_drop': 0.06, 'waist': 0.04},
        'spoiler': {'height': 0.3, 'reach': 0.1},
        'canopy': {'height': 0.8, 'length': 1.1},
        'paint': {'body': (0.03, 0.07, 0.55), 'accent': (0.9, 0.9, 0.92)},
    },
    {
        'id': 'v4-widebody', 'name': 'Wide body',
        'notes': ['Muscular: swollen front shoulders and rear haunches', 'Deep waist between the wheels', 'Wider hoop spoiler', 'Tucked belly for clearance', 'Dark scoops, bright stripe'],
        'refine': REFINE,
        'shape': {'hips': 0.15, 'shoulders': 0.1, 'waist': 0.12, 'width': 0.03, 'tuck': 0.07, 'tail_kick': 0.05},
        'spoiler': {'height': 1.1, 'span': 1.14},
        'trim': {'scoop': 'Dark'},
        'paint': {'body': (0.03, 0.07, 0.55), 'accent': (1.0, 0.35, 0.02)},
    },
    {
        'id': 'v5-bubble', 'name': 'Bubble',
        'notes': ['Compact and tall, a moon buggy', 'Short nose and tail, inflated body', 'Tall clear bubble canopy', 'Narrower, taller hoop spoiler'],
        'refine': REFINE,
        'shape': {'nose_len': -0.16, 'tail_len': -0.14, 'round': 0.1, 'height': 0.06, 'cabin': 0.05, 'tuck': 0.05},
        'spoiler': {'height': 1.25, 'span': 0.9},
        'canopy': {'height': 1.5, 'width': 1.08},
        'paint': {'body': (0.03, 0.2, 0.75), 'accent': (0.02, 0.03, 0.22), 'glass': (0.8, 0.85, 1.0), 'glassAlpha': 0.3},
    },
]

# ---- Round 2: the owner picked Wide body and asked for larger tail lights and more aggressive
# fender flares, "almost like the hood of a Cobra". All five start from the Wide body shape.
WIDE = {'hips': 0.15, 'shoulders': 0.1, 'waist': 0.12, 'width': 0.03, 'tuck': 0.07, 'tail_kick': 0.05}
WIDE_PAINT = {'body': (0.03, 0.07, 0.55), 'accent': (1.0, 0.35, 0.02)}


def wide(id, name, notes, shape, tail, **more):
    return {'id': id, 'name': name, 'notes': notes, 'round': 2, 'refine': REFINE, 'shape': {**WIDE, **shape},
            'spoiler': {'height': 1.1, 'span': 1.14}, 'trim': {'scoop': 'Dark'}, 'paint': WIDE_PAINT, 'tail': tail,
            'views': ['front', 'tail', 'nose'], **more}


VARIANTS += [
    wide('w1-flared', 'Flared', ['Wide body with a first step of flare over each wheel', 'Tail lights about 1.6 times larger'],
         {'fender_front': {'out': 0.14, 'up': 0.1}, 'fender_rear': {'out': 0.15, 'up': 0.1}},
         {'long': 1.6, 'tall': 1.6}),
    wide('w2-cobra', 'Cobra', ['Tall rounded front fenders standing above the hood', 'Hood dropped into a valley between them', 'Strong rear haunches', 'Tail lights twice as large'],
         {'fender_front': {'out': 0.2, 'up': 0.2}, 'fender_rear': {'out': 0.18, 'up': 0.14}, 'hood_valley': 0.08},
         {'long': 2.0, 'tall': 2.1}),
    wide('w3-haunches', 'Haunches', ['Rear biased: very large rear haunches, modest front flares', 'Long swept tail lights wrapping round the rear corners'],
         {'fender_front': {'out': 0.12, 'up': 0.08}, 'fender_rear': {'out': 0.25, 'up': 0.22, 'length': 0.24}},
         {'long': 2.7, 'tall': 1.35}),
    wide('w4-cokebottle', 'Coke bottle', ['Deepest waist, so both pairs of flares read strongly from above', 'Tall tail lights'],
         {'waist': 0.2, 'fender_front': {'out': 0.2, 'up': 0.14}, 'fender_rear': {'out': 0.22, 'up': 0.16}, 'hood_valley': 0.04},
         {'long': 1.5, 'tall': 2.5}),
    wide('w5-extreme', 'Extreme', ['Everything turned up: the biggest flares front and rear', 'Deep hood valley', 'Wider hoop spoiler', 'The largest tail lights'],
         {'width': 0.05, 'fender_front': {'out': 0.26, 'up': 0.26}, 'fender_rear': {'out': 0.26, 'up': 0.25, 'length': 0.24}, 'hood_valley': 0.1},
         {'long': 2.6, 'tall': 2.6}, spoiler={'height': 1.15, 'span': 1.25}),
]

# ---- Round 3: the owner kept Wide body and asked for refined suspension linkages, a body
# that looks structurally connected to them, more striking tail lights, and previews at the
# polygon counts that would ship. So these are not subdivided: 'game' builds the original
# game-resolution mesh. Tail light outlines are (x, z) in the rear view, in metres.
CX, CZ = 0.371, 0.421   # centre of the original tail light


def slats():
    """Three slanted bars, longest at the bottom, like claw marks."""
    out = []
    for i in range(3):
        z0, tip = CZ - 0.085 + i * 0.07, CX + 0.44 - i * 0.09
        out.append({'poly': [(CX - 0.07, z0), (tip, z0 + 0.035), (tip - 0.02, z0 + 0.075), (CX - 0.07, z0 + 0.042)], 'material': 'TailLights'})
    return out


SWEPT = [(CX - 0.08, CZ - 0.035), (CX + 0.2, CZ - 0.06), (CX + 0.62, CZ + 0.03), (CX + 0.2, CZ + 0.085), (CX - 0.08, CZ + 0.06)]


def round3(id, name, notes, strut, socket, tail):
    from build import kite, grown  # the builder's outline helpers
    return {'id': id, 'name': name, 'notes': notes + ['Lower body drawn in beside each wheel so the linkage is in the open'], 'round': 3, 'game': True, 'shape': {**WIDE, 'scallop': 0.3},
            'spoiler': {'height': 1.1, 'span': 1.14}, 'trim': {'scoop': 'Dark'}, 'paint': WIDE_PAINT,
            'strut': strut, 'socket': socket, 'tail': {'shapes': tail(kite, grown)}, 'views': ['front', 'tail', 'link', 'linktop']}


VARIANTS += [
    round3('r1-blade', 'Blade', ['Linkage: one slim aerofoil blade, swelling where it meets the body', 'Body: a chrome collar the blade passes through', 'Tail lights: the original kite, half as large again, set in a chrome surround'],
           'blade', 'collar', lambda kite, grown: [{'poly': grown(kite(1.5, 1.5), 1.22), 'material': 'Chrome'}, {'poly': kite(1.5, 1.5), 'material': 'TailLights'}]),
    round3('r2-wishbone', 'Wishbone', ['Linkage: twin arms spread at the body and joined at the hub, with a cross bar', 'Body: a dark recess with a chrome rim that takes both arms', 'Tail lights: three slanted bars each side'],
           'wishbone', 'slot', lambda kite, grown: slats()),
    round3('r3-coilover', 'Coilover', ['Linkage: a slim lower blade with a spring and damper standing above it', 'Body: chrome cone pods reaching toward the wheels, as in your studio renders', 'Tail lights: a long swept blade in a chrome surround'],
           'coilover', 'pod', lambda kite, grown: [{'poly': grown(SWEPT, 1.2), 'material': 'Chrome'}, {'poly': SWEPT, 'material': 'TailLights'}]),
    round3('r4-frame', 'Space frame', ['Linkage: an open frame of two spars with cross bracing', 'Body: deep dark pockets with a slim chrome edge', 'Tail lights: a large kite with a smaller one inboard'],
           'frame', 'pocket', lambda kite, grown: [{'poly': kite(1.7, 1.7, 0.1), 'material': 'TailLights'}, {'poly': kite(0.5, 0.9, -0.105), 'material': 'TailLights'}]),
    round3('r5-delta', 'Delta', ['Linkage: a stub delta wing, narrow at the wheel and broad at the body, with an accent spine', 'Body: paint coloured fairings that swell out to meet the wing roots', 'Tail lights: a full width bar joining two kites'],
           'delta', 'fairing', lambda kite, grown: [{'poly': [(-0.62, CZ - 0.012), (0.62, CZ - 0.012), (0.62, CZ + 0.03), (-0.62, CZ + 0.03)], 'material': 'TailLights', 'centre': True}, {'poly': kite(1.5, 1.6, 0.12), 'material': 'TailLights'}]),
]

# ---- Round 4: the owner picked the round 3 Coilover. Asked for: larger lower suspension
# members, shock attach points thought through on the body, cleaner tail lights that do not
# cross other geometry, more prominent headlights, and tidier geometry overall.
#
# Tail lights stay inside the flat rear panel between the centre stripe and the rear corner
# (x 0.30 to 0.66, z 0.36 to 0.50), so they never cross the stripe, the corner or the spoiler.
# Headlights: the original lamp sits in a chrome duct centred near (0.62, 0.33) in the front view.
HX, HZ = 0.62, 0.33


def round4(id, name, notes, strut, tail, head, socket_size=1.25):
    from build import capsule, ellipse, grown
    return {'id': id, 'name': name, 'notes': notes, 'round': 4, 'game': True, 'basedOn': 'Coilover',
            'shape': {**WIDE, 'scallop': 0.3}, 'spoiler': {'height': 1.1, 'span': 1.14}, 'trim': {'scoop': 'Dark'}, 'paint': WIDE_PAINT,
            'strut': strut, 'socket': 'pod', 'socket_size': socket_size, 'clean': {'sharp': 42},
            'tail': {'shapes': tail(capsule, ellipse, grown)}, 'lamps': head,
            'views': ['front', 'tail', 'corner', 'face']}




VARIANTS += [
    round4('c1-aarm', 'A-arm', ['Lower member: a broad A-arm, two deep arms and a web, about three times the old blade', 'One coilover from the arm to a tower raised from the fender', 'Tail lights: one rounded bar each side, inside the rear panel', 'Headlights: a domed lens in a chrome bezel over each nose duct, about twice the old lamp'],
           'co-aarm', lambda capsule, ellipse, grown: [{'poly': capsule(0.30, 0.66, 0.40, 0.47), 'material': 'TailLights'}],
           {'rx': 0.14, 'rz': 0.12}),
    round4('c2-box', 'Box arm', ['Lower member: a heavy tapered box section with an accent rib', 'One large coilover to a fender tower', 'Tail lights: two slim stacked bars each side', 'Headlights: larger lens with a chrome halo ring'],
           'co-box', lambda capsule, ellipse, grown: [{'poly': capsule(0.30, 0.66, 0.445, 0.49), 'material': 'TailLights'}, {'poly': capsule(0.30, 0.60, 0.375, 0.42), 'material': 'TailLights'}],
           {'rx': 0.15, 'rz': 0.125, 'halo': True}),
    round4('c3-twin', 'Twin shock', ['Lower member: a large aerofoil arm, broad at the body', 'Two slimmer shocks per wheel, each to its own tower', 'Tail lights: a slanted bar in a chrome surround', 'Headlights: wide oval lenses'],
           'co-twin', lambda capsule, ellipse, grown: [{'poly': grown(capsule(0.31, 0.65, 0.4, 0.47, slant=0.05), 1.16), 'material': 'Chrome'}, {'poly': capsule(0.31, 0.65, 0.4, 0.47, slant=0.05), 'material': 'TailLights'}],
           {'rx': 0.19, 'rz': 0.105}),
    round4('c4-fork', 'Fork', ['Lower member: two thick tubes forking from the hub to the body, cross braced', 'One big coilover standing between them', 'Tail lights: a tall rounded lamp each side', 'Headlights: the largest lenses, with a halo ring'],
           'co-fork', lambda capsule, ellipse, grown: [{'poly': ellipse(0.47, 0.43, 0.15, 0.07), 'material': 'TailLights'}],
           {'rx': 0.17, 'rz': 0.145, 'halo': True}),
]
for v in VARIANTS:
    if v['id'] == 'r3-coilover': v['alsoIn'] = ['4']
    # The owner's choice for the game, 14 November 2026.
    if v['id'] == 'c2-box': v['ship'] = 'buggy-boxarm.glb'
    # The shipped body gets the cockpit tub (PATTERN.md rule 3); the review rounds stay as approved.
    if v['id'] == 'c2-box': v['tub'] = True; v['views'] = ['front', 'cabin']
    # 15 November 2026, the owner on the shipped body: a plain smooth cockpit with glowing spots,
    # a smooth skid plate underneath, and the shocks and arms carried by the body's own surface.
    if v['id'] == 'c2-box': v['blend'] = True
for v in VARIANTS:
    v.setdefault('views', ['front', 'rear', 'side'])
    if v.get('round') == 2: v['views'] = ['front', 'nose', 'top']

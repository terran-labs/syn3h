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
for v in VARIANTS:
    v.setdefault('views', ['front', 'rear', 'side'])

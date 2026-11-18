// Written by tools/welcome-images.mjs from art/welcome/. Do not edit; run the tool.
export interface WelcomeShot { id: string; alt: string; colour: string; width: number; height: number; files: { width: number; url: string; bytes: number }[] }
export const WELCOME_SHOTS: readonly WelcomeShot[] = [
  {
    "id": "wings-glide",
    "alt": "A buggy gliding on translucent blue force-field wings past a red canyon wall, teal water below",
    "colour": "#78533e",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/wings-glide-640.webp",
        "bytes": 8736
      },
      {
        "width": 1280,
        "url": "/welcome/wings-glide-1280.webp",
        "bytes": 21486
      }
    ]
  },
  {
    "id": "jet-tiny-world",
    "alt": "The jet climbing away from a small planet whose whole curved surface fills the bottom of the view",
    "colour": "#e1c69e",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/jet-tiny-world-640.webp",
        "bytes": 8848
      },
      {
        "width": 1280,
        "url": "/welcome/jet-tiny-world-1280.webp",
        "bytes": 22258
      }
    ]
  },
  {
    "id": "lagoon-hovercraft",
    "alt": "A hovercraft hovering over a pale sand slope on an island under a blue sky, a buggy on the crest above",
    "colour": "#939f99",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/lagoon-hovercraft-640.webp",
        "bytes": 4060
      },
      {
        "width": 1280,
        "url": "/welcome/lagoon-hovercraft-1280.webp",
        "bytes": 10860
      }
    ]
  },
  {
    "id": "lava-night",
    "alt": "A buggy on a dark shore beside a glowing lava sea at night, a volcano and other buggies behind",
    "colour": "#3e1d12",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/lava-night-640.webp",
        "bytes": 8238
      },
      {
        "width": 1280,
        "url": "/welcome/lava-night-1280.webp",
        "bytes": 24750
      }
    ]
  },
  {
    "id": "swamp-river",
    "alt": "A buggy on green grass above a pale green river in the Mire, hazy hills beyond",
    "colour": "#98a26c",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/swamp-river-640.webp",
        "bytes": 12366
      },
      {
        "width": 1280,
        "url": "/welcome/swamp-river-1280.webp",
        "bytes": 34346
      }
    ]
  },
  {
    "id": "canyon-convoy",
    "alt": "Three buggies together on a red canyon floor at golden hour, a jet low overhead",
    "colour": "#a26240",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/canyon-convoy-640.webp",
        "bytes": 8934
      },
      {
        "width": 1280,
        "url": "/welcome/canyon-convoy-1280.webp",
        "bytes": 24954
      }
    ]
  }
]

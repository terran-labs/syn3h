// Written by tools/welcome-images.mjs from art/welcome/. Do not edit; run the tool.
export interface WelcomeShot { id: string; alt: string; colour: string; width: number; height: number; files: { width: number; url: string; bytes: number }[] }
export const WELCOME_SHOTS: readonly WelcomeShot[] = [
  {
    "id": "wings-glide",
    "alt": "A buggy gliding off a sandstone ridge on translucent blue force-field wings, low sun on the Badlands",
    "colour": "#95a584",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/wings-glide-640.webp",
        "bytes": 14028
      },
      {
        "width": 1280,
        "url": "/welcome/wings-glide-1280.webp",
        "bytes": 36766
      }
    ]
  },
  {
    "id": "jet-tiny-world-clean",
    "alt": "The jet climbing above a small planet whose whole curved surface fills the bottom of the view",
    "colour": "#e2c9a1",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/jet-tiny-world-clean-640.webp",
        "bytes": 8208
      },
      {
        "width": 1280,
        "url": "/welcome/jet-tiny-world-clean-1280.webp",
        "bytes": 20828
      }
    ]
  },
  {
    "id": "lagoon-hovercraft",
    "alt": "A hovercraft skimming a bright blue lagoon toward low islands",
    "colour": "#87b3be",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/lagoon-hovercraft-640.webp",
        "bytes": 13986
      },
      {
        "width": 1280,
        "url": "/welcome/lagoon-hovercraft-1280.webp",
        "bytes": 36960
      }
    ]
  },
  {
    "id": "lava-night",
    "alt": "A buggy on a dark shore beside a glowing lava sea at night, a volcano behind",
    "colour": "#3c1d14",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/lava-night-640.webp",
        "bytes": 9928
      },
      {
        "width": 1280,
        "url": "/welcome/lava-night-1280.webp",
        "bytes": 30710
      }
    ]
  },
  {
    "id": "swamp-river",
    "alt": "A buggy on green slopes beside a river in the Methane Swamp, under a hazy green sky",
    "colour": "#97a26a",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/swamp-river-640.webp",
        "bytes": 12150
      },
      {
        "width": 1280,
        "url": "/welcome/swamp-river-1280.webp",
        "bytes": 34402
      }
    ]
  },
  {
    "id": "canyon-convoy",
    "alt": "Three buggies together on a red canyon floor at golden hour, a jet overhead",
    "colour": "#a16642",
    "width": 16,
    "height": 9,
    "files": [
      {
        "width": 640,
        "url": "/welcome/canyon-convoy-640.webp",
        "bytes": 10682
      },
      {
        "width": 1280,
        "url": "/welcome/canyon-convoy-1280.webp",
        "bytes": 31172
      }
    ]
  }
]

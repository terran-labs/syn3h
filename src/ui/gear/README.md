# Gear selector

`GearSelector.ts` draws the gear in hand as a vertical drum floating near the centre-left
edge: the active gear in a hairline pill window in the middle, neighbours above and below
fading out through a mask, and beside it the description, status, level line and control
hints for the current state. On touch it adds buttons for the extra actions. `gear.css` is
imported by the module; nothing else to load.

It is styled in the Halo look (src/ui/theme-halo.css on feat/ux-theme): 1 px hairlines with
a tight faint halo, no fills or blur, pills fully round, Barlow with 11 px spaced capitals,
selected as a brighter rim, a soft dark falloff behind text. Colours are the `--s3-*` tokens;
`--halo-glow` and `--halo-under` are used when the theme defines them, with token-based
fallbacks otherwise. Mount it inside `.syn3h-shell` so it inherits those properties.

## Wiring in Shell.ts

```ts
import { GearSelector, type GearSource } from './gear/GearSelector'
import { GEAR_LABELS, type GearId } from '../weapons/Gear'

// Constructor, after the shell element and touch controls exist:
this.gearSelector = new GearSelector(this.element, () => {
  const rack = (window as unknown as { syn3hNet?: { gear?: GearSource } }).syn3hNet?.gear
  return rack
}, { touch: this.touch.available, onSelect: () => this.audio.cue('click') })

// Every frame, beside updateGear(); focused = the cursor is captured:
this.gearSelector.update(this.isFocus)

// Teardown:
this.gearSelector.dispose()
```

The rack on `window.syn3hNet.gear` (feat/weapons) fits `GearSource`: `list`, `current`,
`select`, `next` and `controls()`, whose `GearControls` and `GearAction` match the shapes
declared here. It has no `labelOf`, so only the current gear would get its real name (from
`controls().name`) and the neighbours would fall back to their id. Wrap it with `GEAR_LABELS`:

```ts
() => { const rack = net?.gear; return rack && { list: () => rack.list(), get current() { return rack.current }, select: (id) => rack.select(id as GearId), labelOf: (id) => GEAR_LABELS[id as GearId], controls: rack.controls?.bind(rack) } }
```

That wrapper allocates a small object per call; cache it once the rack exists. `update()`
itself allocates nothing and writes nothing when the list, the current id, the `controls()`
object, the focus mode and the level are unchanged. `level` is a live getter on the rack, so
it is read every frame and written only when it moves by half a percent. Note that the rack's
own `list()` builds a new array on every call.

Hide it outside play by hiding a parent, or toggle `gearSelector.element.hidden` yourself only
if you never let `update()` run while hidden (update owns that attribute: it hides the drum when
the rack is missing or has fewer than two items).

## CSS custom properties

Set on `.syn3h-shell` (or any ancestor) to fit the shell's layout:

| Property | Default | Meaning |
| --- | --- | --- |
| `--gear-left` | `max(20px, safe-area + 14px)`; phone `max(12px, safe-area + 10px)` | Margin from the left edge |
| `--gear-top` | `50%` (`40%` under 500 px tall) | Vertical centre of the drum |
| `--gear-z` | `12` | Drum stacking; the settings rail is 13 |
| `--gear-detail-width` | `220px` (`190px` touch, `170px` phone) | Column beside the drum |
| `--gear-actions-right` | `calc(max(24px, safe-area) + 148px)`; phone `calc(max(18px, safe-area) + 150px)` | Touch action column, from the right |
| `--gear-actions-bottom` | `max(30px, safe-area)`; phone `max(18px, safe-area)` | Touch action column, from the bottom |
| `--gear-actions-z` | `12` | Touch action stacking |
| `--gear-action-size` | `60px`; phone `56px` | Touch action button diameter |

The action column stacks upward just left of `.touch-actions`, clear of the drive stick and the
minimap. Colours all come from the `--s3-*` tokens.

## Touch buttons

Only actions after the first get a button; the first (launch, reel in, grab...) is the TAG
button's job. Hold actions call `start()` on pointer down and `stop()` once on pointer up,
cancel, leave, lost capture, window blur, page hide, when the action stops applying and on
`dispose()`. The shell's own LET OUT and LET GO touch buttons duplicate the Grapple's extra
actions; remove them once `controls()` lands.

## Known layout limits

- Phone portrait (iPhone 14, 664 px tall viewport): the minimap starts about 338 px down in the
  left column and the speed readout sits at 30%; the drum's faded lower end reaches the
  minimap. Move the minimap or set `--gear-top`.
- Short landscape phones (under 500 px tall): the minimap is in the left column (about 138 to
  234 px from the top) where the drum sits. Same choice.
- Desktop: the drum runs from 20 px to about 208 px and the detail column to about 428 px.
  The focus display's speed readout (`.fh-left`) is right-aligned to 250 px left of centre at
  mid-height: 470 px on a 1440 px screen, 390 px on 1280. On screens narrower than about
  1360 px the detail column meets the readout while the focus display shows. Narrow
  `--gear-detail-width`, move the readout, or hide one of them in focus.

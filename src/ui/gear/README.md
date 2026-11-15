# Gear selector

`GearSelector.ts` draws the gear in hand as a crescent on the left of the view. Its hairline
arc shares the screen centre with the focus display's speed arc, and the items sit along it
as spokes aimed at that centre, the active one at the middle, the neighbours fading toward
both ends. Changing gear turns them about the centre, so they sweep along the curve. Beside
the active item are its description, status, level bar and the control hints for its current
state. On touch it adds buttons for the extra actions. `gear.css`
is imported by the module; nothing else to load.

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
if you never let `update()` run while hidden (update owns that attribute: it hides the crescent when
the rack is missing or has fewer than two items).

## CSS custom properties

Set on `.syn3h-shell` (or any ancestor) to fit the shell's layout:

| Property | Default | Meaning |
| --- | --- | --- |
| `--gear-arc-radius` | `calc(50vw - 56px)`; `380px` on phones and under 500 px tall | Crescent radius about the view's centre. The default puts the arc 56 px from the left edge, concentric with the speed arc |
| `--gear-top` | `50%` (`40%` under 500 px tall) | Vertical centre of the crescent. Keep `50%` for it to stay concentric |
| `--gear-z` | `12` | Crescent stacking; the settings rail is 13 |
| `--gear-detail-width` | `236px` (`190px` touch, `176px` phone) | Column beside the crescent |
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

- Phones: the speed arc runs off the left edge, so the crescent takes its own 380 px radius
  (centre right of the view's centre) rather than being concentric.
- Phone portrait (iPhone 14, 664 px tall viewport): the minimap starts about 338 px down in the
  left column and the speed readout sits at 30%; the crescent's faded lower end reaches the
  minimap. Move the minimap or set `--gear-top`.
- Short landscape phones (under 500 px tall): the minimap is in the left column (about 138 to
  234 px from the top) where the crescent sits. Same choice.
- Desktop: the arc sits 56 px from the left edge, the labels run to about 246 px and the detail
  column (236 px) to about 482 px. The focus display's speed readout (`.fh-left`) is
  right-aligned to 250 px left of centre at mid-height: 470 px on a 1440 px screen, 390 px on
  1280. So the detail column meets the speed readout on most desktop widths while the focus
  display shows. Narrow `--gear-detail-width`, move the readout, or hide one of them in focus.

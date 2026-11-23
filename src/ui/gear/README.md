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
fallbacks otherwise. Mount it inside `.mira-shell` so it inherits those properties.

## Wiring in Shell.ts

```ts
import { GearSelector, type GearSource } from './gear/GearSelector'
import { GEAR_LABELS, type GearId } from '../weapons/Gear'

// Constructor, after the shell element and touch controls exist:
this.gearSelector = new GearSelector(this.element, () => {
  const rack = (window as unknown as { miraNet?: { gear?: GearSource } }).miraNet?.gear
  return rack
}, { touch: this.touch.available, onSelect: () => this.audio.cue('click') })

// Every frame, beside updateGear(); focused = the cursor is captured:
this.gearSelector.update(this.isFocus)

// Teardown:
this.gearSelector.dispose()
```

The rack on `window.miraNet.gear` (feat/weapons) fits `GearSource`: `list`, `current`,
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

Set on `.mira-shell` (or any ancestor) to fit the shell's layout:

| Property | Default | Meaning |
| --- | --- | --- |
| `--gear-left` | `max(20px, safe-area + 14px)`; phone `max(12px, safe-area + 10px)` | Margin from the left edge |
| `--gear-top` | `50%` (`40%` under 500 px tall); touch: the shared top edge | Vertical centre of the drum; on touch, its top edge |
| `--gear-z` | `12` | Drum stacking; the settings rail is 13 |
| `--gear-detail-width` | `220px` (`170px` phone, `0` touch) | Column beside the drum; on touch the description sits under the drum, only while the panels show |
| `--gear-actions-right` | the next column out from the thumb grid | Touch action column, from the right (right-handed) |
| `--gear-actions-left` | the same, mirrored | Touch action column, from the left (left-handed) |
| `--gear-actions-bottom` | the thumb grid's bottom | Touch action column, from the bottom |
| `--gear-actions-z` | `12` | Touch action stacking |

The button size and gap are the thumb grid's own (`--thumb-size`, `--thumb-gap`, set in
`src/ui/touch-stick.css`), so gear buttons are always the same size as WINGS, BRAKE, ZORB
and TAG and sit on the same two rows.

The action column stacks upward as the next column of the thumb grid, inside `.touch-actions`
on the screen, clear of the drive stick and the minimap. Colours all come from the `--s3-*` tokens.

## Touch buttons

Only actions after the first get a button; the first (launch, reel in, grab...) is the TAG
button's job. Hold actions call `start()` on pointer down and `stop()` once on pointer up,
cancel, leave, lost capture, window blur, page hide, when the action stops applying and on
`dispose()`. The shell's own LET OUT and LET GO touch buttons duplicate the Grapple's extra
actions; remove them once `controls()` lands.

## Known layout limits

- Touch, every size and orientation: the drum is three 44 px slots in the top left, its top edge
  on the shared top edge. The status and charge bar sit under the selected name (`.gs-meter`).
  On portrait phones the world and heading line moves to the top right to clear it
  (inspector/focus-readouts.css).
- Desktop: the drum runs from 20 px to about 208 px and the detail column to about 428 px.

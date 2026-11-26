/**
 * Welcome's privacy note tells players where to hide their location: "in a world: Panels, then
 * <card>, then <section>, and turn off <em><switch label></em>". Bug caught: the panels are
 * reorganised (a card renamed or merged, the switch moved to another section, its label changed)
 * and Welcome keeps sending players to a place that no longer holds the switch. The section is the
 * heading the player sees over the switch: the card's section, or the group's own fold inside it
 * where a section holds several groups (model.ts PartSpec).
 *
 * The switch is found by its stable id, net.shareLocation, in the source; where it sits is
 * worked out by the same card model the panels draw from (buildTree, src/ui/inspector/model.ts).
 * Until the player panel that defines the switch is merged, there is nothing to check.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildTree, SECTIONS, type PropertyDef } from '../../src/ui/inspector/model'

const ID = 'net.shareLocation'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/.test(name) ? [path] : []
  })
}

/** The switch's definition as written: its label, group and scope, or null if no file defines it. */
function switchDefinition(): Pick<PropertyDef, 'id' | 'label' | 'group' | 'scope'> | null {
  for (const file of sources('src')) {
    const text = readFileSync(file, 'utf8'), at = text.indexOf(`id: '${ID}'`)
    if (at < 0) continue
    const call = text.slice(text.lastIndexOf('defineParam', at), text.indexOf('})', at))
    const field = (name: string) => new RegExp(`${name}: '([^']+)'`).exec(call)?.[1]
    const label = field('label'), group = field('group'), scope = field('scope') as PropertyDef['scope'] | undefined
    if (label && group && scope) return { id: ID, label, group, scope }
  }
  return null
}

describe("Welcome's direction to the location switch", () => {
  const def = switchDefinition()
  it.skipIf(!def)('names the card and group that hold the switch, and the switch by its label', () => {
    const welcome = readFileSync('src/ui/welcome/welcome.ts', 'utf8')
    const said = /To hide your location, in a world: Panels, then ([^,]+), then ([^,]+), and turn off <em>([^<]+)<\/em>/.exec(welcome)
    expect(said, 'Welcome says where to hide your location').not.toBeNull()
    const [, card, heading, label] = said!
    const tree = buildTree([{ ...def!, default: true }])
    const section = tree.find(s => s.tree.some(g => g.properties.some(p => p.id === ID)))
    // Decided by the section as declared (SECTIONS), not by this one-definition tree, in which
    // every section holds a single group: a flat section, or one declaring a single group and no
    // single rows from elsewhere, shows the switch under its own title; otherwise the group's
    // fold, under its shown name, is the heading over it (Inspector.fillParts).
    const spec = SECTIONS.find(s => s.id === section?.id)?.parts.find(p => p.ids?.includes(ID) || p.groups?.includes(def!.group))
    const single = (spec?.groups?.length ?? 0) + (spec?.ids?.length ?? 0) <= 1
    const shown = spec && (spec.flat || single ? spec.title : spec.titles?.[def!.group] ?? def!.group)
    expect(section?.title, 'the card Welcome names').toBe(card)
    expect(shown, 'the section Welcome names').toBe(heading)
    expect(def!.label, "the switch's label as Welcome quotes it").toBe(label)
  })
})

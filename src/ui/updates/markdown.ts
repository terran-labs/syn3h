/**
 * A small, safe Markdown renderer for release notes: headings, paragraphs, lists, tables,
 * links, bold, italics and inline code. It parses to a plain tree, then builds DOM nodes with
 * textContent, so nothing in the feed is ever parsed as HTML: a <script> tag is shown as text.
 * Links keep only http, https and mailto addresses and site paths; anything else (javascript:,
 * data:) becomes plain text. Links open in a new tab with rel="noopener noreferrer".
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em'; c: Inline[] }
  | { t: 'link'; href: string | null; c: Inline[] }
export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

/** The address if it is safe to follow, else null. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href
  if (/^[/?#]/.test(href) && !href.startsWith('//')) return href
  return null
}

const INLINE = /(`+)([\s\S]*?)\1|\*\*(?=\S)([\s\S]+?)\*\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|(?<![\w*])\*(?=\S)([^*]+?)\*(?!\w)|(?<![\w_])_(?=\S)([^_]+?)_(?!\w)/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  const push = (node: Inline) => {
    const prev = out[out.length - 1]
    if (node.t === 'text' && prev?.t === 'text') prev.v += node.v; else if (node.t !== 'text' || node.v) out.push(node)
  }
  for (const m of text.matchAll(INLINE)) {
    push({ t: 'text', v: text.slice(last, m.index) })
    last = m.index! + m[0].length
    if (m[1] !== undefined) push({ t: 'code', v: m[2].trim() })
    else if (m[3] !== undefined) push({ t: 'strong', c: parseInline(m[3]) })
    else if (m[4] !== undefined) push({ t: 'link', href: safeHref(m[5]), c: parseInline(m[4]) })
    else if (m[6] !== undefined) push({ t: 'link', href: safeHref(m[6]), c: [{ t: 'text', v: m[6] }] })
    else push({ t: 'em', c: parseInline(m[7] ?? m[8]) })
  }
  push({ t: 'text', v: text.slice(last) })
  return out
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => parseInline(cell.trim()))
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/, NUMBER = /^\s*\d+[.)]\s+(.*)$/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) { blocks.push({ t: 'h', level: heading[1].length, c: parseInline(heading[2]) }); i++; continue }
    if (line.trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line), rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      blocks.push({ t: 'table', head, rows })
      continue
    }
    const kind = BULLET.test(line) ? 'ul' : NUMBER.test(line) ? 'ol' : null
    if (kind) {
      // One level: nested items join the list, and an indented line continues its item.
      const items: string[] = []
      while (i < lines.length && lines[i].trim()) {
        const item = BULLET.exec(lines[i]) ?? NUMBER.exec(lines[i])
        if (item) items.push(item[1]); else items[items.length - 1] += ` ${lines[i].trim()}`
        i++
      }
      blocks.push({ t: kind, items: items.map(parseInline) })
      continue
    }
    const text: string[] = []
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i])) text.push(lines[i++].trim())
    blocks.push({ t: 'p', c: parseInline(text.join(' ')) })
  }
  return blocks
}

function inlineNodes(nodes: readonly Inline[], doc: Document): Node[] {
  return nodes.map(node => {
    if (node.t === 'text') return doc.createTextNode(node.v)
    if (node.t === 'code') { const el = doc.createElement('code'); el.textContent = node.v; return el }
    if (node.t === 'link') {
      if (!node.href) { const span = doc.createElement('span'); span.append(...inlineNodes(node.c, doc)); return span }
      const a = doc.createElement('a'); a.href = node.href; a.target = '_blank'; a.rel = 'noopener noreferrer'
      a.append(...inlineNodes(node.c, doc)); return a
    }
    const el = doc.createElement(node.t === 'strong' ? 'strong' : 'em'); el.append(...inlineNodes(node.c, doc)); return el
  })
}

/**
 * Build the notes as DOM. Headings start at `top` (h4 under About's own h2 and h3), so a
 * release's "### Features" never outranks the page it sits in.
 */
export function renderMarkdown(source: string, doc: Document = document, top = 4): DocumentFragment {
  const fragment = doc.createDocumentFragment()
  for (const block of parseMarkdown(source)) {
    if (block.t === 'h') {
      const el = doc.createElement(`h${Math.min(6, top + Math.max(0, block.level - 3))}`); el.append(...inlineNodes(block.c, doc)); fragment.append(el)
    } else if (block.t === 'p') {
      const el = doc.createElement('p'); el.append(...inlineNodes(block.c, doc)); fragment.append(el)
    } else if (block.t === 'table') {
      const table = doc.createElement('table'), thead = doc.createElement('thead'), tbody = doc.createElement('tbody'), head = doc.createElement('tr')
      for (const cell of block.head) { const th = doc.createElement('th'); th.append(...inlineNodes(cell, doc)); head.append(th) }
      thead.append(head)
      for (const row of block.rows) { const tr = doc.createElement('tr'); for (const cell of row) { const td = doc.createElement('td'); td.append(...inlineNodes(cell, doc)); tr.append(td) } tbody.append(tr) }
      table.append(thead, tbody)
      const wrap = doc.createElement('div'); wrap.className = 'update-table'; wrap.append(table); fragment.append(wrap)
    } else {
      const list = doc.createElement(block.t)
      for (const item of block.items) { const li = doc.createElement('li'); li.append(...inlineNodes(item, doc)); list.append(li) }
      fragment.append(list)
    }
  }
  return fragment
}

#!/usr/bin/env python3
"""
Dump a MapMagic 1 graph asset (Unity YAML holding MapMagic's own XML-like serialization)
as a readable node list: every generator, its parameters, and which generator feeds it.

  python3 tools/terrainlab/mapmagic_dump.py "<path to X MapMagic.asset>" [--raw N]

No third party modules: the YAML subset Unity writes is unfolded by hand.
"""
import re
import sys


def yaml_string_items(text, key):
    """Return the list of scalars under `  key:` (a block sequence of quoted or plain strings)."""
    m = re.search(r'^  %s:\s*\n' % re.escape(key), text, flags=re.M)
    if not m:
        return []
    items, cur = [], None
    for line in text[m.end():].split('\n'):
        if line.startswith('  - '):
            if cur is not None:
                items.append(cur)
            cur = [line[4:]]
        elif line.startswith('    ') or line.strip() == '':
            if cur is not None:
                cur.append(line.strip())
        else:
            break
    if cur is not None:
        items.append(cur)
    out = []
    for parts in items:
        s = parts[0]
        if s.startswith('"'):
            # Double quoted, folded: a line break is a space, an empty line is a newline.
            joined = s
            for p in parts[1:]:
                joined += '\n' if p == '' else (('' if joined.endswith('\n') else ' ') + p)
            joined = joined.rstrip()
            body = joined[1:-1] if joined.endswith('"') else joined[1:]
            body = re.sub(r'\\\n\s*', '', body)
            body = (body.replace('\\r', '\r').replace('\\n', '\n').replace('\\t', '\t')
                    .replace('\\"', '"').replace('\\\\', '\\'))
            out.append(body)
        else:
            out.append(' '.join(p for p in parts if p))
    return out


TAG = re.compile(r'<(/?)([\w.+\[\]`,]+)([^<>]*?)(/?)>')
ATTR = re.compile(r'(\w+)=("[^"]*"|[^\s>/]*)')


def parse_class(s):
    """Parse one serialized class into (header attrs, [member dicts])."""
    members, header = [], None
    for m in TAG.finditer(s):
        close, name, attrs, selfclose = m.groups()
        if close:
            continue
        a = {k: v.strip('"') for k, v in ATTR.findall(attrs)}
        a['_tag'] = name.strip()
        if re.search(r'(^|\s)null(\s|$)', attrs):
            a['null'] = '1'
        if header is None:
            a.setdefault('type', a['_tag'])
            header = a
        else:
            members.append(a)
    return header or {}, members


def main():
    path = sys.argv[1]
    text = open(path, encoding='utf-8', errors='replace').read()
    classes = yaml_string_items(text, 'classes')
    if '--raw' in sys.argv:
        n = int(sys.argv[sys.argv.index('--raw') + 1])
        print(classes[n])
        return
    parsed = [parse_class(c) for c in classes]
    SKIP = {'guiRect', 'layout', 'enabled', 'mandatory', 'guiSelected', 'selected', 'drawConnections'}

    # Entry 0 is the generator array; its items link to generator classes.
    gens = [int(m['link']) for m in parsed[0][1] if 'link' in m]
    gen_no = {g: n for n, g in enumerate(gens)}

    def short(t):
        return t.replace('MapMagic.', '').replace('UnityEngine.', '').replace('System.', '')

    # Which generator (and member path) owns each Output object, so inputs can name it.
    owner = {}

    def find_outputs(idx, g, path, depth=0):
        if depth > 4:
            return
        for mem in parsed[idx][1]:
            if 'link' not in mem:
                continue
            typ, link, name = mem.get('type', ''), int(mem['link']), mem['_tag']
            if typ.endswith('Generator+Output'):
                owner[link] = (g, (path + '.' if path else '') + name)
            elif 'Input' not in typ and typ != 'MapMagic.Generator' and link not in gen_no:
                find_outputs(link, g, (path + '.' if path else '') + name, depth + 1)

    for g in gens:
        find_outputs(g, g, '')

    def show(idx, indent, depth=0):
        head, members = parsed[idx]
        pad = '    ' * indent
        for mem in members:
            name, typ = mem['_tag'], mem.get('type', '')
            if name in SKIP:
                continue
            if typ.endswith('Generator+Output'):
                continue
            if typ.endswith('Generator+Input'):
                if 'link' not in mem:
                    print('%sin  %s <- (unconnected)' % (pad, name))
                    continue
                src_out, src_gen = None, None
                for im in parsed[int(mem['link'])][1]:
                    if im['_tag'] == 'link' and 'link' in im:
                        src_out = int(im['link'])
                    if im['_tag'] == 'linkGen' and 'link' in im:
                        src_gen = int(im['link'])
                if src_gen is None:
                    print('%sin  %s <- (unconnected)' % (pad, name))
                else:
                    o = owner.get(src_out)
                    print('%sin  %s <- [%s] %s.%s' % (
                        pad, name, gen_no.get(src_gen, '?'), short(parsed[src_gen][0].get('type', '?')),
                        o[1] if o else 'output'))
                continue
            if typ == 'UnityEngine.Keyframe':
                print('%skey t=%s v=%s in=%s out=%s' % (pad, mem.get('time'), mem.get('value'), mem.get('in'), mem.get('out')))
                continue
            if 'link' in mem and depth < 5:
                link = int(mem['link'])
                if link in gen_no:
                    print('%s%s -> generator [%d]' % (pad, name, gen_no[link]))
                    continue
                print('%s%s: %s' % (pad, name, short(typ)))
                show(link, indent + 1, depth + 1)
            elif 'value' in mem:
                print('%s%s = %s' % (pad, name, mem['value']))
            elif 'null' in mem:
                pass
            else:
                rest = ' '.join('%s=%s' % (a, b) for a, b in mem.items() if a not in ('_tag', 'type'))
                print('%s%s = %s' % (pad, name, rest))

    print('%s: %d generators' % (path.split('/')[-1], len(gens)))
    for n, g in enumerate(gens):
        gtype = short(parsed[g][0].get('type', '?'))
        if gtype == 'Group':
            continue
        print('\n[%d] %s' % (n, gtype))
        show(g, 1)


if __name__ == '__main__':
    main()

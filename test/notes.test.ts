import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NOTE_MAX, isNoteFile, noteFileFor, readNote, scanFrames, sceneNote } from '../src/server/manifest.ts'
import { markdownImageRefs, publishedManifest } from '../src/server/build.ts'
import { renderMarkdown } from '../src/client/content/md.ts'
import { guardDiagramSource } from '../src/client/content/diagram.tsx'
import { tidy } from '../src/client/shell/tidy.ts'
import { NOTE_GAP, NOTE_W, SCENE_NOTE_W, noteReserve, notesCramped, sceneNoteHost } from '../src/client/shell/notes.ts'

// Sticky notes (spec 18): a markdown file beside the thing it explains reaches the manifest as
// `note`, the layout keeps room for it, and the shell knows which node shows a scene's.

describe('note files', () => {
  it('names the note beside any frame file, and recognises note files for the watcher', () => {
    expect(noteFileFor('/p/design/scenes/checkout/cart.tsx')).toBe('/p/design/scenes/checkout/cart.note.md')
    expect(noteFileFor('/p/design/scenes/checkout/cart.jsx')).toBe('/p/design/scenes/checkout/cart.note.md')
    expect(noteFileFor('/p/design/scenes/checkout/legacy.html')).toBe('/p/design/scenes/checkout/legacy.note.md')
    expect(isNoteFile('/p/design/scenes/checkout/cart.note.md')).toBe(true)
    expect(isNoteFile('/p/design/scenes/checkout/_note.md')).toBe(true)
    expect(isNoteFile('C:\\p\\design\\scenes\\checkout\\_note.md')).toBe(true)
    expect(isNoteFile('/p/design/scenes/checkout/_brief.md')).toBe(false)
    expect(isNoteFile('/p/design/scenes/checkout/notes.md')).toBe(false)
    expect(isNoteFile('/p/design/scenes/checkout/cart.tsx')).toBe(false)
  })
})

describe('notes in the manifest', () => {
  let root = ''
  const w = (rel: string, content: string) => { const p = join(root, ...rel.split('/')); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, content) }
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mv-notes-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('a frame note is its file, BOM stripped and trimmed; tsx, html and component frames alike; absent without one', () => {
    w('design/scenes/checkout/cart.tsx', `export const meta = { title: 'Cart' }\nexport default () => null\n`)
    w('design/scenes/checkout/cart.note.md', `\uFEFF\n## Why the list leads\n\nDrivers ask "where first".\n\n`)
    w('design/scenes/checkout/legacy.html', `<!doctype html><title>Legacy</title>`)
    w('design/scenes/checkout/legacy.note.md', `Kept for the migration.`)
    w('design/scenes/checkout/pay.tsx', `export default () => null\n`)
    w('design/components/button.tsx', `export default () => null\n`)
    w('design/components/button.note.md', `Every CTA is this.`)
    const m = scanFrames(root)
    const by = (id: string) => m.frames.find((f) => f.id === id)!
    expect(by('checkout/cart').note).toBe(`## Why the list leads\n\nDrivers ask "where first".`)
    expect(by('checkout/legacy').note).toBe('Kept for the migration.')
    expect(by('components/button').note).toBe('Every CTA is this.')
    expect(by('checkout/pay')).not.toHaveProperty('note')
    // the note file is never a frame
    expect(m.frames.map((f) => f.id)).toEqual(['checkout/cart', 'checkout/legacy', 'checkout/pay', 'components/button'])
  })

  it('a scene note is _note.md in the scene directory; the brief stays the brief', () => {
    w('design/scenes/checkout/cart.tsx', `export default () => null\n`)
    w('design/scenes/checkout/_brief.md', `---\ntitle: Checkout\n---\n# The buyer's path\n`)
    w('design/scenes/checkout/_note.md', `# Checkout\n\nThree states, one screen each.\n`)
    w('design/scenes/plain/home.tsx', `export default () => null\n`)
    const m = scanFrames(root)
    expect(m.scenes.find((s) => s.name === 'checkout')).toEqual({ name: 'checkout', frames: 1, brief: 'design/scenes/checkout/_brief.md', title: 'Checkout', description: "The buyer's path", note: `# Checkout\n\nThree states, one screen each.` })
    expect(m.scenes.find((s) => s.name === 'plain')).toEqual({ name: 'plain', frames: 1 })
    expect(sceneNote(root, '')).toBeUndefined()
  })

  it('an empty note is no note; a symlinked note is never followed; a long note is capped', () => {
    w('design/scenes/s/a.tsx', `export default () => null\n`)
    w('design/scenes/s/a.note.md', `   \n\n`)
    expect(readNote(join(root, 'design/scenes/s/a.note.md'))).toBeUndefined()
    w('design/scenes/s/b.tsx', `export default () => null\n`)
    w(`outside.md`, `secret`)
    symlinkSync(join(root, 'outside.md'), join(root, 'design/scenes/s/b.note.md'))
    w('design/scenes/s/c.tsx', `export default () => null\n`)
    w('design/scenes/s/c.note.md', 'x'.repeat(NOTE_MAX + 500))
    const m = scanFrames(root)
    expect(m.frames.find((f) => f.id === 's/a')).not.toHaveProperty('note')
    expect(m.frames.find((f) => f.id === 's/b')).not.toHaveProperty('note')
    expect(m.frames.find((f) => f.id === 's/c')!.note!.length).toBe(NOTE_MAX)
    expect(readNote(join(root, 'design/scenes/s/missing.note.md'))).toBeUndefined()
  })
})

describe('notes in a published canvas', () => {
  it('scene notes survive the published manifest with the source strip on; frame notes ride the entries', () => {
    const manifest = {
      frames: [{ id: 'a/x', file: 'design/scenes/a/x.tsx', kind: 'tsx' as const, scene: 'a', note: 'frame note' }, { id: 'b/y', file: 'design/scenes/b/y.tsx', kind: 'tsx' as const, scene: 'b' }],
      scenes: [{ name: 'a', frames: 1, brief: 'design/scenes/a/_brief.md', note: 'scene note' }, { name: 'b', frames: 1, note: 'unpublished' }],
    }
    const pub = publishedManifest(manifest, [manifest.frames[0]], ['board'], true)
    expect(pub.scenes).toEqual([{ name: 'a', frames: 1, note: 'scene note' }])
    expect(pub.frames[0].note).toBe('frame note')
  })
  it('a note’s images are asset refs like any Md image: titles, parentheses, reference style; never code', () => {
    expect(markdownImageRefs(`see ![the flow](flows/checkout.png "diagram") and ![](x.jpg)`)).toEqual(['flows/checkout.png', 'x.jpg'])
    expect(markdownImageRefs(`![v2](flow(v2).png)`)).toEqual(['flow(v2).png'])
    expect(markdownImageRefs(`![ref][f]\n\n[f]: flows/ref.png`)).toEqual(['flows/ref.png'])
    expect(markdownImageRefs('example:\n\n```md\n![x](not-an-asset.png)\n```\n\nand `![y](nor-this.png)`')).toEqual([])
    expect(markdownImageRefs(`- ![in a list](a.png)\n\n| c |\n|---|\n| ![in a table](b.png) |`)).toEqual(['a.png', 'b.png'])
    expect(markdownImageRefs(`![sp](my%20flow.png)`)).toEqual(['my flow.png'])
  })
})

describe('what a note may not do', () => {
  it('raw HTML is text, including the inside of a <script> block (marked leaves raw-block text unescaped)', () => {
    const out = renderMarkdown('hi <script><img/src=x onerror=alert(1)></script>')
    expect(out).not.toMatch(/<img|<script/)
    expect(out).toContain('&#60;img/src=x onerror=alert(1)&#62;')
    expect(renderMarkdown('<style>body{}</style>\n\ntext')).not.toMatch(/<style/)
    expect(renderMarkdown('a <b onclick=x>b</b>')).not.toMatch(/<b/)
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>x</p>\n')
  })
  it('entities the author wrote keep their meaning; a bare ampersand is escaped', () => {
    expect(renderMarkdown('&copy; &amp; &#x41; fish & chips <b>')).toBe('<p>&copy; &amp; &#x41; fish &#38; chips &#60;b&#62;</p>\n')
  })
  it('the allowlist keeps what the renderer legitimately emits', async () => {
    // node has no DOMParser; the browser suite exercises sanitizeMarkdownHtml - here, the policies it calls
    const { ATTR_POLICY } = await import('../src/client/content/md.ts')
    expect(ATTR_POLICY['data-goto']('checkout/café')).toBe(true)
    expect(ATTR_POLICY['data-goto']('../x')).toBe(false)
    expect(ATTR_POLICY['data-goto']('a b')).toBe(false)
    expect(ATTR_POLICY.src('/design/assets/flow..png')).toBe(true)
    expect(ATTR_POLICY.src('/design/assets/../x.png')).toBe(false)
    expect(ATTR_POLICY.src('/etc/passwd')).toBe(false)
    expect(ATTR_POLICY.class('language-c++')).toBe(true)
    expect(ATTR_POLICY.class('mv-c-blue')).toBe(true)
    expect(ATTR_POLICY.class('evil')).toBe(false)
  })
  it('diagram source cannot name a resource: URL schemes (either slash), protocol-relative, image shapes', () => {
    expect(() => guardDiagramSource('flowchart LR\n A --> B')).not.toThrow()
    expect(() => guardDiagramSource('flowchart LR\n A@{ img: "https:\\\\example.invalid/p.png", label: "i" }')).toThrow()
    expect(() => guardDiagramSource('flowchart LR\n A@{img:"x.png"}')).toThrow()
    expect(() => guardDiagramSource('graph LR\n A["//cdn/x"]')).toThrow()
    expect(() => guardDiagramSource('graph LR\n A["http://x"]')).toThrow()
    // decoded first: escapes and entities are what mermaid acts on
    expect(() => guardDiagramSource('flowchart LR\n A@{ "img": "\\u002f\\u002fexample.invalid/p.png" }')).toThrow()
    expect(() => guardDiagramSource('flowchart LR\n A@{ "\\u0069mg": "x" }')).toThrow()
    expect(() => guardDiagramSource('flowchart LR\n A@{ label: "&sol;&sol;host/x" }')).toThrow()
    expect(() => guardDiagramSource('%%{init: {"themeCSS": ".x { background-image: url(//h/p.png) }"}}%%\nflowchart LR\n A')).toThrow()
    expect(() => guardDiagramSource('flowchart LR\n A@{ shape: rect, label: "plain" }')).not.toThrow()
  })
})

describe('the layout keeps room for notes', () => {
  const n = (key: string, scene: string, w = 390, extra: Record<string, unknown> = {}) => ({ key, frame: `${scene}/${key}`, scene, w, h: 844, ...extra })
  it('reserves the note width and gutter in front of a noted node inside a run', () => {
    const placed = tidy([n('a', 's'), n('b', 's', 390, { noteW: noteReserve(true, false) })])
    const a = placed.find((p) => p.key === 'a')!, b = placed.find((p) => p.key === 'b')!
    const plain = tidy([n('a', 's'), n('b', 's')])
    const gap = plain.find((p) => p.key === 'b')!.x - plain.find((p) => p.key === 'a')!.x
    expect(b.x - a.x).toBe(gap + NOTE_W + NOTE_GAP)
  })
  it('reserves the scene note in front of the scene’s first node, once, the wider of the two when it also has its own', () => {
    const scene = noteReserve(false, true)
    const both = tidy([n('a', 's', 390, { sceneNoteW: scene, noteW: noteReserve(true, false) }), n('b', 's', 390, { sceneNoteW: scene })])
    const one = tidy([n('a', 's', 390, { sceneNoteW: scene }), n('b', 's', 390, { sceneNoteW: scene })])
    const none = tidy([n('a', 's'), n('b', 's')])
    expect(one.find((p) => p.key === 'a')!.x - none.find((p) => p.key === 'a')!.x).toBe(SCENE_NOTE_W + NOTE_GAP)
    expect(both.find((p) => p.key === 'a')!.x).toBe(one.find((p) => p.key === 'a')!.x)      // the column holds both - no sum
    expect(both.find((p) => p.key === 'b')!.x - both.find((p) => p.key === 'a')!.x).toBe(none.find((p) => p.key === 'b')!.x - none.find((p) => p.key === 'a')!.x)
    // a second scene beside the first is pushed by the reserve too (the scene box grew)
    const two = tidy([n('a', 's', 390, { sceneNoteW: scene }), n('c', 't')], { rows: [['s', 't']] })
    const twoPlain = tidy([n('a', 's'), n('c', 't')], { rows: [['s', 't']] })
    expect(two.find((p) => p.key === 'c')!.x - twoPlain.find((p) => p.key === 'c')!.x).toBe(SCENE_NOTE_W + NOTE_GAP)
  })
  it('noteReserve: nothing without a note, width plus gutter with one', () => {
    expect(noteReserve(false, false)).toBe(0)
    expect(noteReserve(true, false)).toBe(NOTE_W + NOTE_GAP)
    expect(noteReserve(true, true)).toBe(SCENE_NOTE_W + NOTE_GAP)
  })
})

describe('which node shows a scene note', () => {
  const sceneOf = (frame: string) => frame.split('/')[0]
  it('the scene’s first node in reading order - y, then x, then index; missing nodes skipped; null when absent', () => {
    const nodes = [
      { key: 'k1', frame: 's/a', x: 800, y: 0 },
      { key: 'k2', frame: 's/b', x: 0, y: 0 },
      { key: 'k3', frame: 's/c', x: 0, y: 0, missing: true },
      { key: 'k4', frame: 't/z', x: -500, y: -500 },
      { key: 'k5', frame: 's/d', x: -900, y: 10 },
    ]
    expect(sceneNoteHost(nodes, sceneOf, 's')).toBe('k2')
    expect(sceneNoteHost(nodes, sceneOf, 't')).toBe('k4')
    expect(sceneNoteHost(nodes, sceneOf, 'u')).toBeNull()
    expect(sceneNoteHost([{ key: 'a', frame: 's/a', x: 0, y: 0 }, { key: 'b', frame: 's/b', x: 0, y: 0 }], sceneOf, 's')).toBe('a')
  })
})

describe('room for a note is the layout’s job', () => {
  const manifest = (notes: { frame?: boolean; scene?: boolean }) => ({
    frames: [{ id: 's/a', scene: 's' }, { id: 's/b', scene: 's', note: notes.frame ? 'hi' : undefined }, { id: 't/c', scene: 't' }],
    scenes: [{ name: 's', note: notes.scene ? 'intro' : undefined }, { name: 't' }],
  })
  const row = (bx: number) => [
    { key: 'a', frame: 's/a', x: 0, y: 0, w: 390, h: 844 },
    { key: 'b', frame: 's/b', x: bx, y: 0, w: 390, h: 844 },
    { key: 'c', frame: 't/c', x: 2000, y: 0, w: 390, h: 844 },
  ]
  it('a frame note is cramped when its left neighbour stands inside the reserve, and not once tidy made room', () => {
    expect(notesCramped(row(500), manifest({ frame: true }))).toBe(true)
    expect(notesCramped(row(390 + noteReserve(true, false)), manifest({ frame: true }))).toBe(false)
    expect(notesCramped(row(500), manifest({}))).toBe(false)                           // no note, no reserve
    expect(notesCramped(row(500), null)).toBe(false)
  })
  it('a scene note counts on its host only; nodes in another row and missing nodes never cramp', () => {
    // the scene note sits on `a` (first in reading order) whose left is free: not cramped
    expect(notesCramped(row(500), manifest({ scene: true }))).toBe(false)
    // move `a` under `b`: `b` hosts the scene note, `a` is in another row - still free
    const stacked = [{ ...row(500)[0], y: 1200 }, row(500)[1], row(500)[2]]
    expect(notesCramped(stacked, manifest({ scene: true }))).toBe(false)
    // a node at x:300 in front of the host `b` (host by y, then x) is inside the 404 reserve
    const front = [{ ...row(500)[0], x: 300, y: 0 }, { ...row(500)[1], x: 500, y: 0, key: 'b' }, row(500)[2]]
    expect(notesCramped(front, manifest({ scene: true }))).toBe(false)               // `a` at 300 is the host, free on its left
    const hostB = [{ ...row(500)[0], x: 300, y: 5 }, { ...row(500)[1], x: 500, y: 0 }, row(500)[2]]
    expect(notesCramped(hostB, manifest({ scene: true }))).toBe(true)                // `b` (y 0) hosts; `a` stands in its reserve
    expect(notesCramped([{ ...hostB[0], missing: true }, hostB[1], hostB[2]], manifest({ scene: true }))).toBe(false)
  })
})

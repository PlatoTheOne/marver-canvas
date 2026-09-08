import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser } from './browser.ts'

/**
 * Sticky notes (spec 18), proven where they live: a REAL dev server, a REAL browser. The column
 * renders left of its frame with prose and a hand-drawn diagram; the dog-ear folds it and the tab
 * brings it back; N hides every note; a comment persisted on a note pins ON the note and follows
 * the fold; comment mode picks a note element; a goto: link navigates; an edit to the note file
 * updates the sticky without touching the iframe. Skips, never fails, without Chrome.
 */

const PORT = 6100 + Math.floor(Math.random() * 400)
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.mjs')
const ORIGIN = `http://localhost:${PORT}`

let root = ''
let server: ChildProcess | null = null
let browser: Browser | null = null
let log = ''

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')   // 1x1

const NOTE = `## Why the jobs list leads

Drivers ask "where am I going first", so the list beats the map.

Compare with the [next screen](goto:app/next): same header, no list.

\`\`\`mermaid
flowchart LR
  Login --> Today --> Jobs
\`\`\`

![the flow](flow.png)
`

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'mv-notes-b-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'notes-fixture', private: true, type: 'module' }))
  const repoRoot = join(import.meta.dirname, '..')
  const nm = join(root, 'node_modules')
  mkdirSync(nm)
  for (const e of readdirSync(join(repoRoot, 'node_modules'))) { if (e !== '.bin') symlinkSync(join(repoRoot, 'node_modules', e), join(nm, e)) }
  mkdirSync(join(nm, '@marver-design'))
  symlinkSync(repoRoot, join(nm, '@marver-design', 'marver'))
  const scene = join(root, 'design', 'scenes', 'app')
  mkdirSync(scene, { recursive: true })
  const frame = (title: string, bg: string) => `export const meta = { title: '${title}', viewport: 'mobile' }
export default () => <main style={{ minHeight: '100vh', background: '${bg}' }}><h1 style={{ margin: 0, padding: 24, color: '#fff' }}>${title}</h1></main>
`
  writeFileSync(join(scene, 'home.tsx'), frame('Home', '#0b5'))
  writeFileSync(join(scene, 'next.tsx'), frame('Next', '#05b'))
  writeFileSync(join(scene, 'home.note.md'), NOTE)
  writeFileSync(join(scene, '_note.md'), `# App\n\nThe driver's day, three screens.\n`)
  mkdirSync(join(root, 'design', 'assets'), { recursive: true })
  writeFileSync(join(root, 'design', 'assets', 'flow.png'), PNG)
  const boards = join(root, 'design', 'boards')
  mkdirSync(boards, { recursive: true })
  writeFileSync(join(boards, 'notes.json'), JSON.stringify({ version: 1, name: 'notes', auto: false, nodes: [
    { key: 'n-home', frame: 'app/home', x: 0, y: 0, w: 390, h: 844 },
    { key: 'n-next', frame: 'app/next', x: 600, y: 0, w: 390, h: 844 },
  ] }, null, 2) + '\n')
  // a thread pinned on the frame note's second paragraph - persisted, as a collaborator left it
  const comments = join(root, 'design', 'comments')
  mkdirSync(comments, { recursive: true })
  const anchor = { el: { semantics: { tag: 'p', quote: 'Compare with the next screen: same header, no list.' }, cssPath: 'p:nth-of-type(2)', note: 'frame', hue: 48 }, pos: { fx: 0.5, fy: 0.5 }, rect: { x: -200, y: 80, w: 200, h: 30 } }
  writeFileSync(join(comments, 'notes.jsonl'), JSON.stringify({ id: 'ev-1', ts: Date.now(), type: 'create', commentId: 'th-1', board: 'notes', nodeKey: 'n-home', frame: 'app/home', anchor, author: { email: 'sam@example.com', name: 'Sam' }, body: 'Is the map really second?' }) + '\n')
  server = spawn(process.execPath, [CLI, 'dev', '--root', root, '--port', String(PORT)], { cwd: root, stdio: 'pipe', env: { ...process.env, BROWSER: 'none', CI: '1' } })
  server.stdout?.on('data', (d) => { log += d })
  server.stderr?.on('data', (d) => { log += d })
  const t0 = Date.now()
  while (Date.now() - t0 < 60_000) {
    const ok = await fetch(`${ORIGIN}/`).then((r) => r.ok, () => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 200))
  }
  browser = await Browser.launch()
}, 120_000)

afterAll(() => {
  browser?.close()
  try { server?.kill('SIGTERM') } catch { /* gone */ }
  rmSync(root, { recursive: true, force: true })
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const centre = (b: Browser, s: string, selector: string) => b.eval(s, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height } })()`)
async function click(b: Browser, s: string, at: { x: number; y: number }) {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y }, s)
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 }, s)
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 }, s)
}
async function open(b: Browser): Promise<string> {
  const s = await b.tab({ width: 1500, height: 950 })
  await b.go(s, `${ORIGIN}/#/b/notes`)
  await b.until(s, `document.querySelectorAll('.sh-node').length === 2 && document.querySelectorAll('[data-node="n-home"] .sh-notes .sh-sticky').length === 2`, 30_000)
  await b.until(s, `!!document.querySelector('[data-node="n-home"] .sh-sticky-diagram svg')`, 30_000)
  await b.send('Page.bringToFront', {}, s)
  await wait(500)
  return s
}

describe('sticky notes on the canvas', () => {
  it('renders the scene note above the frame note, left of the frame, with prose, a link and a hand-drawn diagram', async () => {
    if (!browser) return
    const s = await open(browser)
    const state = await browser.eval(s, `(() => {
      const col = document.querySelector('[data-node="n-home"] .sh-notes')
      const [scene, frame] = [...col.querySelectorAll('.sh-sticky')]
      const node = document.querySelector('[data-node="n-home"]').getBoundingClientRect()
      const c = col.getBoundingClientRect(), sr = scene.getBoundingClientRect(), fr = frame.getBoundingClientRect()
      return {
        kinds: [scene.dataset.sticky, frame.dataset.sticky], ids: [scene.dataset.note, frame.dataset.note],
        widths: [scene.offsetWidth, frame.offsetWidth], leftOfFrame: c.right < node.left, topAligned: Math.abs(c.top - node.top) < 2,
        sceneAboveFrame: sr.bottom <= fr.top, rightAligned: Math.abs(sr.right - fr.right) < 1,
        h2: frame.querySelector('h2')?.textContent, goto: frame.querySelector('a[data-goto]')?.dataset.goto,
        paths: frame.querySelectorAll('.sh-sticky-diagram svg path').length, fence: frame.querySelectorAll('pre').length,
        otherColumn: document.querySelectorAll('[data-node="n-next"] .sh-notes').length,
      }
    })()`)
    expect(state).toMatchObject({ kinds: ['scene', 'frame'], ids: ['scene:app', 'frame:app/home'], widths: [380, 260], leftOfFrame: true, topAligned: true, sceneAboveFrame: true, rightAligned: true, h2: 'Why the jobs list leads', goto: 'app/next', fence: 0, otherColumn: 0 })
    expect(state.paths).toBeGreaterThan(3)   // rough.js strokes: the hand-drawn look is many paths, not one rect
  })

  it('the dog-ear folds the column to its tab and unfolds it; the choice is the viewer’s (localStorage)', async () => {
    if (!browser) return
    const s = await open(browser)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .sh-notes-fold'))
    await browser.until(s, `document.querySelector('[data-node="n-home"] .sh-notes').classList.contains('off')`)
    await wait(300)
    const folded = await browser.eval(s, `(() => { const st = document.querySelector('[data-node="n-home"] .sh-sticky'); const cs = getComputedStyle(st); return { visibility: cs.visibility, opacity: cs.opacity, stored: localStorage.getItem('mv-notes') } })()`)
    expect(folded.visibility).toBe('hidden')
    expect(Number(folded.opacity)).toBe(0)
    expect(JSON.parse(folded.stored).hidden).toEqual(['scene:app', 'frame:app/home'])
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .sh-notes-fold'))
    await browser.until(s, `!document.querySelector('[data-node="n-home"] .sh-notes').classList.contains('off')`)
    expect(JSON.parse(await browser.eval(s, `localStorage.getItem('mv-notes')`)).hidden).toEqual([])
  })

  it('N hides every note and brings them back', async () => {
    if (!browser) return
    const s = await open(browser)
    await browser.press(s, 'n')
    await browser.until(s, `document.querySelector('[data-node="n-home"] .sh-notes').classList.contains('off')`)
    expect(JSON.parse(await browser.eval(s, `localStorage.getItem('mv-notes')`)).all).toBe(false)
    await browser.press(s, 'n')
    await browser.until(s, `!document.querySelector('[data-node="n-home"] .sh-notes').classList.contains('off')`)
  })

  it('a thread pinned on the note sits on its paragraph, left of the frame, and moves to the tab when folded', async () => {
    if (!browser) return
    const s = await open(browser)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .sh-node-head'))   // select: pins show on the engaged frame
    await browser.until(s, `!!document.querySelector('[data-node="n-home"] .cm-pin')`)
    const onNote = await browser.eval(s, `(() => {
      const pin = document.querySelector('[data-node="n-home"] .cm-pin')
      const p = document.querySelector('[data-node="n-home"] [data-sticky="frame"] .sh-sticky-body p:nth-of-type(2)').getBoundingClientRect()
      const r = pin.getBoundingClientRect()
      return { left: parseFloat(pin.style.left), inside: r.left >= p.left - 4 && r.left <= p.right + 4 && r.bottom >= p.top - 4 && r.bottom <= p.bottom + 40, orphan: pin.classList.contains('orphan') }
    })()`)
    expect(onNote.left).toBeLessThan(0)
    expect(onNote.orphan).toBe(false)
    expect(onNote.inside).toBe(true)
    // opening the thread docks its card beside the column, never over it
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .cm-pin'))
    await browser.until(s, `!!document.querySelector('[data-node="n-home"] .cm-card.parked')`)
    const card = await browser.eval(s, `(() => {
      const card = document.querySelector('[data-node="n-home"] .cm-card.parked')
      const col = document.querySelector('[data-node="n-home"] .sh-notes').getBoundingClientRect()
      const r = card.getBoundingClientRect()
      const frame = document.querySelector('[data-node="n-home"]').getBoundingClientRect()
      return { flank: card.classList.contains('flank-note'), side: card.classList.contains('dock-l') ? 'l' : 'r', clear: r.right <= col.left + 1 || r.left >= frame.right - 1 }
    })()`)
    expect(card.clear).toBe(true)
    if (card.side === 'l') expect(card.flank).toBe(true)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .cm-pin'))   // close the card
    await wait(200)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .sh-notes-fold'))
    await wait(600)
    const onTab = await browser.eval(s, `(() => {
      const pin = document.querySelector('[data-node="n-home"] .cm-pin').getBoundingClientRect()
      const tab = document.querySelector('[data-node="n-home"] .sh-notes-fold').getBoundingClientRect()
      return Math.abs(pin.left - tab.left) < tab.width + 6 && Math.abs(pin.bottom - tab.top) < tab.height + 6
    })()`)
    expect(onTab).toBe(true)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] .sh-notes-fold'))
  })

  it('comment mode picks a note element: the draft stages on the node, the element is locked', async () => {
    if (!browser) return
    const s = await open(browser)
    await browser.press(s, 'c')
    await wait(200)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] [data-sticky="frame"] .sh-sticky-body h2'))
    await browser.until(s, `!!document.querySelector('[data-node="n-home"] .cm-draft')`)
    const picked = await browser.eval(s, `(() => {
      const h = document.querySelector('[data-node="n-home"] [data-sticky="frame"] .sh-sticky-body h2')
      const d = document.querySelector('[data-node="n-home"] .cm-draft')
      return { locked: h.hasAttribute('data-sh-lock'), left: parseFloat(d.style.left), selected: document.querySelector('.sh-node.sel')?.dataset.node ?? null }
    })()`)
    expect(picked.locked).toBe(true)
    expect(picked.left).toBeLessThan(0)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, s)
    await browser.until(s, `!document.querySelector('[data-node="n-home"] .cm-draft') && !document.querySelector('[data-sh-lock]')`)
  })

  it('a goto: link in a note selects its target on the board', async () => {
    if (!browser) return
    const s = await open(browser)
    await click(browser, s, await centre(browser, s, '[data-node="n-home"] [data-sticky="frame"] a[data-goto]'))
    await browser.until(s, `document.querySelector('.sh-node.sel')?.dataset.node === 'n-next'`)
  })

  it('editing the note file updates the sticky in place; the iframe is the same element', async () => {
    if (!browser) return
    const s = await open(browser)
    await browser.eval(s, `document.querySelector('[data-node="n-home"] iframe').__mvSame = true`)
    writeFileSync(join(root, 'design', 'scenes', 'app', 'home.note.md'), NOTE.replace('Why the jobs list leads', 'Why the list leads now'))
    await browser.until(s, `document.querySelector('[data-node="n-home"] [data-sticky="frame"] h2')?.textContent === 'Why the list leads now'`, 15_000)
    expect(await browser.eval(s, `document.querySelector('[data-node="n-home"] iframe').__mvSame === true`)).toBe(true)
    expect(log).not.toMatch(/error/i)
  })

  it('a published canvas carries the notes: column, diagram and the note’s image, no dev server', async () => {
    if (!browser) return
    writeFileSync(join(root, 'design', 'scenes', 'app', 'home.note.md'), NOTE.replace('Why the jobs list leads', 'Why the list leads now'))   // order-independent: the text this test expects
    writeFileSync(join(root, 'design', 'publish.json'), JSON.stringify({ version: 2, boards: { notes: 'comment' } }))
    const out = execFileSync(process.execPath, [CLI, 'build', '--root', root, '--no-textures'], { stdio: 'pipe', encoding: 'utf8' })
    expect(out).not.toMatch(/error/i)
    expect(out).toMatch(/frames|built|dist/i)   // a real build ran, not a no-op
    const port = PORT + 1
    const served = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { cwd: root, stdio: 'pipe', env: { ...process.env, MARVER_DATA_DIR: '', MARVER_PASSWORD: '', MARVER_ID_ISSUER: '' } })
    try {
      const t0 = Date.now()
      while (Date.now() - t0 < 30_000) { if (await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false)) break; await wait(200) }
      const s = await browser.tab({ width: 1500, height: 950 })
      await browser.go(s, `http://localhost:${port}/#/b/notes`)
      await browser.until(s, `document.querySelectorAll('[data-node="n-home"] .sh-notes .sh-sticky').length === 2 && !!document.querySelector('[data-node="n-home"] .sh-sticky-diagram svg')`, 30_000)
      await browser.until(s, `(document.querySelector('[data-node="n-home"] .sh-sticky-body img')?.naturalWidth ?? 0) > 0`, 15_000)
      const state = await browser.eval(s, `(() => ({ src: document.querySelector('[data-node="n-home"] .sh-sticky-body img').getAttribute('src'), h2: document.querySelector('[data-node="n-home"] [data-sticky="frame"] h2').textContent, scene: document.querySelector('[data-node="n-home"] [data-sticky="scene"] h1').textContent }))()`)
      expect(state).toEqual({ src: '/design/assets/flow.png', h2: 'Why the list leads now', scene: 'App' })
    } finally { try { served.kill('SIGTERM') } catch { /* gone */ } }
  }, 120_000)
})

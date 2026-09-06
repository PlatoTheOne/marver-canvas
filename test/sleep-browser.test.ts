import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser } from './browser.ts'

/**
 * Sleep in place (spec 16) on a real dev canvas: a glass frame sleeps under certified textures, a
 * plain frame sleeps without ever asking the server, and the one document per frame is the same
 * document awake and asleep - measured as pixels, at DPR 2, through every transition the canvas
 * has: interact, laser, theme, resize, an edit (HMR), a board switch.
 */

const PORT = 5700 + Math.floor(Math.random() * 400)
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.mjs')
const ORIGIN = `http://localhost:${PORT}`

let root = ''
let server: ChildProcess | null = null
let browser: Browser | null = null
let log = ''
let tab = ''

const GLASS = (label: string) => `export const meta = { title: 'Glass' }
export default () => (
  <main>
    <style>{\`
      html, body, main { margin: 0; min-height: 100vh }
      main { position: relative; background: linear-gradient(135deg, #ff7a59 0%, #7b61ff 45%, #19c2a0 100%); font: 600 18px system-ui }
      .g { position: absolute; padding: 18px; border-radius: 16px; color: #123; background: rgba(255,255,255,.35); border: 1px solid rgba(255,255,255,.5);
           backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px) }
      [data-theme="dark"] main { background: linear-gradient(135deg, #1b1f3a 0%, #3a1b4d 50%, #0d3b3b 100%) }
      [data-theme="dark"] .g { background: rgba(0,0,0,.35); color: #eee; border-color: rgba(255,255,255,.2) }
    \`}</style>
    <div className="g" style={{ left: 40, top: 40, width: 300 }}>${label}</div>
    <div className="g" style={{ left: 40, top: 160, width: 420 }}>Lane first</div>
    <div className="g" style={{ left: 380, top: 90, width: 260 }}>Chase dispatch</div>
    <div className="g" style={{ left: 480, top: 300, width: 260, transition: 'backdrop-filter .6s, background-color .6s' }}>Dispatch now</div>
  </main>
)
`
const PLAIN = `export const meta = { title: 'Plain' }
export default () => <main style={{ margin: 0, padding: 24, font: '16px system-ui' }}><h1 style={{ margin: 0 }}>Plain</h1><p>no glass here</p></main>
`

const glassFile = () => join(root, 'design', 'scenes', 'app', 'glass.tsx')
const bakeLines = () => log.split('\n').filter((l) => l.includes('bake:'))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'mv-sleep-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sleep-fixture', private: true, type: 'module' }))
  const repoRoot = join(import.meta.dirname, '..')
  const repoNm = join(repoRoot, 'node_modules')
  const nm = join(root, 'node_modules')
  mkdirSync(nm)
  for (const e of readdirSync(repoNm)) { if (e !== '.bin') symlinkSync(join(repoNm, e), join(nm, e)) }
  mkdirSync(join(nm, '@marver-design'))
  symlinkSync(repoRoot, join(nm, '@marver-design', 'marver'))
  const scenes = join(root, 'design', 'scenes', 'app')
  mkdirSync(scenes, { recursive: true })
  writeFileSync(glassFile(), GLASS('Past due'))
  writeFileSync(join(scenes, 'plain.tsx'), PLAIN)
  const boards = join(root, 'design', 'boards')
  mkdirSync(boards, { recursive: true })
  writeFileSync(join(boards, 'main.json'), JSON.stringify({ version: 1, name: 'main', order: 0, auto: false, nodes: [
    { key: 'g1', frame: 'app/glass', x: 0, y: 0, w: 800, h: 500 },
    { key: 'p1', frame: 'app/plain', x: 900, y: 0, w: 400, h: 300 },
  ] }))
  writeFileSync(join(boards, 'other.json'), JSON.stringify({ version: 1, name: 'other', order: 1, auto: false, nodes: [
    { key: 'p2', frame: 'app/plain', x: 0, y: 0, w: 400, h: 300 },
  ] }))
  server = spawn(process.execPath, [CLI, 'dev', '--root', root, '--port', String(PORT)], { cwd: root, stdio: 'pipe', env: { ...process.env, BROWSER: 'none', CI: '1' } })
  server.stdout?.on('data', (d) => { log += d })
  server.stderr?.on('data', (d) => { log += d })
  const t0 = Date.now()
  while (Date.now() - t0 < 60_000) {
    const ok = await fetch(`${ORIGIN}/`).then((r) => r.ok, () => false)
    if (ok) break
    await wait(200)
  }
  browser = await Browser.launch()
  if (browser) {
    tab = await browser.tab()
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false }, tab)
  }
}, 120_000)

afterAll(() => {
  browser?.close()
  try { server?.kill('SIGTERM') } catch { /* gone */ }
  rmSync(root, { recursive: true, force: true })
})

const skippable = (name: string, fn: () => Promise<void>, ms = 120_000) =>
  it(name, async (ctx) => { if (!browser) return ctx.skip(); await fn() }, ms)

// ---- page-side helpers (strings evaluated in the shell)
const DOC = (frame: string) => `document.querySelector('iframe.sh-live[title="${frame}"]')?.contentDocument`
const ASLEEP = (frame: string) => `!!${DOC(frame)}?.getElementById('mv-sleep')`
const TEXTURES = (frame: string) => `(${DOC(frame)}?.querySelectorAll('[data-mv-sleep]').length ?? -1)`
const TEXTURE_URLS = (frame: string) => `Array.from((${DOC(frame)}?.getElementById('mv-sleep')?.textContent ?? '').matchAll(/url\\("([^"]+)"\\)/g)).map((m) => m[1])`
const NODE = (key: string) => `window.__mvStore.getState().nodes.find((n) => n.key === '${key}')`
const ST = `window.__mvStore.getState()`
const ev = (expr: string) => browser!.eval(tab, expr)
const until = (expr: string, ms = 60_000) => browser!.until(tab, expr, ms)
/** The main board, loaded and ready (each test can run alone). */
async function onBoard(): Promise<void> {
  if (await ev(`location.hash === '#/b/main' && !!window.__mvStore`)) return
  await browser!.go(tab, `${ORIGIN}/#/b/main`)
  await until(`${ST}.nodes.length === 2 && ${ST}.nodes.every((n) => n.status === 'ready')`)
}
/** A reload: a fresh, pristine document (an interacted frame is dirty until then). */
async function reloadGlass(): Promise<void> {
  await ev(`(() => { ${ST}.reloadFrame('g1'); const f = document.querySelector('iframe.sh-live[title="app/glass"]'); f.src = f.src; return 1 })()`)
  await until(`${NODE('g1')}.status === 'ready'`)
}
/** At rest on the main board: both frames asleep (a frame left dirty by an earlier test is reloaded). */
async function rested(): Promise<void> {
  await onBoard()
  const whole = `${ASLEEP('app/glass')} && ${TEXTURES('app/glass')} === 4`
  if (!(await ev(whole))) { await wait(1500); if (!(await ev(whole))) await reloadGlass() }
  await bothAsleep()
}
const bothAsleep = () => until(`${ASLEEP('app/glass')} && ${TEXTURES('app/glass')} === 4 && ${ASLEEP('app/plain')} && ${TEXTURES('app/plain')} === 0`, 90_000)

/** A screenshot of the glass frame's own box - inset 24 px so no ring, outline or handle of the
 *  node's own chrome takes part, right of the side panel and below the toolbar - at DPR 2. */
async function shotGlass(): Promise<string> {
  const r = await ev(`(() => { const r = document.querySelector('iframe.sh-live[title="app/glass"]').getBoundingClientRect(); const p = document.querySelector('.sh-panel')?.getBoundingClientRect(); const x = Math.max(r.x + 24, (p?.right ?? 0) + 12), y = Math.max(r.y + 24, 70); return { x, y, width: r.right - 24 - x, height: r.bottom - 24 - y } })()`)
  return (await browser!.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } }, tab)).data
}
/** Per-pixel comparison of two PNGs, in the page (a canvas), the way research/hifi/identity.ts does. */
async function diff(a: string, b: string): Promise<{ pixels: number; diff: number; gt2: number; gt8: number; gt32: number; maxd: number; box: number[] }> {
  return ev(`(async () => {
    const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d })
    const [ia, ib] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})])
    const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height).data }
    const da = px(ia), db = px(ib)
    let diff = 0, gt2 = 0, gt8 = 0, gt32 = 0, maxd = 0
    const box = [1e9, 1e9, -1, -1]
    for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i]-db[i]), Math.abs(da[i+1]-db[i+1]), Math.abs(da[i+2]-db[i+2])); if (d) { diff++; const p = i / 4, x = p % ia.width, y = (p - x) / ia.width; box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y) } if (d > 2) gt2++; if (d > 8) gt8++; if (d > 32) gt32++; if (d > maxd) maxd = d }
    return { pixels: da.length / 4, diff, gt2, gt8, gt32, maxd, box }
  })()`)
}
const key = async (code: string, modifiers = 0) => {
  await browser!.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.replace('Digit', ''), modifiers }, tab)
  await browser!.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.replace('Digit', ''), modifiers }, tab)
}

describe('sleep in place, on a real dev canvas', () => {
  skippable('a glass frame sleeps under three certified textures; a plain frame sleeps without asking the server', async () => {
    await browser!.go(tab, `${ORIGIN}/#/b/main`)
    await until(`${ST}.nodes.length === 2 && ${ST}.nodes.every((n) => n.status === 'ready')`)
    await bothAsleep()
    const lines = bakeLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/bake: app\/glass light 800x500 - 4 effects, 0 stay live/)
    const urls: string[] = await ev(TEXTURE_URLS('app/glass'))
    expect(urls).toHaveLength(4)
    for (const u of urls) expect(u).toMatch(/^\/__mv\/bakes\/\d+\/[0-9a-f]{16}\/\d+\.png$/)
    // the sleeping document is the live one: the pause rule and the overrides are one <style>, nothing else changed
    expect(await ev(`${DOC('app/glass')}.querySelectorAll('#mv-sleep').length`)).toBe(1)
    expect(await ev(`${DOC('app/glass')}.body.querySelectorAll('.g').length`)).toBe(4)
  })

  skippable('the compile endpoint: owner-gated, validated, cached, and its textures are immutable files', async () => {
    const post = (body: unknown, withToken = true) => ev(`fetch('/__mv/api/bakes', { method: 'POST', headers: { 'content-type': 'application/json', ...(${withToken} ? { 'x-mv-c': document.cookie.match(/(?:^|; )mv_c=([^;]+)/)?.[1] ?? '' } : {}) }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
    expect((await post({ asks: [{ frame: 'app/glass', theme: 'light', w: 800, h: 500 }] }, false)).status).toBe(403)
    expect((await post({ asks: [{ frame: 'nope/none', theme: 'light', w: 800, h: 500 }] })).status).toBe(400)
    expect((await post({ asks: [{ frame: 'app/glass', theme: '../x', w: 800, h: 500 }] })).status).toBe(400)
    expect((await post({ asks: [{ frame: 'app/glass', theme: 'light', w: 20, h: 500 }] })).status).toBe(400)
    expect((await post({ asks: [] })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
    expect((await post({ asks: [{ frame: 'app/glass', theme: 'light', w: 3840, h: 16384 }] })).status).toBe(400)   // beyond the bitmap budget
    const r = await post({ asks: [{ frame: 'app/glass', theme: 'light', w: 800, h: 500 }] })
    expect(r.status).toBe(200)
    const a = r.body.answers[0]
    expect(a).toMatchObject({ frame: 'app/glass', theme: 'light', w: 800, h: 500, ok: true, ms: 0 })   // ms 0: the cache answered
    expect(a.targets.filter((t: { verified: boolean }) => t.verified)).toHaveLength(4)
    const tex = await ev(`fetch(${JSON.stringify(a.targets[0].texture)}).then((r) => ({ status: r.status, cc: r.headers.get('cache-control'), type: r.headers.get('content-type') }))`)
    expect(tex).toMatchObject({ status: 200, type: 'image/png' })
    expect(tex.cc).toMatch(/immutable/)
    expect(await ev(`fetch('/__mv/bakes/${r.body.gen}/deadbeefdeadbeef/0.png').then((r) => r.status)`)).toBe(404)
    expect(await ev(`fetch('/__mv/bakes/${r.body.gen}/../../manifest.json').then((r) => r.status)`)).toBe(404)
  })

  skippable('identical asks compile once: duplicates inside a request and two requests in flight share the compile', async () => {
    const post = (body: unknown) => ev(`fetch('/__mv/api/bakes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mv-c': document.cookie.match(/(?:^|; )mv_c=([^;]+)/)?.[1] ?? '' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
    const a = { frame: 'app/glass', theme: 'light', w: 640, h: 400 }
    const [r1, r2] = await Promise.all([post({ asks: [a, a] }), post({ asks: [a] })])
    for (const r of [r1, r2]) { expect(r.status).toBe(200); for (const x of r.body.answers) expect(x.ok).toBe(true) }
    expect(r1.body.answers).toHaveLength(2)
    expect(bakeLines().filter((l) => l.includes('app/glass light 640x400'))).toHaveLength(1)
  })

  skippable('identity: the frame asleep, awake in interact, still awake after leaving interact, and asleep again after a reload - the same pixels', async () => {
    await onBoard()
    await key('Digit0', 8)   // shift+0: 100 %
    await wait(700)
    await bothAsleep()
    const asleep = await shotGlass()
    await ev(`${ST}.setInteract('g1')`)
    await until(`!${ASLEEP('app/glass')}`, 5_000)
    const awakeEarly = await shotGlass()   // within the first frames of the wake
    await wait(700)                          // longer than the authored .6s transition on the fourth element
    const awake = await shotGlass()
    expect((await diff(awakeEarly, awake)).gt2, 'the wake ran an authored transition').toBe(0)   // gt2: GPU dither is 1 level
    await ev(`${ST}.setInteract(null)`)
    await wait(1500)
    expect(await ev(ASLEEP('app/glass'))).toBe(false)   // interacted = dirty: stays awake until reloaded
    const stillAwake = await shotGlass()
    const control = await diff(awake, stillAwake)
    expect(control, 'awake vs still awake ' + JSON.stringify(control)).toMatchObject({ gt2: 0 })
    const d = await diff(awake, asleep)
    expect(d.pixels).toBeGreaterThan(500_000)   // DPR 2 over the clip
    expect(d.maxd).toBeLessThanOrEqual(32)
    expect(d.gt8).toBeLessThanOrEqual(d.pixels * 0.0001)   // one pixel in ten thousand
    // a reload is a fresh, pristine document: it sleeps again
    await reloadGlass()
    await bothAsleep()
    const again = await shotGlass()
    expect((await diff(asleep, again)).gt2).toBe(0)
  })

  skippable('laser mode and selection act on the sleeping document; they never wake it', async () => {
    await rested()
    await ev(`${ST}.setLaser(true)`)
    await ev(`${ST}.select('g1')`)
    await wait(1000)
    expect(await ev(ASLEEP('app/glass'))).toBe(true)
    await ev(`${ST}.setLaser(false)`)
    await ev(`${ST}.select(null)`)
  })

  skippable('a theme flip wakes, compiles the other theme once the frame has painted it, and sleeps again; flipping back is a cache hit', async () => {
    await rested()
    const light: string[] = await ev(TEXTURE_URLS('app/glass'))
    await ev(`${ST}.setTheme('dark')`)
    await until(`${NODE('g1')}.themeOn === 'dark' && ${ASLEEP('app/glass')} && ${TEXTURES('app/glass')} === 4`, 90_000)
    expect(await ev(`${DOC('app/glass')}.documentElement.dataset.theme`)).toBe('dark')
    const dark: string[] = await ev(TEXTURE_URLS('app/glass'))
    expect(dark).toHaveLength(4)
    expect(dark[0]).not.toBe(light[0])
    expect(bakeLines().filter((l) => l.includes('app/glass dark 800x500'))).toHaveLength(1)
    await ev(`${ST}.setTheme('light')`)
    await until(`${NODE('g1')}.themeOn === 'light' && ${ASLEEP('app/glass')} && ${TEXTURES('app/glass')} === 4`)
    expect(await ev(TEXTURE_URLS('app/glass'))).toEqual(light)
    expect(bakeLines().filter((l) => l.includes('app/glass light 800x500'))).toHaveLength(1)   // still the one compile
  })

  skippable('a resize drag keeps the frame awake for the whole drag and sleeps it again at the new size', async () => {
    await rested()
    await ev(`${ST}.select('g1')`)
    const h = await ev(`(() => { const r = document.querySelector('.sh-node[data-node="g1"] .sh-handle.se').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    const mouse = (type: string, x: number, y: number) => browser!.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1 }, tab)
    await mouse('mousePressed', h.x, h.y)
    for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', h.x + i * 10, h.y + i * 6); await wait(40) }
    await wait(400)
    expect(await ev(ASLEEP('app/glass'))).toBe(false)
    await mouse('mouseReleased', h.x + 60, h.y + 36)
    await until(`${NODE('g1')}.w > 800 && ${ASLEEP('app/glass')} && ${TEXTURES('app/glass')} === 4`, 90_000)
    const w = await ev(`Math.round(${NODE('g1')}.w)`), hh = await ev(`Math.round(${NODE('g1')}.h)`)
    expect(bakeLines().filter((l) => l.includes(`app/glass light ${w}x${hh}`))).toHaveLength(1)
    await ev(`${ST}.select(null)`)
  })

  skippable('a texture that does not decode leaves the glass live under the pause alone (never blind under blur(0px))', async () => {
    await rested()
    const urls: string[] = await ev(TEXTURE_URLS('app/glass'))
    const [, , , gen, key] = urls[0].split('/')
    // the server's cache now names a texture that does not exist (a fresh URL: the browser's own
    // cache would otherwise still hold the old file for a year)
    const meta = join(root, 'design', '.local', 'bakes', gen, key, 'bake.json')
    const bake = JSON.parse(readFileSync(meta, 'utf8'))
    const original = readFileSync(meta, 'utf8')
    bake.targets[0].texture = 'gone.png'
    writeFileSync(meta, JSON.stringify(bake))
    await reloadGlass()
    await wait(3000)
    expect(await ev(ASLEEP('app/glass'))).toBe(true)     // the pause
    expect(await ev(TEXTURES('app/glass'))).toBe(0)      // no glass overridden
    expect(await ev(`${DOC('app/glass')}.getElementById('mv-sleep').textContent.includes('url(')`)).toBe(false)
    writeFileSync(meta, original)
  })

  skippable('an edit (HMR) wakes the frame and compiles the new source under a new generation', async () => {
    await rested()
    const before: string[] = await ev(TEXTURE_URLS('app/glass'))
    const genBefore = before[0].split('/')[3]
    writeFileSync(glassFile(), GLASS('Past due!'))
    await until(`${DOC('app/glass')}?.body.textContent.includes('Past due!') && ${ASLEEP('app/glass')} && ${TEXTURES('app/glass')} === 4`, 90_000)
    const after: string[] = await ev(TEXTURE_URLS('app/glass'))
    expect(after[0].split('/')[3]).not.toBe(genBefore)   // the old generation can never be served again
    expect(await ev(`fetch(${JSON.stringify(before[0])}, { cache: 'no-store' }).then((r) => r.status)`)).toBe(404)   // pruned on the server; the browser cache is beside the point
  })

  skippable('a board switch unmounts cleanly and the frames sleep again on return', async () => {
    await onBoard()
    await ev(`location.hash = '#/b/other'`)
    await until(`${ST}.nodes.length === 1 && ${ASLEEP('app/plain')}`)
    await ev(`location.hash = '#/b/main'`)
    await until(`${ST}.nodes.length === 2 && ${ST}.nodes.every((n) => n.status === 'ready')`)
    await bothAsleep()
  })
})

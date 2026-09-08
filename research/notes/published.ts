// The reviewer's path on a PUBLISHED canvas: build, serve gated with a data dir, claim the owner
// invite, sign in, open the board, comment on a note, reload, see the pin persist on the note.
// usage: npx tsx research/notes/published.ts <root> <board> <port> <outdir>
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser } from '../../test/browser.ts'

const [root, board, portS, out] = process.argv.slice(2)
const port = Number(portS), base = `http://localhost:${port}`
const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
const t0 = Date.now()
const built = execFileSync(process.execPath, [CLI, 'build', '--root', root, '--boards', board, '--no-textures'], { encoding: 'utf8', stdio: 'pipe' })
console.log('build', Math.round((Date.now() - t0) / 1000) + 's', built.trim().split('\n').slice(-3).join(' | '))
const dataDir = mkdtempSync(join(tmpdir(), 'mv-pubnotes-'))
const logs: string[] = []
const server = spawn(process.execPath, [CLI, 'serve'], { cwd: root, env: { ...process.env, PORT: String(port), MARVER_PASSWORD: 'hunter2', MARVER_DATA_DIR: dataDir, MARVER_OWNER_EMAIL: 'owner@x.test' }, stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout?.on('data', (d) => logs.push(String(d))); server.stderr?.on('data', (d) => logs.push(String(d)))
for (let i = 0; i < 100; i++) { try { await fetch(base, { signal: AbortSignal.timeout(500) }); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
await new Promise((r) => setTimeout(r, 500))
const token = /\/#\/i\/([\w-]+)/.exec(logs.join(''))?.[1] ?? ''
console.log('owner invite token', token ? 'found' : 'MISSING', logs.join('').slice(0, 300).replace(/\n/g, ' | '))
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1000 })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = async (name: string, clip?: any) => { const { data } = await b.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }, s); writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')); console.log('shot', name) }
const centre = (sel: string) => b.eval(s, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const click = async (at: { x: number; y: number }) => { await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y }, s); await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 }, s); await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 }, s) }
try {
  // 1. the gate
  await b.go(s, `${base}/#/i/${token}`)
  await b.until(s, `!!document.querySelector('input[type=password]')`, 20_000)
  await b.eval(s, `(() => { const i = document.querySelector('input[type=password]'); i.value = 'hunter2'; i.form.submit() })()`)
  await wait(1500)
  // 2. the invite claim: whatever form the claim page shows, fill a name if asked
  console.log('after gate', await b.eval(s, `location.href + ' :: ' + document.body.innerText.slice(0, 160).replace(/\\n/g, ' | ')`))
  // the claim dialog: choose a password, a display name, join
  await b.until(s, `!!document.querySelector('input[type=password]')`, 15_000)
  await b.eval(s, `document.querySelector('input[type=password]').focus()`)
  await b.send('Input.insertText', { text: 'reviewer-pass-1' }, s)
  const nameSel = `input:not([type=password]):not([type=hidden]):not([type=file])`
  await b.eval(s, `(() => { const is = [...document.querySelectorAll(${JSON.stringify(nameSel)})]; const i = is.find((x) => /name/i.test(x.placeholder + x.name + x.getAttribute('aria-label'))) ?? is[is.length - 1]; i.focus() })()`)
  await b.send('Input.insertText', { text: 'Reviewer Rae' }, s)
  await wait(300)
  const join = await b.eval(s, `(() => { const btn = [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: btn.disabled } })()`)
  console.log('join button', JSON.stringify(join))
  if (join) await click(join)
  await wait(2000)
  console.log('after claim', await b.eval(s, `location.href + ' :: ' + (document.querySelector('.sh-pill-btn[title], .sh-pill-btn')?.outerHTML.slice(0, 80) ?? '') + ' :: dialog=' + !!document.querySelector('input[type=password]')`))
  // 3. the board with notes and diagrams
  await b.go(s, `${base}/#/b/${board}`)
  await b.until(s, `document.querySelectorAll('.sh-notes .sh-sticky').length >= 6`, 40_000)
  await b.until(s, `document.querySelectorAll('.sh-sticky-diagram svg').length >= 5`, 40_000)
  await wait(2500)
  console.log('published', await b.eval(s, `JSON.stringify({ columns: document.querySelectorAll('.sh-notes').length, stickies: document.querySelectorAll('.sh-sticky').length, diagrams: document.querySelectorAll('.sh-sticky-diagram svg').length, errs: document.querySelectorAll('.sh-sticky pre.err').length, me: document.querySelector('.sh-pill-btn') ? 'toolbar' : 'no-toolbar' })`))
  await shot('60-published-board')
  // zoom onto the pickup scene note (sequence diagram) via the deep link, then comment on it
  const key = await b.eval(s, `document.querySelector('[data-note="scene:app-03-pickup"]')?.closest('.sh-node')?.dataset.node ?? null`)
  await b.go(s, `${base}/#/b/${board}?n=${key}`)
  await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 40_000)
  await wait(2500)
  await shot('61-published-note')
  await b.press(s, 'c'); await wait(300)
  console.log('comment mode', await b.eval(s, `JSON.stringify({ commenting: document.body.classList.contains('sh-commenting'), toast: document.querySelector('.sh-toast, [class*=toast]')?.textContent ?? null })`))
  const p = await centre(`[data-node-notes="${key}"] [data-sticky="scene"] .sh-sticky-body p`)
  await click(p)
  await b.until(s, `!!document.querySelector('[data-node="${key}"] .cm-draft')`, 10_000)
  console.log('draft staged on the note; locked =', await b.eval(s, `!!document.querySelector('[data-node="${key}"] .sh-sticky-body [data-sh-lock]')`))
  await shot('62-published-draft')
  await b.send('Input.insertText', { text: 'Reviewer: is the gate scan really first? The lot map comes before it in the field.' }, s)
  await wait(200)
  const send = await centre(`[data-node="${key}"] .cm-draft button[type=submit], [data-node="${key}"] .cm-draft button.cm-send, [data-node="${key}"] .cm-draft button:last-of-type`)
  if (send) await click(send)
  await b.until(s, `!!document.querySelector('[data-node="${key}"] .cm-pin')`, 15_000)
  await wait(800)
  console.log('thread created; pin left =', await b.eval(s, `parseFloat(document.querySelector('[data-node="${key}"] .cm-pin').style.left)`))
  await shot('63-published-thread')
  // 4. reload: the thread is persisted on the server and comes back pinned on the note
  await b.go(s, `${base}/#/b/${board}?n=${key}`)
  await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 40_000)
  await wait(1500)
  await click(await centre(`[data-node="${key}"] .sh-node-head`))
  await b.until(s, `!!document.querySelector('[data-node="${key}"] .cm-pin')`, 15_000)
  await wait(500)
  console.log('after reload', await b.eval(s, `(() => { const pin = document.querySelector('[data-node="${key}"] .cm-pin').getBoundingClientRect(); const p = document.querySelector('[data-node-notes="${key}"] [data-sticky="scene"] .sh-sticky-body p').getBoundingClientRect(); return JSON.stringify({ pinLeft: Math.round(pin.left), pinBottom: Math.round(pin.bottom), pLeft: Math.round(p.left), pRight: Math.round(p.right), pTop: Math.round(p.top), pBottom: Math.round(p.bottom), onNote: pin.left >= p.left - 6 && pin.left <= p.right + 6 && pin.bottom >= p.top - 6 && pin.bottom <= p.bottom + 40 }) })()`))
  await shot('64-published-reloaded')
  console.log('log tail', logs.join('').split('\n').filter((l) => /error|warn/i.test(l)).slice(0, 5))
} catch (e) { console.log('FAILED', String(e).slice(0, 400)); await shot('69-failed').catch(() => {}) }
b.close(); server.kill('SIGTERM')

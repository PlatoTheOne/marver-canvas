/** During a board switch: every sh:ready message the shell receives (id, gen) against the shell's
 *  manifest revision over time, plus manifest/board files the server rewrites. */
import { statSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', board = 'carrier-low-fi', root = '/Users/nictouron/tms-broker'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mt = (f: string) => { try { return statSync(f).mtimeMs } catch { return 0 } }
const files = [`${root}/design/manifest.json`, `${root}/design/boards/${board}.json`, `${root}/design/boards/shipper-low-fi.json`]
await b.go(s, `${origin}/#/b/shipper-low-fi`)
await b.until(s, `(() => { const st = window.__mvStore?.getState(); return !!st && st.nodes.length > 0 && st.nodes.every((n) => n.status === 'ready') })()`, 120_000)
await wait(1000)
const before = files.map(mt)
await b.eval(s, `(() => { window.__log = []; window.__t0 = performance.now(); window.addEventListener('message', (e) => { if (e.data && e.data.type === 'sh:ready') window.__log.push([Math.round(performance.now() - window.__t0), e.data.id, e.data.gen]) }, true); return 1 })()`)
const revExpr = `(() => { const st = window.__mvStore.getState(); return { rev: st.manifestRev ?? st.rev ?? null, nodes: st.nodes.length, ready: st.nodes.filter((n) => n.status === 'ready').length, loading: st.nodes.filter((n) => n.status === 'loading').length, retried: st.nodes.filter((n) => n.readyRetried).length, src0: document.querySelector('iframe.sh-live')?.getAttribute('src') } })()`
const t0 = Date.now()
await b.eval(s, `location.hash = '#/b/${board}'`)
const samples: any[] = []
let last = ''
while (Date.now() - t0 < 150_000) {
  const r = await b.eval(s, revExpr).catch(() => null)
  const k = JSON.stringify(r)
  if (r && k !== last) { samples.push({ t: Date.now() - t0, ...r }); last = k }
  if (r && r.nodes > 100 && r.ready === r.nodes) break
  await wait(250)
}
const log = await b.eval(s, `JSON.stringify(window.__log)`)
const msgs = JSON.parse(log) as [number, string, string][]
const gens = new Map<string, number>(); for (const m of msgs) gens.set(m[2], (gens.get(m[2]) ?? 0) + 1)
console.log('ready messages:', msgs.length, 'by gen:', JSON.stringify([...gens.entries()]), 'first at', msgs[0]?.[0], 'ms; times of first 6:', JSON.stringify(msgs.slice(0, 6)))
console.log('samples:', JSON.stringify(samples.filter((x, i) => i < 6 || i % Math.ceil(samples.length / 14) === 0 || i === samples.length - 1)))
console.log('files rewritten:', files.map((f, i) => [f.replace(root, ''), mt(f) !== before[i]]))
b.close()

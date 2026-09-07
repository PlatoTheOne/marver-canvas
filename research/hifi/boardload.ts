/** How a board loads: ready-count over time, presented frames, and where the main thread went.
 *  args: origin board [cold|warm]. Warm = visit another board first, then switch. */
import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', board = 'carrier-low-fi', mode = 'cold'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const readyExpr = `(() => { const st = window.__mvStore?.getState(); if (!st) return null; return { n: st.nodes.length, ready: st.nodes.filter((n) => n.status === 'ready').length, statuses: [...new Set(st.nodes.map((n) => n.status))] } })()`
if (mode === 'warm') { await b.go(s, `${origin}/#/b/shipper-low-fi`); await b.until(s, `(() => { const st = window.__mvStore?.getState(); return !!st && st.nodes.length > 0 && st.nodes.every((n) => n.status === 'ready') })()`, 120_000); await wait(1000) }
const frames: { t: number; data: string }[] = []
const t0 = Date.now()
const off = b['cdp'].on((m: any) => { if (m.sessionId === s && m.method === 'Page.screencastFrame') { frames.push({ t: Date.now() - t0, data: m.params.data }); void b.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, s) } })
await b.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1000, maxHeight: 600, everyNthFrame: 2 }, s)
await b.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8'], excludedCategories: [] } }, s)
if (mode === 'warm') { await b.eval(s, `location.hash = '#/b/${board}'`); await b.until(s, `window.__mvStore.getState().nodes.length > 100`, 60_000) }
else await b.go(s, `${origin}/#/b/${board}`)
const timeline: { t: number; ready: number }[] = []
let last = -1, allAt = -1
while (Date.now() - t0 < 120_000) {
  const r = await b.eval(s, readyExpr).catch(() => null)
  if (r && r.ready !== last) { timeline.push({ t: Date.now() - t0, ready: r.ready }); last = r.ready }
  if (r && r.n > 0 && r.ready === r.n) { allAt = Date.now() - t0; break }
  await wait(100)
}
await wait(1500)
await b.send('Page.stopScreencast', {}, s); off()
console.log(JSON.stringify({ mode, allReadyMs: allAt, timeline: timeline.filter((x, i) => i % Math.ceil(timeline.length / 12) === 0 || i === timeline.length - 1) }))
const done = new Promise<string>((res) => { const h = b['cdp'].on((m: any) => { if (m.sessionId === s && m.method === 'Tracing.tracingComplete') { h(); res(m.params.stream) } }) })
await b.send('Tracing.end', {}, s)
const stream = await done
let json = ''
for (;;) { const r = await b.send('IO.read', { handle: stream, size: 1 << 22 }, s); json += r.base64Encoded ? Buffer.from(r.data, 'base64').toString() : r.data; if (r.eof) break }
const ev = (JSON.parse(json).traceEvents ?? JSON.parse(json)) as any[]
const sum = (names: string[]) => ev.filter((e) => names.includes(e.name) && e.dur).reduce((a, e) => a + e.dur, 0) / 1000
const cats = { script: sum(['EvaluateScript', 'FunctionCall', 'v8.compile', 'V8.CompileScript', 'RunMicrotasks']), layout: sum(['Layout', 'UpdateLayoutTree', 'PrePaint']), paint: sum(['Paint', 'PaintImage', 'RasterTask']), parse: sum(['ParseHTML', 'ParseAuthorStyleSheet']), gc: sum(['MinorGC', 'MajorGC', 'V8.GC_MARK_COMPACTOR']), compositing: sum(['Layerize', 'UpdateLayer', 'CompositeLayers', 'Commit']) }
const sends = new Map<string, { url: string; t: number }>()
for (const e of ev) if (e.name === 'ResourceSendRequest') sends.set(e.args.data.requestId, { url: e.args.data.url, t: e.ts })
const durs: { url: string; ms: number }[] = []
for (const e of ev) if (e.name === 'ResourceFinish' || e.name === 'ResourceReceiveResponse') { const r = sends.get(e.args.data.requestId); if (r && e.name === 'ResourceReceiveResponse') durs.push({ url: r.url, ms: (e.ts - r.t) / 1000 }) }
const byPath = new Map<string, { n: number; ms: number; max: number }>()
for (const d of durs) { const k = d.url.replace(origin, '').replace(/\?.*$/, '').replace(/\/design\/.*/, '/design/*').replace(/node_modules\/\.vite\/deps\/.*/, 'vite-deps/*').replace(/node_modules\/.*/, 'node_modules/*'); const e = byPath.get(k) ?? { n: 0, ms: 0, max: 0 }; e.n++; e.ms += d.ms; e.max = Math.max(e.max, d.ms); byPath.set(k, e) }
console.log('requests by path (n, total ms to response, max):', JSON.stringify([...byPath.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14).map(([k, v]) => [k, v.n, Math.round(v.ms), Math.round(v.max)])))
console.log('slowest:', JSON.stringify(durs.sort((a, b) => b.ms - a.ms).slice(0, 6).map((d) => [d.url.replace(origin, '').slice(0, 90), Math.round(d.ms)])))
const nav = durs.length
console.log(JSON.stringify({ mode, allReadyMs: allAt, frames: frames.length, requests: nav, mainThreadMs: cats, timeline: timeline.filter((x, i) => i % Math.ceil(timeline.length / 12) === 0 || i === timeline.length - 1) }))
for (const [i, f] of frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0).entries()) writeFileSync(`research/hifi/out/load-${mode}-${i}-${f.t}ms.jpg`, Buffer.from(f.data, 'base64'))
b.close()

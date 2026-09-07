/** Per-request network timing during a board switch: queued in the browser vs waiting on the server,
 *  cache hits, and subframe navigations (a reload loop shows as repeated navigations per frame). */
import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', board = 'carrier-low-fi'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
await b.go(s, `${origin}/#/b/shipper-low-fi`)
await b.until(s, `(() => { const st = window.__mvStore?.getState(); return !!st && st.nodes.length > 0 && st.nodes.every((n) => n.status === 'ready') })()`, 120_000)
await wait(1000)
await b.send('Network.enable', { maxTotalBufferSize: 1 << 20 }, s)
const sent = new Map<string, { url: string; t: number; wall: number }>()
const rows: { url: string; queued: number; ttfb: number; cache: string; frame?: string }[] = []
const navs = new Map<string, number>()
const off = b['cdp'].on((m: any) => {
  if (m.sessionId !== s) return
  if (m.method === 'Network.requestWillBeSent') sent.set(m.params.requestId, { url: m.params.request.url, t: m.params.timestamp, wall: m.params.wallTime })
  if (m.method === 'Network.responseReceived') { const r = sent.get(m.params.requestId); const R = m.params.response; if (!r) return; const tm = R.timing; rows.push({ url: r.url, queued: tm ? (tm.requestTime - r.t) * 1000 + tm.sendStart : -1, ttfb: tm ? tm.receiveHeadersEnd - tm.sendStart : -1, cache: R.fromDiskCache ? 'disk' : R.fromMemoryCache ? 'memory' : R.fromServiceWorker ? 'sw' : String(R.status) }) }
  if (m.method === 'Page.frameNavigated' && m.params.frame.parentId) navs.set(m.params.frame.id, (navs.get(m.params.frame.id) ?? 0) + 1)
})
await b.send('Page.enable', {}, s)
const t0 = Date.now()
await b.eval(s, `location.hash = '#/b/${board}'`)
await b.until(s, `window.__mvStore.getState().nodes.length > 100`, 60_000)
await b.until(s, `window.__mvStore.getState().nodes.every((n) => n.status === 'ready')`, 150_000).catch(() => console.log('(not all ready)'))
const total = Date.now() - t0
off()
const key = (u: string) => u.replace(origin, '').replace(/\?.*$/, '').replace(/\/design\/.*/, '/design/*').replace(/node_modules\/\.vite\/deps\/.*/, 'vite-deps/*').replace(/\/@fs\/.*\/node_modules\/.*/, '@fs/node_modules/*').replace(/\/@fs\/.*\/frame-host\//, '@fs/frame-host/')
const agg = new Map<string, { n: number; q: number; qmax: number; ttfb: number; tmax: number; cache: Record<string, number> }>()
for (const r of rows) { const k = key(r.url); const e = agg.get(k) ?? { n: 0, q: 0, qmax: 0, ttfb: 0, tmax: 0, cache: {} }; e.n++; e.q += Math.max(0, r.queued); e.qmax = Math.max(e.qmax, r.queued); e.ttfb += Math.max(0, r.ttfb); e.tmax = Math.max(e.tmax, r.ttfb); e.cache[r.cache] = (e.cache[r.cache] ?? 0) + 1; agg.set(k, e) }
console.log(JSON.stringify({ totalMs: total, requests: rows.length, subframeNavigations: [...navs.values()].reduce((a, c) => a + c, 0), framesNavigatedMoreThanOnce: [...navs.values()].filter((n) => n > 1).length }))
for (const [k, e] of [...agg.entries()].sort((a, b) => (b[1].q + b[1].ttfb) - (a[1].q + a[1].ttfb)).slice(0, 12)) console.log(k.padEnd(40), 'n', e.n, 'queued avg', Math.round(e.q / e.n), 'max', Math.round(e.qmax), '| ttfb avg', Math.round(e.ttfb / e.n), 'max', Math.round(e.tmax), JSON.stringify(e.cache))
b.close()

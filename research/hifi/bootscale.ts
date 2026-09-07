/** Boot time of lo-fi frames: N iframes at once in a bare harness page, time to each sh:ready. */
import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', ns = '1,16,64', prefix = 'low-fi-carriers/'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
await b.go(s, `${origin}/#/b/carrier-low-fi`)
await b.until(s, `window.__mvStore?.getState().nodes.length > 100`, 60_000)
const ids = (await b.eval(s, `JSON.stringify(window.__mvStore.getState().nodes.map((n) => n.frame))`)) as string
const frames = (JSON.parse(ids) as string[]).filter((f) => f.startsWith(prefix))
const K = Number(process.env.K ?? 0)   // staged admission: at most K iframes booting at once (0 = all at once)
for (const n of ns.split(',').map(Number)) {
  await b.go(s, `${origin}/__mv/frame/?id=nothing&theme=light&r=0`)   // same origin, empty-ish harness
  await b.eval(s, `document.open(); document.write('<!doctype html><body></body>'); document.close(); 1`)
  const r = await b.eval(s, `new Promise((res) => {
    const ids = ${JSON.stringify(frames.slice(0, n))}; const t0 = performance.now(); const times = []; const K = ${K}; let next = 0, inflight = 0
    const admit = () => { while ((K === 0 || inflight < K) && next < ids.length) { const id = ids[next++]; inflight++; const f = document.createElement('iframe'); f.width = 1280; f.height = 800; f.src = '/__mv/frame/?id=' + encodeURIComponent(id) + '&theme=light&r=0'; document.body.appendChild(f) } }
    const ph = []
    window.addEventListener('message', (e) => { if (e.data?.type === 'sh:ready') { times.push(Math.round(performance.now() - t0)); if (e.data.phases) ph.push(e.data.phases); inflight--; admit(); if (times.length === ids.length) { const med = (k) => { const v = ph.map((p) => p[k]).filter((x) => x != null).sort((a, b) => a - b); return v[v.length >> 1] }; res(JSON.stringify({ K, n: ids.length, first: times[0], p25: times[times.length >> 2], median: times[times.length >> 1], last: times[times.length - 1], phasesMedianMsSinceNav: { boot: med('boot'), theme: med('theme'), scene: med('scene'), wrappers: med('wrappers'), commit: med('commit') } })) } } })
    admit()
    setTimeout(() => res(JSON.stringify({ n: ids.length, timeout: true, got: times.length, first: times[0], last: times[times.length - 1] })), 120000)
  })`)
  console.log(r)
}
b.close()

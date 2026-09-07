/** One frame's module graph: every resource its document fetched, when, how long, how big. */
import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', id = 'low-fi-carriers/tenders'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.go(s, `${origin}/__mv/frame/?id=nothing&theme=light&r=0`)
for (const run of [1, 2]) {
  await b.eval(s, `document.open(); document.write('<!doctype html><body></body>'); document.close(); 1`)
  const r = await b.eval(s, `new Promise((res) => {
    const t0 = performance.now()
    const f = document.createElement('iframe'); f.width = 1280; f.height = 800
    window.addEventListener('message', function h(e) { if (e.data?.type !== 'sh:ready') return; window.removeEventListener('message', h)
      const w = f.contentWindow; const es = w.performance.getEntriesByType('resource').map((e) => ({ n: e.name.replace(location.origin, '').replace(/\\?v=[0-9a-f]+/, '').slice(0, 70), st: Math.round(e.startTime), d: Math.round(e.duration), kb: Math.round((e.decodedBodySize || 0) / 1024), cache: e.transferSize === 0 ? 'cache' : '' }))
      const nav = w.performance.getEntriesByType('navigation')[0]
      res(JSON.stringify({ ready: Math.round(performance.now() - t0), phases: e.data.phases, resources: es.length, kbTotal: es.reduce((a, c) => a + c.kb, 0), cached: es.filter((x) => x.cache).length, dcl: Math.round(nav.domContentLoadedEventEnd), bySize: [...es].sort((a, b) => b.kb - a.kb).slice(0, 8), byEnd: [...es].sort((a, b) => (b.st + b.d) - (a.st + a.d)).slice(0, 10) })) })
    f.src = '/__mv/frame/?id=' + encodeURIComponent(${JSON.stringify(id)}) + '&theme=light&r=0'; document.body.appendChild(f)
    setTimeout(() => res('timeout'), 60000)
  })`)
  console.log('run', run, r)
}
b.close()

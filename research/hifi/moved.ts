import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', id = 'hifi-orders/lane-first/a-dark-glass', w = '1662', h = '1080'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: false }, s)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
await b.go(s, `${origin}/__mv/frame/?id=${encodeURIComponent(id)}&theme=light`)
await wait(4000)
console.log(await b.eval(s, `(async () => {
  const all = Array.from(document.querySelectorAll('body *'))
  const geo = () => all.map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
  const before = geo()
  const glass = all.filter((el) => { const v = getComputedStyle(el).backdropFilter; return v && v !== 'none' })
  for (const el of glass) { el.style.setProperty('backdrop-filter', 'none', 'important'); if (getComputedStyle(el).filter === 'none') el.style.setProperty('filter', 'opacity(1)', 'important') }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const after = geo()
  const moved = []
  before.forEach((r, k) => { const d = r.map((v, j) => +(after[k][j] - v).toFixed(3)); if (d.some((v) => Math.abs(v) > 0.01)) { const el = all[k]; const cs = getComputedStyle(el); moved.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), pos: cs.position, d, insideGlass: glass.some((g) => g !== el && g.contains(el)) }) } })
  return JSON.stringify({ glass: glass.length, elements: all.length, moved: moved.length, sample: moved.slice(0, 12) }, null, 1)
})()`))
b.close()

import { Browser } from '../../test/browser.ts'
const id = 'hifi-orders/lane-first/a-dark-glass'
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 1662, height: 1080, deviceScaleFactor: 2, mobile: false }, s)
for (const origin of ['http://localhost:5260', 'http://localhost:5270']) {
  await b.go(s, `${origin}/__mv/frame/?id=${encodeURIComponent(id)}&theme=light`)
  await new Promise((r) => setTimeout(r, 4000))
  console.log(origin, await b.eval(s, `(() => {
    const pick = (x, y) => { const el = document.elementFromPoint(x, y); let e = el; const chain = []; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.backdropFilter !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') chain.push([e.tagName + '.' + String(e.className).split(' ').slice(0, 3).join('.'), cs.backdropFilter, cs.backgroundColor, cs.filter]); e = e.parentElement } return chain.slice(0, 3) }
    const all = [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).backdropFilter !== 'none')
    return JSON.stringify({ effects: all.length, sidebar: pick(60, 400), header: pick(700, 60), fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).slice(0, 4), css: document.styleSheets.length })
  })()`))
}
b.close()

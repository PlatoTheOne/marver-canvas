import { Browser } from '../../test/browser.ts'
const id = 'hifi-orders/lane-first/a-dark-glass'
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 1662, height: 1080, deviceScaleFactor: 2, mobile: false }, s)
for (const origin of ['http://localhost:5260', 'http://localhost:5270']) {
  await b.go(s, `${origin}/__mv/frame/?id=${encodeURIComponent(id)}&theme=light`)
  await new Promise((r) => setTimeout(r, 3000))
  console.log(origin, await b.eval(s, `(() => { const out = []; for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules } catch { continue } for (const r of rules) { const t = r.cssText || ''; if (/backdrop/.test(t)) out.push(t.slice(0, 160)) } } return JSON.stringify({ sheets: [...document.styleSheets].map((s) => (s.href || 'inline').slice(-40)), rules: out.slice(0, 12), n: out.length }) })()`))
}
b.close()

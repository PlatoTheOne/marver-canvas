import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5250', board = 'hifi-30'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, s)
await b.go(s, `${origin}/?awake=1#/b/${board}`)
await b.until(s, `(() => { const st = window.__mvStore?.getState(); return !!st && st.nodes.length > 0 && st.nodes.every((n) => n.status === 'ready') })()`, 90_000)
await new Promise((r) => setTimeout(r, 4000))
console.log(await b.eval(s, `JSON.stringify({ search: location.search, href: location.href, asleep: Array.from(document.querySelectorAll('iframe.sh-live')).filter((f) => f.contentDocument?.getElementById('mv-sleep')).length, frames: document.querySelectorAll('iframe.sh-live').length, styles: Array.from(document.querySelectorAll('iframe.sh-live')).slice(0,1).map((f) => f.contentDocument?.getElementById('mv-sleep')?.textContent?.slice(0, 120)) })`))
b.close()

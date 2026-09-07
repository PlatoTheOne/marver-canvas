import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5270', board = 'shipper-high-fi'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
await b.go(s, `${origin}/#/b/${board}`)
await b.until(s, `(() => { const fr = [...document.querySelectorAll('iframe.sh-live')]; return fr.length > 0 && fr.every((f) => f.contentDocument?.getElementById('mv-sleep')) })()`, 60_000)
await new Promise((r) => setTimeout(r, 1500))
console.log(await b.eval(s, `JSON.stringify([...document.querySelectorAll('iframe.sh-live')].map((f) => { const d = f.contentDocument; return { frame: f.title, textures: d.querySelectorAll('[data-mv-sleep]').length, liveFilters: [...d.querySelectorAll('*')].filter((e) => { const v = getComputedStyle(e).backdropFilter; return v && v !== 'none' }).length, gen: d.querySelector('meta[name="mv-bakes"]')?.content } }))`))
b.close()

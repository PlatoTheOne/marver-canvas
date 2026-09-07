import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5270', board = 'shipper-high-fi'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Runtime.enable', {}, s)
const logs: string[] = []
b['cdp'].on((m: any) => { if (m.sessionId === s && m.method === 'Runtime.consoleAPICalled' && /error|warn/.test(m.params.type)) logs.push(m.params.args.map((a: any) => a.value ?? a.description).join(' ').slice(0, 200)); if (m.sessionId === s && m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)) })
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
await b.go(s, `${origin}/#/b/${board}`)
for (const t of [2000, 6000, 12000]) {
  await new Promise((r) => setTimeout(r, t === 2000 ? 2000 : 4000 + (t === 12000 ? 2000 : 0)))
  console.log(t, await b.eval(s, `JSON.stringify({ store: !!window.__mvStore, nodes: window.__mvStore?.getState().nodes.map((n) => [n.key, n.status, n.missing ?? false]), iframes: [...document.querySelectorAll('iframe')].map((f) => (f.getAttribute('src') || '').slice(0, 60)), hash: location.hash, title: document.title })`))
}
console.log('console:', logs.slice(0, 6))
b.close()

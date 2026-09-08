import { Browser } from '../../test/browser.ts'
const [origin, board, key] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1100 })
await b.go(s, `${origin}/#/b/${board}?n=${key}`)
await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
await new Promise((r) => setTimeout(r, 1500))
console.log(await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); const r = svg.querySelector('rect.basic'); const g = r.parentElement; return JSON.stringify({ node: g.getAttribute('class'), nodeChildren: [...g.children].map((c) => c.tagName + '.' + (c.getAttribute('class') || '') + ' [' + [...c.children].map((cc) => cc.tagName + '.' + (cc.getAttribute('class') || '')).join(',') + ']'), gp: g.parentElement?.tagName + '.' + (g.parentElement?.getAttribute('class') || '') }) })()`))
b.close()

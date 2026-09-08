import { Browser } from '../../test/browser.ts'
const [origin, board, key] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1100 })
await b.go(s, `${origin}/#/b/${board}?n=${key}`)
await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
await new Promise((r) => setTimeout(r, 2000))
console.log(await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); return JSON.stringify([...svg.querySelectorAll('rect, path')].filter((r) => { const cs = getComputedStyle(r); return cs.fill === 'rgb(107, 90, 0)' || cs.fill === 'rgb(43, 37, 0)' }).slice(0, 10).map((r) => { const cs = getComputedStyle(r); return { tag: r.tagName, cls: r.getAttribute('class'), st: (r.getAttribute('style') || '').slice(0, 80), attrFill: r.getAttribute('fill'), fill: cs.fill, op: cs.opacity, fo: cs.fillOpacity, parent: r.parentElement?.getAttribute('class'), gp: r.parentElement?.parentElement?.getAttribute('class'), w: r.getAttribute('width') } })) })()`))
b.close()

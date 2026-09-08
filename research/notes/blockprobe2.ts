import { Browser } from '../../test/browser.ts'
const [origin, board, key] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1100 })
await b.go(s, `${origin}/#/b/${board}?n=${key}`)
await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
await new Promise((r) => setTimeout(r, 1500))
console.log(await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); const r = svg.querySelector('rect.basic'); return JSON.stringify({ sk: !!r.__sketched, style: r.getAttribute('style'), next: r.nextElementSibling?.tagName + '.' + JSON.stringify(r.nextElementSibling?.getAttribute('class')), nextHasPath: !!r.nextElementSibling?.querySelector('path'), gs: [...svg.querySelectorAll('rect.basic')].map((x) => x.parentElement.querySelectorAll(':scope > g').length) }) })()`))
b.close()

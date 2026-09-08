import { Browser } from '../../test/browser.ts'
const [origin, board, key] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1100 })
await b.go(s, `${origin}/#/b/${board}?n=${key}`)
await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
await new Promise((r) => setTimeout(r, 1500))
console.log(await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); const nodes = [...svg.querySelectorAll('g')].filter((g) => /mindmap-node|node/.test(g.getAttribute('class') || '')).slice(0, 4); return JSON.stringify(nodes.map((g) => ({ cls: g.getAttribute('class'), parent: g.parentElement?.getAttribute('class'), children: [...g.children].map((c) => c.tagName + '.' + (c.getAttribute('class') || '') + (c.tagName === 'path' ? ' d=' + (c.getAttribute('d') || '').slice(0, 30) : '') + ' fill=' + getComputedStyle(c).fill + ' sk=' + !!c.__sketched) }))) })()`))
b.close()

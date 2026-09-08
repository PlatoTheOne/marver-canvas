import { Browser } from '../../test/browser.ts'
const [origin, board, ...keys] = process.argv.slice(2)
const b = (await Browser.launch())!
for (const key of keys) {
  const s = await b.tab({ width: 1600, height: 1100 })
  await b.go(s, `${origin}/#/b/${board}?n=${key}`)
  await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
  await new Promise((r) => setTimeout(r, 1500))
  console.log(key, await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); const rects = [...svg.querySelectorAll('rect')].slice(0, 12).map((r) => ({ cls: r.getAttribute('class'), st: (r.getAttribute('style') || '').slice(0, 50), fill: getComputedStyle(r).fill, next: r.nextElementSibling?.tagName, parent: r.parentElement?.getAttribute('class') })); const circles = [...svg.querySelectorAll('circle')].slice(0, 4).map((c) => ({ cls: c.getAttribute('class'), fill: getComputedStyle(c).fill, parent: c.parentElement?.getAttribute('class') })); return JSON.stringify({ rects, circles, flags: { actor: !!svg.querySelector('rect.actor + g path'), state: !!svg.querySelector('.statediagram-state rect + g path, .statediagram-state g path'), cls: !!svg.querySelector('.classGroup rect + g path'), er: !!svg.querySelector('.er.entityBox + g path') } }, null, 0) })()`))
}
b.close()

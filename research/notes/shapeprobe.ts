import { Browser } from '../../test/browser.ts'
const [origin, board, ...keys] = process.argv.slice(2)
const b = (await Browser.launch())!
for (const key of keys) {
  const s = await b.tab({ width: 1600, height: 1100 })
  await b.go(s, `${origin}/#/b/${board}?n=${key}`)
  await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
  await new Promise((r) => setTimeout(r, 1500))
  console.log(key, await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); return JSON.stringify([...svg.querySelectorAll('rect, circle, path')].filter((e) => !e.closest('.label, foreignObject, marker')).slice(0, 10).map((e) => ({ tag: e.tagName, cls: e.getAttribute('class'), parent: e.parentElement?.getAttribute('class'), next: e.nextElementSibling?.tagName + '.' + (e.nextElementSibling?.getAttribute('class') ?? ''), fill: getComputedStyle(e).fill, w: e.getAttribute('width'), sk: !!e.__sketched }))) })()`))
}
b.close()

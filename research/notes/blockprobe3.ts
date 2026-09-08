import { Browser } from '../../test/browser.ts'
const [origin, board, ...keys] = process.argv.slice(2)
const b = (await Browser.launch())!
for (const key of keys) {
  const s = await b.tab({ width: 1600, height: 1100 })
  await b.go(s, `${origin}/#/b/${board}?n=${key}`)
  await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg')`, 30_000)
  await new Promise((r) => setTimeout(r, 1500))
  console.log(key, await b.eval(s, `(() => { const svg = document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg'); const vb = svg.viewBox.baseVal; const r = svg.querySelector('rect.basic, rect.actor'); const g = r?.nextElementSibling; const ps = g ? [...g.querySelectorAll('path')].map((p) => ({ sw: getComputedStyle(p).strokeWidth, st: getComputedStyle(p).stroke, fill: getComputedStyle(p).fill, dlen: (p.getAttribute('d') || '').length })) : null; return JSON.stringify({ vbw: vb.width, vbh: vb.height, cw: svg.clientWidth, maxW: svg.style.maxWidth, w: r?.getAttribute('width'), h: r?.getAttribute('height'), ps }) })()`))
}
b.close()

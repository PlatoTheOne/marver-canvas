import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, hash, out] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 2000, height: 1200 })
await b.go(s, `${origin}/${hash}`)
const SEL = '[data-note="scene:app-03-pickup"] .sh-sticky-diagram svg'
await b.until(s, `!!document.querySelector(${JSON.stringify(SEL)})`, 30_000)
for (let i = 0; i < 60; i++) {
  const r = await b.eval(s, `(() => { const r = document.querySelector('[data-note="scene:app-03-pickup"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } })()`)
  if (r.w >= 520) break
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(20, Math.min(1980, r.x)), y: Math.max(20, Math.min(1180, r.y)), deltaX: 0, deltaY: -100, modifiers: 2 }, s)
  await new Promise((r) => setTimeout(r, 90))
}
await new Promise((r) => setTimeout(r, 2000))
const clip = async () => b.eval(s, `(() => { const r = document.querySelector(${JSON.stringify(SEL)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 } })()`)
const shot = async (name: string) => { const { data } = await b.send('Page.captureScreenshot', { format: 'png', clip: await clip() }, s); writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')) }
const svg = `document.querySelector(${JSON.stringify(SEL)})`
await shot('40-base')
await b.eval(s, `${svg}.style.textRendering = 'geometricPrecision'`); await new Promise((r) => setTimeout(r, 400)); await shot('41-geometric')
await b.eval(s, `${svg}.style.textRendering = ''; ${svg}.style.letterSpacing = '0.01px'`); await new Promise((r) => setTimeout(r, 400)); await shot('42-letterspacing')
await b.eval(s, `${svg}.style.letterSpacing = ''; const n = ${svg}.closest('.sh-node'); n.dataset.theme = 'dark'; setTimeout(() => { n.dataset.theme = 'light' }, 50)`); await new Promise((r) => setTimeout(r, 600)); await shot('43-themeflip')
await b.eval(s, `const h = ${svg}.parentElement; h.innerHTML = h.innerHTML`); await new Promise((r) => setTimeout(r, 400)); await shot('44-reinsert')
b.close()

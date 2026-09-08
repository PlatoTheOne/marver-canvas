import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, hash, out] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 2000, height: 1200 })
await b.go(s, `${origin}/${hash}`)
const SEL = '[data-note="scene:app-03-pickup"] .sh-sticky-diagram svg'
await b.until(s, `!!document.querySelector(${JSON.stringify(SEL)})`, 30_000)
await new Promise((r) => setTimeout(r, 2500))
for (let i = 0; i < 60; i++) {
  const r = await b.eval(s, `(() => { const r = document.querySelector('[data-note="scene:app-03-pickup"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } })()`)
  if (r.w >= 520) break
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(20, Math.min(1980, r.x)), y: Math.max(20, Math.min(1180, r.y)), deltaX: 0, deltaY: -100, modifiers: 2 }, s)
  await new Promise((r) => setTimeout(r, 90))
}
await new Promise((r) => setTimeout(r, 3000))
const clip = await b.eval(s, `(() => { const r = document.querySelector(${JSON.stringify(SEL)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 } })()`)
const shot = async (name: string) => { const { data } = await b.send('Page.captureScreenshot', { format: 'png', clip }, s); writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')) }
await shot('20-after-zoom')
await b.eval(s, `document.querySelector(${JSON.stringify(SEL)}).parentElement.style.opacity = '0.99'`)
await new Promise((r) => setTimeout(r, 500))
await shot('21-after-repaint')
console.log(await b.eval(s, `JSON.stringify({ gesturing: document.getElementById('sh-world').className, world: getComputedStyle(document.getElementById('sh-world')).willChange, sticky: getComputedStyle(document.querySelector('[data-note="scene:app-03-pickup"]')).willChange })`))
b.close()

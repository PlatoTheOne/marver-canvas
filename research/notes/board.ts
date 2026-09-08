// whole-board views for a look across: light and dark, fit-all, then one column close up
import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, hash, out] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 2000, height: 1200 })
await b.go(s, `${origin}/${hash}`)
await b.until(s, `document.querySelectorAll('.sh-notes').length >= 6`, 30_000)
await b.until(s, `document.querySelectorAll('.sh-sticky-diagram svg').length >= 3`, 30_000).catch(() => {})
await new Promise((r) => setTimeout(r, 2500))
const shot = async (name: string) => { const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, s); writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')) }
await shot('10-board-light')
// zoom onto the pickup scene column (the sequence diagram)
const zoomTo = async (sel: string, target: number) => {
  for (let i = 0; i < 60; i++) {
    const r = await b.eval(s, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } })()`)
    if (r.w >= target) break
    await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(20, Math.min(1980, r.x)), y: Math.max(20, Math.min(1180, r.y)), deltaX: 0, deltaY: -100, modifiers: 2 }, s)
    await new Promise((r) => setTimeout(r, 90))
  }
  await new Promise((r) => setTimeout(r, 3000))
}
await zoomTo('[data-sticky="scene"][data-note="scene:app-03-pickup"]', 520)
await shot('11-pickup-light')
await b.press(s, 'd'); await new Promise((r) => setTimeout(r, 2500))
await shot('12-pickup-dark')
await zoomTo('[data-sticky="scene"][data-note="scene:app-02-offers"]', 520)
await shot('13-offers-dark')
console.log(await b.eval(s, `document.querySelectorAll('.sh-notes').length + ' columns, ' + document.querySelectorAll('.sh-sticky').length + ' stickies'`))
b.close()

// Sticky notes (spec 18): open a frame, screenshot the column, fold it, screenshot again.
// usage: npx tsx research/notes/shot.ts http://localhost:5261 app-01-home/today /out/dir
import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'

const [origin, frame, out] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1000 })
await b.go(s, `${origin}/${frame}`)
await b.until(s, `document.querySelectorAll('.sh-notes').length > 0`, 30_000)
await b.until(s, `document.querySelector('.sh-sticky-diagram svg') !== null`, 30_000).catch(() => console.log('no diagram svg'))
await new Promise((r) => setTimeout(r, 1500))
// zoom onto the column: ctrl+wheel at its centre until it is ~360 screen px wide
for (let i = 0; i < 40; i++) {
  const r = await b.eval(s, `(() => { const r = document.querySelector('.sh-notes').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } })()`)
  if (r.w >= 360) break
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(20, Math.min(1580, r.x)), y: Math.max(20, Math.min(980, r.y)), deltaX: 0, deltaY: -120, modifiers: 2 }, s)
  await new Promise((r) => setTimeout(r, 120))
}
await new Promise((r) => setTimeout(r, 600))
const shot = async (name: string) => {
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, s)
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('wrote', name)
}
console.log(await b.eval(s, `JSON.stringify([...document.querySelectorAll('.sh-notes')].map((c) => ({ off: c.classList.contains('off'), r: c.getBoundingClientRect().toJSON(), n: c.querySelectorAll('.sh-sticky').length, svg: c.querySelectorAll('svg').length })))`))
await shot('01-open')
// fold the first column through its dog-ear
const fold = await b.eval(s, `(() => { const r = document.querySelector('.sh-notes-fold').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fold.x, y: fold.y, button: 'left', clickCount: 1 }, s)
await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fold.x, y: fold.y, button: 'left', clickCount: 1 }, s)
await new Promise((r) => setTimeout(r, 400))
await shot('02-folded')
await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fold.x, y: fold.y, button: 'left', clickCount: 1 }, s)
await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fold.x, y: fold.y, button: 'left', clickCount: 1 }, s)
await new Promise((r) => setTimeout(r, 400))
console.log('after unfold', await b.eval(s, `document.querySelector('.sh-notes').classList.contains('off')`))
b.close()

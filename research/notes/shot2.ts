// the variant-badge case in dark theme: open a board, flip theme, zoom on the first column
import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, hash, out, dark] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1000 })
await b.go(s, `${origin}/${hash}`)
await b.until(s, `document.querySelectorAll('.sh-notes').length > 0`, 30_000)
await new Promise((r) => setTimeout(r, 1500))
if (dark === 'dark') { await b.press(s, 'd'); await new Promise((r) => setTimeout(r, 2500)) }
for (let i = 0; i < 40; i++) {
  const r = await b.eval(s, `(() => { const r = document.querySelector('.sh-notes').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } })()`)
  if (r.w >= 300) break
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(20, Math.min(1580, r.x)), y: Math.max(20, Math.min(980, r.y)), deltaX: 0, deltaY: -120, modifiers: 2 }, s)
  await new Promise((r) => setTimeout(r, 120))
}
await new Promise((r) => setTimeout(r, 2500))
const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, s)
writeFileSync(`${out}/03-${dark}.png`, Buffer.from(data, 'base64'))
console.log(await b.eval(s, `JSON.stringify([...document.querySelectorAll('.sh-notes')].map((c) => ({ below: c.classList.contains('below-vbadge'), theme: c.closest('.sh-node').dataset.theme })))`))
b.close()

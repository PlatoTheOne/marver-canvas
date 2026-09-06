// Magnify the same crop of two PNGs side by side (nearest neighbour), for the eye.
import { readFileSync, writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [a, bb, out, x = '640', y = '820', w = '300', h = '220', k = '4'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1000 })
const png = await b.eval(s, `(async () => {
  const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d })
  const [ia, ib] = await Promise.all([load(${JSON.stringify(readFileSync(a).toString('base64'))}), load(${JSON.stringify(readFileSync(bb).toString('base64'))})])
  const W = ${w} * ${k}, H = ${h} * ${k}
  const c = document.createElement('canvas'); c.width = W * 2 + 8; c.height = H; const g = c.getContext('2d'); g.imageSmoothingEnabled = false
  g.fillStyle = '#f0f'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(ia, ${x}, ${y}, ${w}, ${h}, 0, 0, W, H); g.drawImage(ib, ${x}, ${y}, ${w}, ${h}, W + 8, 0, W, H)
  return c.toDataURL('image/png').split(',')[1]
})()`)
writeFileSync(out, Buffer.from(png, 'base64'))
b.close()

/** Stack a zoomed crop of two PNGs (top: A, bottom: B, then |A-B| amplified) into one PNG. */
import { readFileSync, writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [fa, fb, x, y, w, h, out, zoom = '4'] = process.argv.slice(2)
const [a, c] = [fa, fb].map((f) => readFileSync(f).toString('base64'))
const b = (await Browser.launch())!
const s = await b.tab()
await b.go(s, 'about:blank')
const png = await b.eval(s, `(async () => {
  const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d })
  const [ia, ib] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(c)})])
  const X = ${x}, Y = ${y}, W = ${w}, H = ${h}, Z = ${zoom}
  const cv = document.createElement('canvas'); cv.width = W * Z; cv.height = H * Z * 3; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false
  g.drawImage(ia, X, Y, W, H, 0, 0, W * Z, H * Z); g.drawImage(ib, X, Y, W, H, 0, H * Z, W * Z, H * Z)
  const A = g.getImageData(0, 0, W * Z, H * Z), B = g.getImageData(0, H * Z, W * Z, H * Z), D = g.createImageData(W * Z, H * Z)
  for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i+1] - B.data[i+1]), Math.abs(A.data[i+2] - B.data[i+2])); const v = Math.min(255, d * 8); D.data[i] = v; D.data[i+1] = d > 8 ? 0 : v; D.data[i+2] = d > 8 ? 0 : v; D.data[i+3] = 255 }
  g.putImageData(D, 0, H * Z * 2)
  return cv.toDataURL('image/png').split(',')[1]
})()`)
writeFileSync(out, Buffer.from(png, 'base64'))
b.close()

import { readFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [a, c] = process.argv.slice(2).map((f) => readFileSync(f).toString('base64'))
const b = (await Browser.launch())!
const s = await b.tab()
await b.go(s, 'about:blank')
console.log(await b.eval(s, `(async () => {
  const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d })
  const [ia, ib] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(c)})])
  const px = (im) => { const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return { d: g.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height } }
  const A = px(ia), B = px(ib); const blocks = new Map()
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { const i = (y * A.w + x) * 4; const d = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i+1] - B.d[i+1]), Math.abs(A.d[i+2] - B.d[i+2])); if (d > 8) { const k = (y >> 5) * 1000 + (x >> 5); blocks.set(k, (blocks.get(k) || 0) + 1) } }
  return JSON.stringify([...blocks.entries()].sort((p, q) => q[1] - p[1]).slice(0, 15).map(([k, c]) => ({ x: (k % 1000) * 32, y: Math.floor(k / 1000) * 32, c })))
})()`))
b.close()

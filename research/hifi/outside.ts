/** Where do reference and baked differ OUTSIDE the target boxes? Clusters of >32-level pixels per
 *  16x16 device-pixel block, from an MV_BAKE_DEBUG dump directory. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Browser } from '../../test/browser.ts'
const [dir, bakeJson] = process.argv.slice(2)
const ref = readFileSync(join(dir, 'reference.png')).toString('base64')
const baked = readdirSync(dir).filter((f) => f.startsWith('baked-')).sort((a, b) => Number(a.slice(6, -4)) - Number(b.slice(6, -4)))
const bk = readFileSync(join(dir, baked[baked.length - 1])).toString('base64')
const rects = JSON.parse(readFileSync(bakeJson, 'utf8')).targets.map((t: any) => t.rect)
const b = (await Browser.launch())!
const s = await b.tab()
await b.go(s, 'about:blank')
console.log(baked[baked.length - 1], await b.eval(s, `(async () => {
  const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d })
  const [ia, ib] = await Promise.all([load(${JSON.stringify(ref)}), load(${JSON.stringify(bk)})])
  const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height } }
  const A = px(ia), B = px(ib), k = 2, rects = ${JSON.stringify(rects)}
  const owned = new Uint8Array(A.w * A.h)
  for (const r of rects) for (let y = Math.floor(r.y * k); y < Math.ceil((r.y + r.h) * k); y++) for (let x = Math.floor(r.x * k); x < Math.ceil((r.x + r.w) * k); x++) owned[y * A.w + x] = 1
  const blocks = new Map(); let gt8 = 0, gt32 = 0, n = 0, maxd = 0
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { const p = y * A.w + x; if (owned[p]) continue; n++
    const i = p * 4; const d = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i+1] - B.d[i+1]), Math.abs(A.d[i+2] - B.d[i+2]))
    if (d > maxd) maxd = d; if (d > 8) gt8++; if (d > 32) { gt32++; const key = (y >> 4) * 10000 + (x >> 4); blocks.set(key, (blocks.get(key) || 0) + 1) } }
  const top = [...blocks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, c]) => ({ x: (key % 10000) * 16 / k, y: Math.floor(key / 10000) * 16 / k, c }))
  return JSON.stringify({ w: A.w, h: A.h, outside: n, gt8, gt32, maxd, blocks: blocks.size, top })
})()`))
b.close()

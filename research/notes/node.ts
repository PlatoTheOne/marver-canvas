// deep-link to a node (the camera fits it), then screenshot its sticky column region
import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, board, key, out, name] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 1600, height: 1000 })
await b.go(s, `${origin}/#/b/${board}?n=${key}`)
await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky')`, 30_000)
await new Promise((r) => setTimeout(r, 3500))
const col = `document.querySelector('[data-node-notes="${key}"]')`
const clip = await b.eval(s, `(() => { const c = ${col}.getBoundingClientRect(); const n = document.querySelector('[data-node="${key}"]').getBoundingClientRect(); const x = Math.max(0, c.left - 20), y = Math.max(0, c.top - 20); return { x, y, width: Math.min(1600 - x, n.left + 200 - x), height: Math.min(1000 - y, Math.max(c.height, 400) + 40), scale: 1 } })()`)
const { data } = await b.send('Page.captureScreenshot', { format: 'png', clip }, s)
writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'))
console.log(name, JSON.stringify(clip))
b.close()

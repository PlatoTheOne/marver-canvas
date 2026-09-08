// one screenshot per noted node: the diagram gallery
import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, board, out, ...keys] = process.argv.slice(2)
const b = (await Browser.launch())!
for (const key of keys) {
  const s = await b.tab({ width: 1600, height: 1100 })
  await b.go(s, `${origin}/#/b/${board}?n=${key}`)
  try {
    await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky')`, 30_000)
    await b.until(s, `!!document.querySelector('[data-node-notes="${key}"] .sh-sticky-diagram svg') || !!document.querySelector('[data-node-notes="${key}"] pre.err')`, 30_000)
    await new Promise((r) => setTimeout(r, 2500))
    const info = await b.eval(s, `(() => { const c = document.querySelector('[data-node-notes="${key}"]'); const r = c.getBoundingClientRect(); const err = c.querySelector('pre.err')?.textContent ?? null; return { x: Math.max(0, r.left - 16), y: Math.max(0, r.top - 16), width: Math.min(1600, r.width + 32), height: Math.min(1100 - Math.max(0, r.top - 16), r.height + 32), scale: 1, err, svgs: c.querySelectorAll('svg').length, sketched: c.querySelectorAll('svg g path').length } })()`)
    const { err, svgs, sketched, ...clip } = info
    const { data } = await b.send('Page.captureScreenshot', { format: 'png', clip }, s)
    writeFileSync(`${out}/g-${key}.png`, Buffer.from(data, 'base64'))
    console.log(key, JSON.stringify({ err, svgs, paths: sketched, h: Math.round(clip.height) }))
  } catch (e) { console.log(key, 'FAILED', String(e).slice(0, 120)) }
  await b.send('Target.closeTarget', { targetId: (await b.send('Target.getTargetInfo', {}, s)).targetInfo.targetId })
}
b.close()

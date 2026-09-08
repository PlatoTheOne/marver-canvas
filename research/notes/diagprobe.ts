import { writeFileSync } from 'node:fs'
import { Browser } from '../../test/browser.ts'
const [origin, hash, out] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 2000, height: 1200 })
await b.go(s, `${origin}/${hash}`)
const SEL = '[data-note="scene:app-03-pickup"] .sh-sticky-diagram svg'
await b.until(s, `!!document.querySelector(${JSON.stringify(SEL)})`, 30_000)
await new Promise((r) => setTimeout(r, 1500))
const probe = `(() => { const svg = document.querySelector(${JSON.stringify(SEL)}); const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent.trim()).filter(Boolean); return { texts, empty: [...svg.querySelectorAll('text')].filter((t) => !t.textContent.trim()).length, vb: svg.getAttribute('viewBox'), fs: getComputedStyle(svg.querySelector('text') ?? svg).fontFamily, marked: svg.__m ?? null } })()`
console.log('first', await b.eval(s, probe))
await b.eval(s, `document.querySelector(${JSON.stringify(SEL)}).__m = 1`)
await b.press(s, 'd'); await new Promise((r) => setTimeout(r, 2500))
console.log('after d', await b.eval(s, probe))
b.close()

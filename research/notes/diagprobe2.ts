import { Browser } from '../../test/browser.ts'
const [origin, hash] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab({ width: 2000, height: 1200 })
await b.go(s, `${origin}/${hash}`)
const SEL = '[data-note="scene:app-03-pickup"] .sh-sticky-diagram svg'
await b.until(s, `!!document.querySelector(${JSON.stringify(SEL)})`, 30_000)
await new Promise((r) => setTimeout(r, 2500))
const probe = `(() => { const svg = document.querySelector(${JSON.stringify(SEL)}); const ts = [...svg.querySelectorAll('text')]; const one = (t) => { const cs = getComputedStyle(t); const bb = t.getBBox(); return [t.textContent.trim(), cs.fontSize, cs.fontWeight, cs.fontFamily.slice(0, 14), Math.round(bb.width), t.getAttribute('font-size'), (t.getAttribute('style') || '').slice(0, 60), t.getAttribute('class')] }; return { n: ts.length, styles: svg.querySelectorAll('style').length, styleLen: [...svg.querySelectorAll('style')].map((s) => s.textContent.length), first: ts.slice(0, 3).map(one), msg: ts.slice(6, 8).map(one), fontsLoaded: document.fonts.status, checked: document.fonts.check('17px "Bradley Hand"') } })()`
console.log('light', JSON.stringify(await b.eval(s, probe), null, 1))
await b.press(s, 'd'); await new Promise((r) => setTimeout(r, 2500))
console.log('dark', JSON.stringify(await b.eval(s, probe), null, 1))
b.close()

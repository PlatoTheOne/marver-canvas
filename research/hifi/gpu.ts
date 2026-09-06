import { Browser } from '../../test/browser.ts'
const b = (await Browser.launch())!
const s = await b.tab()
await b.go(s, 'chrome://gpu')
await new Promise((r) => setTimeout(r, 1500))
const t: string = await b.eval(s, `document.body.innerText`)
console.log(t.split('\n').filter((l) => /Graphics Feature Status|Canvas|Compositing|Rasterization|OpenGL|Vulkan|GL_RENDERER|ANGLE|Metal|SwiftShader|memory|Tile/i.test(l)).slice(0, 30).join('\n'))
b.close()

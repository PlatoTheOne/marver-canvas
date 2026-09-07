import { writeFileSync } from 'node:fs'
import { Browser as Cdp } from '../../src/server/cdp.ts'
import { bakeIn } from '../../src/server/bake.ts'
const [url, w, h, out] = process.argv.slice(2)
const b = await Cdp.launch('mv-bake-')
const r = await bakeIn(b, { url, width: +w, height: +h })
writeFileSync(out, JSON.stringify(r))
console.log(r.ok ? `ok ${r.targets.length} targets, ${r.rejected} rejected, outside ${JSON.stringify(r.outside)}` : r.error)
b.close()

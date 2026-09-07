/**
 * Icon barrels, unrolled.
 *
 * `import { Truck } from '@phosphor-icons/react'` makes Vite hand the frame the WHOLE prebundled
 * package - 3000 icons, 6.5 MB of JavaScript - and every frame on a board is its own realm, so every
 * frame parses and evaluates all of it: ~400 ms, the whole boot of a lo-fi frame (measured,
 * research/hifi/frameres.ts: the scene import is 530 of a 550 ms boot; a board of 128 frames spends
 * 50 s on it). The packages ship one module per icon and their barrel says which: this reads the
 * INSTALLED barrel once (every alias, whatever the version), rewrites the import declarations of
 * design sources to the per-icon modules, one line for one line, and names those modules to the
 * dependency optimizer at server start so nothing is discovered - and reloaded for - on first use.
 * A name the barrel does not map, a default or namespace import, a re-export: left as it is.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseAst, type Plugin } from 'vite'

interface IconLib {
  barrel: string
  /** The package-relative import specifier for a module the barrel names (`./csr/Truck.es.js`). */
  spec: (rel: string) => string | null
}

const LIBS: IconLib[] = [
  // exports map: `./dist/csr/*` -> `./dist/csr/*.es.js`, so the specifier drops the extension
  { barrel: '@phosphor-icons/react', spec: (rel) => { const m = rel.match(/^\.\/csr\/([\w-]+)\.es\.js$/); return m ? `@phosphor-icons/react/dist/csr/${m[1]}` : null } },
  // no exports map: the file as the barrel names it
  { barrel: 'lucide-react', spec: (rel) => { const m = rel.match(/^\.\/icons\/([\w-]+\.m?js)$/); return m ? `lucide-react/dist/esm/icons/${m[1]}` : null } },
]

/** exported name -> the per-icon module and the name to import from it ('default' or a named one) */
export type IconMap = Map<string, { spec: string; name: string }>

/** The map read from a barrel's source: `import { A as x } from './f'` + `export { x as Name }`
 *  (phosphor) and `export { default as Name } from './f'` (lucide). */
export function parseBarrel(source: string, lib: IconLib): IconMap {
  const map: IconMap = new Map()
  const locals = new Map<string, { spec: string; name: string }>()
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const spec = lib.spec(m[2]); if (!spec) continue
    for (const s of m[1].split(',')) { const [name, local = name] = s.trim().split(/\s+as\s+/); if (name) locals.set(local, { spec, name }) }
  }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
    const spec = m[2] ? lib.spec(m[2]) : null
    if (m[2] && !spec) continue
    for (const s of m[1].split(',')) {
      const [name, exported = name] = s.trim().split(/\s+as\s+/)
      if (!name) continue
      if (spec) map.set(exported, { spec, name })
      else { const l = locals.get(name); if (l) map.set(exported, l) }
    }
  }
  return map
}

const maps = new Map<string, Map<string, IconMap>>()   // root -> barrel -> map
/** The maps for every icon package installed under `root` (read once per server). */
export function iconMaps(root: string): Map<string, IconMap> {
  let m = maps.get(root)
  if (m) return m
  m = new Map()
  for (const lib of LIBS) {
    const dir = join(root, 'node_modules', lib.barrel)
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { module?: string; exports?: Record<string, { import?: string } | string> }
      const dot = pkg.exports?.['.']
      const entry = (typeof dot === 'object' ? dot.import : typeof dot === 'string' ? dot : undefined) ?? pkg.module
      if (!entry) continue
      const map = parseBarrel(readFileSync(join(dir, entry), 'utf8'), lib)
      if (map.size) m.set(lib.barrel, map)
    } catch { /* not installed here: the barrel import stays */ }
  }
  maps.set(root, m)
  return m
}

/** The code with every mapped icon import unrolled and the per-icon specifiers it now imports;
 *  null when nothing changed. Real import declarations only (a template literal is content). */
export function unrollIcons(code: string, maps: Map<string, IconMap>): { code: string; modules: string[] } | null {
  if (![...maps.keys()].some((b) => code.includes(b))) return null
  let ast: { body: unknown[] }
  try { ast = parseAst(code) as unknown as { body: unknown[] } } catch { return null }
  const edits: { start: number; end: number; text: string }[] = []
  const modules: string[] = []
  for (const node of ast.body as { type: string; start: number; end: number; source?: { value: string }; specifiers?: { type: string; imported?: { name?: string; value?: string }; local: { name: string } }[] }[]) {
    if (node.type !== 'ImportDeclaration' || !node.source) continue
    const map = maps.get(node.source.value)
    if (!map || !node.specifiers?.length) continue
    const lines: string[] = [], keep: string[] = []
    let icons = 0
    for (const s of node.specifiers) {
      const imported = s.type === 'ImportSpecifier' ? (s.imported?.name ?? s.imported?.value) : undefined
      const hit = imported ? map.get(imported) : undefined
      if (!hit) { if (s.type !== 'ImportSpecifier') { lines.length = 0; icons = 0; break } keep.push(imported === s.local.name ? imported! : `${imported} as ${s.local.name}`); continue }
      icons++
      modules.push(hit.spec)
      lines.push(hit.name === 'default' ? `import ${s.local.name} from '${hit.spec}';` : `import { ${hit.name === s.local.name ? hit.name : `${hit.name} as ${s.local.name}`} } from '${hit.spec}';`)
    }
    if (!icons) continue
    if (keep.length) lines.push(`import { ${keep.join(', ')} } from '${node.source.value}';`)
    const original = code.slice(node.start, node.end)
    edits.push({ start: node.start, end: node.end, text: lines.join(' ') + '\n'.repeat((original.match(/\n/g) ?? []).length) })
  }
  if (!edits.length) return null
  let out = '', at = 0
  for (const e of edits) { out += code.slice(at, e.start) + e.text; at = e.end }
  return { code: out + code.slice(at), modules }
}

/** Every per-icon module the design sources import (for the optimizer, at server start). Raw
 *  TypeScript is scanned by a plain pattern; only names the barrel maps count. */
export function iconModules(root: string): string[] {
  const m = iconMaps(root)
  if (!m.size) return []
  const found = new Set<string>()
  const walk = (dir: string) => {
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n === 'node_modules' || n.startsWith('.')) continue
      const p = join(dir, n)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (/\.[jt]sx?$/.test(n)) {
        const src = readFileSync(p, 'utf8')
        for (const im of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
          const map = m.get(im[2]); if (!map) continue
          for (const s of im[1].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').split(',')) { const name = s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]; const hit = map.get(name); if (hit) found.add(hit.spec) }
        }
      }
    }
  }
  walk(join(root, 'design'))
  return [...found].sort()
}

/** The Vite plugin: design sources only, after the TS/JSX transform (a normal plugin runs after
 *  the core ones), before import analysis resolves the specifiers. The rewrite keeps every line
 *  where it was, so the file's map still lands (no map of its own). */
export function iconsPlugin(root: string): Plugin {
  const design = join(root, 'design') + '/'
  return {
    name: 'marver:icons',
    transform(code, id) {
      if (!id.startsWith(design) || !/\.[jt]sx?(\?|$)/.test(id)) return
      const r = unrollIcons(code, iconMaps(root))
      return r ? { code: r.code, map: null } : undefined
    },
  }
}

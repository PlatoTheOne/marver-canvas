/**
 * Icon barrels, unrolled.
 *
 * `import { Truck } from '@phosphor-icons/react'` makes Vite hand the frame the WHOLE prebundled
 * package - 3000 icons, 6.5 MB of JavaScript - and every frame on a board is its own realm, so every
 * frame parses and evaluates all of it: ~400 ms, the whole boot of a lo-fi frame (measured,
 * research/hifi/frameres.ts: the scene import is 530 of a 550 ms boot, the icon module 17 MB decoded;
 * a board of 128 frames spends 50 s on it). The packages ship one module per icon; this transform
 * rewrites the import to those, in the design sources only, one line for one line (the source map
 * stays true), and the same scan at server start names them to the dependency optimizer so nothing
 * is discovered - and reloaded for - on first use.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

export interface IconLib {
  barrel: string
  /** The per-icon module for an exported name. */
  file: (name: string) => string
  /** The per-icon module's export: default, or the same name. */
  default: boolean
  /** Exports that are not icons (they stay on the barrel). */
  skip: Set<string>
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-zA-Z])(\d)/g, '$1-$2').toLowerCase()

export const ICON_LIBS: IconLib[] = [
  // dist/csr/<Name>.es.js exports both `<Name>` and `<Name>Icon`
  { barrel: '@phosphor-icons/react', file: (n) => `@phosphor-icons/react/dist/csr/${n.replace(/Icon$/, '')}`, default: false, skip: new Set(['Icon', 'IconBase', 'IconContext', 'IconProps', 'IconWeight', 'SSR']) },
  // dist/esm/icons/<kebab-name>.mjs, default export; `<Name>Icon` and `Lucide<Name>` are aliases
  { barrel: 'lucide-react', file: (n) => `lucide-react/dist/esm/icons/${kebab(n.replace(/^Lucide/, '').replace(/Icon$/, ''))}.mjs`, default: true, skip: new Set(['Icon', 'createLucideIcon', 'icons', 'LucideIcon', 'LucideProps', 'IconNode', 'DynamicIcon']) },
]

const IMPORT = /^([ \t]*)import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\3[ \t]*;?/gm

/** The code with every icon barrel import unrolled, and the per-icon modules it now imports;
 *  null when nothing changed. Type specifiers (before the TS transform) are dropped. */
export function unrollIcons(code: string): { code: string; modules: string[] } | null {
  const modules: string[] = []
  let changed = false
  const out = code.replace(IMPORT, (m: string, indent: string, specs: string, q: string, source: string) => {
    const lib = ICON_LIBS.find((l) => l.barrel === source)
    if (!lib) return m
    const keep: string[] = [], lines: string[] = []
    for (const raw of specs.split(',')) {
      const spec = raw.trim()
      if (!spec || spec.startsWith('type ')) continue
      const [name, alias = name] = spec.split(/\s+as\s+/)
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || lib.skip.has(name)) { keep.push(spec); continue }
      const file = lib.file(name)
      modules.push(file)
      lines.push(lib.default ? `import ${alias} from ${q}${file}${q}` : `import { ${name === alias ? name : `${name} as ${alias}`} } from ${q}${file}${q}`)
    }
    if (!lines.length) return m
    changed = true
    if (keep.length) lines.push(`import { ${keep.join(', ')} } from ${q}${source}${q}`)
    return indent + lines.join('; ') + '\n'.repeat((m.match(/\n/g) ?? []).length)
  })
  return changed ? { code: out, modules } : null
}

/** Every per-icon module the design sources import (for the optimizer, at server start). */
export function iconModules(root: string): string[] {
  const found = new Set<string>()
  const walk = (dir: string) => {
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n === 'node_modules' || n.startsWith('.')) continue
      const p = join(dir, n)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (/\.[jt]sx?$/.test(n)) { const r = unrollIcons(readFileSync(p, 'utf8')); if (r) r.modules.forEach((x) => found.add(x)) }
    }
  }
  walk(join(root, 'design'))
  return [...found].sort()
}

/** The Vite plugin: design sources only, after the TS/JSX transform (a normal plugin runs after
 *  the core ones), before import analysis resolves the specifiers. */
export function iconsPlugin(root: string): Plugin {
  const design = join(root, 'design') + '/'
  return {
    name: 'marver:icons',
    transform(code, id) {
      if (!id.startsWith(design) || !/\.[jt]sx?(\?|$)/.test(id)) return
      if (!ICON_LIBS.some((l) => code.includes(l.barrel))) return
      const r = unrollIcons(code)
      return r ? { code: r.code, map: null } : undefined
    },
  }
}

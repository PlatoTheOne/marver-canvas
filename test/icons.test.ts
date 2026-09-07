import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { iconMaps, iconModules, unrollIcons } from '../src/server/icons.ts'

// Icon barrels unrolled: a frame must never evaluate a 3000-icon package for the three it uses.
// The map comes from the INSTALLED barrel (every alias, whatever the version); a fake install here.

function install(): string {
  const root = mkdtempSync(join(tmpdir(), 'mv-icons-'))
  const ph = join(root, 'node_modules', '@phosphor-icons', 'react')
  mkdirSync(join(ph, 'dist'), { recursive: true })
  writeFileSync(join(ph, 'package.json'), JSON.stringify({ name: '@phosphor-icons/react', exports: { '.': { import: './dist/index.es.js' }, './dist/csr/*': { import: './dist/csr/*.es.js' } } }))
  writeFileSync(join(ph, 'dist', 'index.es.js'), `import * as o from "./ssr/index.es.js";
import { Truck as t, TruckIcon as n } from "./csr/Truck.es.js";
import { PulseIcon as e9, Pulse as t9, PulseIcon as n9 } from "./csr/Pulse.es.js";
import { IconContext as c } from "./lib/context.es.js";
export {
  e9 as ActivityIcon,
  c as IconContext,
  t9 as Pulse,
  n9 as PulseIcon,
  o as SSR,
  t as Truck,
  n as TruckIcon
};
`)
  const lu = join(root, 'node_modules', 'lucide-react')
  mkdirSync(join(lu, 'dist', 'esm', 'icons'), { recursive: true })
  writeFileSync(join(lu, 'package.json'), JSON.stringify({ name: 'lucide-react', module: 'dist/esm/lucide-react.mjs' }))
  writeFileSync(join(lu, 'dist', 'esm', 'lucide-react.mjs'), `import * as index from './icons/index.mjs';
export { index as icons };
export { default as Grid2X2, default as Grid2X2Icon, default as Grid2x2, default as LucideGrid2x2 } from './icons/grid-2x2.mjs';
export { default as ChevronDown, default as ChevronDownIcon } from './icons/chevron-down.mjs';
export { default as createLucideIcon } from './createLucideIcon.mjs';
`)
  return root
}

describe('icon barrels', () => {
  it('maps every alias the installed barrel exports, to the module the exports map admits', () => {
    const m = iconMaps(install())
    expect(m.get('@phosphor-icons/react')!.get('ActivityIcon')).toEqual({ spec: '@phosphor-icons/react/dist/csr/Pulse', name: 'PulseIcon' })
    expect(m.get('@phosphor-icons/react')!.get('Truck')).toEqual({ spec: '@phosphor-icons/react/dist/csr/Truck', name: 'Truck' })
    expect(m.get('@phosphor-icons/react')!.has('IconContext')).toBe(false)   // not an icon file: stays on the barrel
    expect(m.get('lucide-react')!.get('LucideGrid2x2')).toEqual({ spec: 'lucide-react/dist/esm/icons/grid-2x2.mjs', name: 'default' })
    expect(m.get('lucide-react')!.has('createLucideIcon')).toBe(false)
  })
  it('rewrites real import declarations: aliases, an alias of another file, non-icons kept, one line for one line, terminated', () => {
    const m = iconMaps(install())
    const r = unrollIcons(`import { Truck, ActivityIcon as Act, IconContext, Nope } from '@phosphor-icons/react';console.log(Truck)\nimport {\n  Grid2x2,\n  ChevronDown as Down,\n} from 'lucide-react'\nconst t = \`\nimport { Truck } from '@phosphor-icons/react'\n\`\n`, m)!
    const lines = r.code.split('\n')
    expect(lines[0]).toBe(`import { Truck } from '@phosphor-icons/react/dist/csr/Truck'; import { PulseIcon as Act } from '@phosphor-icons/react/dist/csr/Pulse'; import { IconContext, Nope } from '@phosphor-icons/react';console.log(Truck)`)
    expect(lines[1]).toBe(`import Grid2x2 from 'lucide-react/dist/esm/icons/grid-2x2.mjs'; import Down from 'lucide-react/dist/esm/icons/chevron-down.mjs';`)
    expect(lines).toHaveLength(9)   // the multi-line import kept its lines
    expect(lines[6]).toBe(`import { Truck } from '@phosphor-icons/react'`)   // inside the template literal: content, untouched
    expect(r.modules).toEqual(['@phosphor-icons/react/dist/csr/Truck', '@phosphor-icons/react/dist/csr/Pulse', 'lucide-react/dist/esm/icons/grid-2x2.mjs', 'lucide-react/dist/esm/icons/chevron-down.mjs'])
  })
  it('leaves alone: default and namespace imports, re-exports, other packages, unmapped names, a package not installed', () => {
    const m = iconMaps(install())
    expect(unrollIcons(`import Icons, { Truck } from '@phosphor-icons/react'`, m)).toBeNull()
    expect(unrollIcons(`import * as P from '@phosphor-icons/react'`, m)).toBeNull()
    expect(unrollIcons(`export { Truck } from '@phosphor-icons/react'`, m)).toBeNull()
    expect(unrollIcons(`import { Nope } from '@phosphor-icons/react'`, m)).toBeNull()
    expect(unrollIcons(`import { a } from 'b'`, m)).toBeNull()
    expect(iconMaps(mkdtempSync(join(tmpdir(), 'mv-noicons-'))).size).toBe(0)
  })
  it('iconModules scans the design tree for the optimizer, mapped names only, type specifiers included', () => {
    const root = install()
    mkdirSync(join(root, 'design', 'scenes', 'x'), { recursive: true })
    mkdirSync(join(root, 'design', 'node_modules', 'y'), { recursive: true })
    writeFileSync(join(root, 'design', 'scenes', 'x', 'a.tsx'), `import { Truck, Nope, type IconProps } from '@phosphor-icons/react'\nimport { ChevronDown } from 'lucide-react'`)
    writeFileSync(join(root, 'design', 'scenes', 'b.jsx'), `import { /* } */ ActivityIcon/*x*/as A, // trailing\n } from '@phosphor-icons/react'`)
    writeFileSync(join(root, 'design', 'node_modules', 'y', 'c.tsx'), `import { Pulse } from '@phosphor-icons/react'`)
    expect(iconModules(root)).toEqual(['@phosphor-icons/react/dist/csr/Pulse', '@phosphor-icons/react/dist/csr/Truck', 'lucide-react/dist/esm/icons/chevron-down.mjs'])
  })
})

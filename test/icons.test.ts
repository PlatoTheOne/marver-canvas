import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { iconModules, unrollIcons } from '../src/server/icons.ts'

// Icon barrels unrolled: a frame must never evaluate a 3000-icon package for the three it uses.

describe('unrollIcons', () => {
  it('phosphor: one named import per icon, aliases kept, non-icons left on the barrel, one line for one line', () => {
    const r = unrollIcons(`import { Truck, CaretRight as Caret, IconContext, TruckIcon } from '@phosphor-icons/react'\nconst x = 1`)!
    expect(r.code.split('\n')).toHaveLength(2)
    expect(r.code.split('\n')[0]).toBe(`import { Truck } from '@phosphor-icons/react/dist/csr/Truck'; import { CaretRight as Caret } from '@phosphor-icons/react/dist/csr/CaretRight'; import { TruckIcon } from '@phosphor-icons/react/dist/csr/Truck'; import { IconContext } from '@phosphor-icons/react'`)
    expect(r.modules).toEqual(['@phosphor-icons/react/dist/csr/Truck', '@phosphor-icons/react/dist/csr/CaretRight', '@phosphor-icons/react/dist/csr/Truck'])
  })
  it('lucide: default imports from kebab-case files, digits and aliases included', () => {
    const r = unrollIcons(`import { ChevronDown, Maximize2, AArrowDown, ExternalLinkIcon, LucideStar as S, createLucideIcon } from 'lucide-react'`)!
    expect(r.code).toBe(`import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs'; import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.mjs'; import AArrowDown from 'lucide-react/dist/esm/icons/a-arrow-down.mjs'; import ExternalLinkIcon from 'lucide-react/dist/esm/icons/external-link.mjs'; import S from 'lucide-react/dist/esm/icons/star.mjs'; import { createLucideIcon } from 'lucide-react'`)
  })
  it('a multi-line import keeps its line count; type specifiers are dropped; other packages are untouched', () => {
    const src = `import {\n  Truck,\n  type IconProps,\n} from '@phosphor-icons/react'\nimport { useState } from 'react'\n`
    const r = unrollIcons(src)!
    expect(r.code.split('\n')).toHaveLength(src.split('\n').length)
    expect(r.code).toContain(`import { useState } from 'react'`)
    expect(r.code).not.toContain('IconProps')
    expect(unrollIcons(`import { a } from 'b'`)).toBeNull()
  })
  it('iconModules scans the design tree once, for the optimizer', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv-icons-'))
    mkdirSync(join(root, 'design', 'scenes', 'x'), { recursive: true })
    mkdirSync(join(root, 'design', 'node_modules', 'y'), { recursive: true })
    writeFileSync(join(root, 'design', 'scenes', 'x', 'a.tsx'), `import { Truck, X } from '@phosphor-icons/react'\nimport { Check } from 'lucide-react'`)
    writeFileSync(join(root, 'design', 'scenes', 'b.jsx'), `import { X } from '@phosphor-icons/react'`)
    writeFileSync(join(root, 'design', 'node_modules', 'y', 'c.tsx'), `import { Skull } from '@phosphor-icons/react'`)
    expect(iconModules(root)).toEqual(['@phosphor-icons/react/dist/csr/Truck', '@phosphor-icons/react/dist/csr/X', 'lucide-react/dist/esm/icons/check.mjs'])
  })
})

import { describe, expect, it } from 'vitest'
import { keepBackdropFilter } from '../src/server/css-fix.ts'

// The published stylesheet keeps its glass: lightningcss ships only -webkit-backdrop-filter and
// Chromium then computes backdrop-filter: none - the standard declaration goes back beside it.

describe('keepBackdropFilter', () => {
  it('adds the standard declaration where a block has only the prefixed one', () => {
    expect(keepBackdropFilter('.glass {\n  -webkit-backdrop-filter: blur(28px) saturate(1.2) brightness(.55);\n  border: 1px solid red;\n}'))
      .toBe('.glass {\n  -webkit-backdrop-filter: blur(28px) saturate(1.2) brightness(.55);backdrop-filter:blur(28px) saturate(1.2) brightness(.55);\n  border: 1px solid red;\n}')
  })
  it('leaves a block that already has both, in either order, and one with neither', () => {
    const both = '.a{backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}.b{-webkit-backdrop-filter:blur(2px);color:red;backdrop-filter:blur(2px)}.c{color:blue}'
    expect(keepBackdropFilter(both)).toBe(both)
  })
  it('a var() value and a minified last declaration', () => {
    expect(keepBackdropFilter('.x{-webkit-backdrop-filter:var(--blur)}')).toBe('.x{-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}')
  })
})

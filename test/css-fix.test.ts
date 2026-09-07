import { describe, expect, it } from 'vitest'
import { keepBackdropFilter } from '../src/server/css-fix.ts'

// The published stylesheet keeps its glass: lightningcss ships only -webkit-backdrop-filter and
// Chromium then computes backdrop-filter: none - the standard declaration goes back beside it.

describe('keepBackdropFilter', () => {
  it('adds the standard declaration where a block has only the prefixed one, keeping the text as it was', () => {
    expect(keepBackdropFilter('.glass {\n  -webkit-backdrop-filter: blur(28px) saturate(1.2) brightness(.55);\n  border: 1px solid red;\n}'))
      .toBe('.glass {\n  -webkit-backdrop-filter: blur(28px) saturate(1.2) brightness(.55);backdrop-filter:blur(28px) saturate(1.2) brightness(.55);\n  border: 1px solid red;\n}')
  })
  it('leaves a block that already has both, in either order, and one with neither', () => {
    const both = '.a{backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}.b{-webkit-backdrop-filter:blur(2px);color:red;backdrop-filter:blur(2px)}.c{color:blue}'
    expect(keepBackdropFilter(both)).toBe(both)
  })
  it('a var() value, !important, uppercase, and a minified last declaration', () => {
    expect(keepBackdropFilter('.x{-webkit-backdrop-filter:var(--blur)}')).toBe('.x{-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}')
    expect(keepBackdropFilter('.y{-WEBKIT-BACKDROP-FILTER: blur(1px) !important;}')).toBe('.y{-WEBKIT-BACKDROP-FILTER: blur(1px) !important;backdrop-filter:blur(1px) !important;}')
  })
  it('strings and comments are content: a brace or a declaration inside one is not syntax', () => {
    const css = '.q::after{content:"}";-webkit-backdrop-filter:blur(3px)}.r{content:"backdrop-filter:blur(9px)";-webkit-backdrop-filter:blur(5px)}.s{/* backdrop-filter: nope */-webkit-backdrop-filter:blur(7px)}'
    expect(keepBackdropFilter(css)).toBe('.q::after{content:"}";-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}.r{content:"backdrop-filter:blur(9px)";-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}.s{/* backdrop-filter: nope */-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px)}')
  })
  it('a custom property is not the property; every prefixed declaration is mirrored in order, so an earlier !important still wins', () => {
    expect(keepBackdropFilter('.a{--webkit-backdrop-filter:blur(9px);color:red}')).toBe('.a{--webkit-backdrop-filter:blur(9px);color:red}')
    expect(keepBackdropFilter('.b{--webkit-backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(1px)}')).toBe('.b{--webkit-backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px)}')
    expect(keepBackdropFilter('.c{-webkit-backdrop-filter:blur(1px)!important;-webkit-backdrop-filter:blur(2px);color:red}'))
      .toBe('.c{-webkit-backdrop-filter:blur(1px)!important;backdrop-filter:blur(1px)!important;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);color:red}')
  })
  it('a nested rule and its prelude are not the block\'s declarations, whatever the prelude says', () => {
    expect(keepBackdropFilter('.a{-webkit-backdrop-filter:blur(1px);@supports (backdrop-filter:blur(2px)){color:red}}'))
      .toBe('.a{-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px);@supports (backdrop-filter:blur(2px)){color:red}}')
    expect(keepBackdropFilter('.a{color:red;@supports (-webkit-backdrop-filter:blur(2px)){color:blue}}'))
      .toBe('.a{color:red;@supports (-webkit-backdrop-filter:blur(2px)){color:blue}}')
  })
  it('declarations around a nested rule belong to the outer block; the nested rule is its own', () => {
    expect(keepBackdropFilter('.a{color:red;.b{-webkit-backdrop-filter:blur(3px)}-webkit-backdrop-filter:blur(4px);}'))
      .toBe('.a{color:red;.b{-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);}')
    expect(keepBackdropFilter('.a{-webkit-backdrop-filter:blur(4px);.b{backdrop-filter:blur(3px)}}')).toBe('.a{-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);.b{backdrop-filter:blur(3px)}}')
  })
  it('an at-rule condition is not a declaration: nested @media and @supports blocks are read innermost', () => {
    const css = '@media (min-width: 1px) {\n  @supports (backdrop-filter: blur(1px)) {\n    .a { -webkit-backdrop-filter: blur(2px); }\n  }\n}'
    expect(keepBackdropFilter(css)).toBe('@media (min-width: 1px) {\n  @supports (backdrop-filter: blur(1px)) {\n    .a { -webkit-backdrop-filter: blur(2px);backdrop-filter:blur(2px); }\n  }\n}')
  })
  it('declaration boundaries: a property name inside a custom property value is a value; a semicolon inside url() is a value', () => {
    expect(keepBackdropFilter('.a{--x:backdrop-filter:none;-webkit-backdrop-filter:blur(2px)}')).toBe('.a{--x:backdrop-filter:none;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}')
    expect(keepBackdropFilter('.b{--x:-webkit-backdrop-filter:blur(9px);color:red}')).toBe('.b{--x:-webkit-backdrop-filter:blur(9px);color:red}')
    expect(keepBackdropFilter('.c{-webkit-backdrop-filter:url(#a;b);color:red}')).toBe('.c{-webkit-backdrop-filter:url(#a;b);backdrop-filter:url(#a;b);color:red}')
  })
  it('a custom property\'s value may hold braces, brackets and semicolons: never syntax', () => {
    expect(keepBackdropFilter('.a{--x:{-webkit-backdrop-filter:blur(9px)}}')).toBe('.a{--x:{-webkit-backdrop-filter:blur(9px)}}')
    expect(keepBackdropFilter('.a{--x:[x;backdrop-filter:none];-webkit-backdrop-filter:blur(2px)}')).toBe('.a{--x:[x;backdrop-filter:none];-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}')
    expect(keepBackdropFilter('.a{--x:{a:b};.b{-webkit-backdrop-filter:blur(1px)}}')).toBe('.a{--x:{a:b};.b{-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px)}}')
  })
  it('a Unicode custom property name; braces inside parentheses are a value, not a rule', () => {
    expect(keepBackdropFilter('.a{--é:{-webkit-backdrop-filter:blur(9px)}}')).toBe('.a{--é:{-webkit-backdrop-filter:blur(9px)}}')
    expect(keepBackdropFilter('.a{--f:blur(2px);-webkit-backdrop-filter:var(--f,{})}')).toBe('.a{--f:blur(2px);-webkit-backdrop-filter:var(--f,{});backdrop-filter:var(--f,{})}')
    expect(keepBackdropFilter('.a{-webkit-backdrop-filter:url(#a{b);color:red}')).toBe('.a{-webkit-backdrop-filter:url(#a{b);backdrop-filter:url(#a{b);color:red}')
  })
})

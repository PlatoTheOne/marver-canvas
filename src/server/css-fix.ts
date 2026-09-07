/**
 * The published stylesheet keeps its glass.
 *
 * Vite 8 transforms CSS with lightningcss, and on a rule that declares both `backdrop-filter` and
 * `-webkit-backdrop-filter` it ships only the prefixed one, whatever the targets and even
 * unminified. Chromium no longer applies the prefixed alias when the standard property is absent,
 * so every glass surface of a published hi-fi frame went flat (the dev canvas inlines the host CSS
 * and keeps both). This puts the standard declaration back beside the prefixed one, in the transform
 * of every stylesheet - after the core CSS transform, BEFORE the asset is hashed and emitted, so a
 * republish that changes the bytes changes the immutable file name too.
 */
import type { Plugin } from 'vite'

/** Every `-webkit-backdrop-filter` declaration (the property itself, never a custom property that
 *  happens to end in it) is mirrored by the standard one right after it, in order, importance and
 *  all - the standard cascade then resolves exactly as the prefixed one did - unless the declaration
 *  list it belongs to declares the standard property already. The list is the enclosing block's own
 *  declarations: nested rules, their preludes included, are blanked. Strings and comments are masked
 *  first, so a brace or a declaration inside one is content, not syntax; values come from the
 *  original text. */
export function keepBackdropFilter(css: string): string {
  const masked = css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => ' '.repeat(m.length))
  const PREFIXED = /(^|[^-\w])-webkit-backdrop-filter\s*:/gi   // a candidate; the declaration split below decides
  const seen = new Set<number>()
  const edits: { at: number; text: string }[] = []
  for (const m of masked.matchAll(PREFIXED)) {
    const p = m.index! + m[1].length
    // the enclosing block: back to the unmatched `{`, forward to its `}`
    let depth = 0, open = -1
    for (let i = p - 1; i >= 0; i--) { const c = masked[i]; if (c === '}') depth++; else if (c === '{') { if (depth === 0) { open = i; break } depth-- } }
    if (open < 0 || seen.has(open)) continue
    seen.add(open)
    let close = masked.length; depth = 0
    for (let i = open + 1; i < masked.length; i++) { const c = masked[i]; if (c === '{') depth++; else if (c === '}') { if (depth === 0) { close = i; break } depth-- } }
    // its own declarations: every nested rule blanked with its prelude (from the last `;` before its
    // brace), same length as the block
    const own = masked.slice(open + 1, close).split('')
    depth = 0
    let seg = 0
    for (let i = 0; i < own.length; i++) {
      const c = own[i]
      if (depth === 0 && c === ';') { seg = i + 1; continue }
      if (c === '{') { if (depth === 0) for (let k = seg; k < i; k++) own[k] = ' '; depth++ }
      if (depth) own[i] = ' '
      if (c === '}') { depth--; if (depth === 0) seg = i + 1 }
    }
    // the list's declarations: split on `;` outside parentheses, the property before the first colon
    const list = own.join('')
    const decls: { prop: string; valueAt: number; end: number }[] = []
    let paren = 0, from = 0
    for (let i = 0; i <= list.length; i++) {
      const c = list[i]
      if (c === '(') paren++; else if (c === ')') paren = Math.max(0, paren - 1)
      if (i === list.length || (c === ';' && paren === 0)) {
        const text = list.slice(from, i), colon = text.indexOf(':')
        if (colon > 0) decls.push({ prop: text.slice(0, colon).trim().toLowerCase(), valueAt: from + colon + 1, end: i })
        from = i + 1
      }
    }
    if (decls.some((x) => x.prop === 'backdrop-filter')) continue
    for (const x of decls) {
      if (x.prop !== '-webkit-backdrop-filter') continue
      const value = css.slice(open + 1 + x.valueAt, open + 1 + x.end).trim()
      if (value) edits.push({ at: open + 1 + x.end, text: `;backdrop-filter:${value}` })
    }
  }
  let out = css
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at)
  return out
}

export function cssFixPlugin(): Plugin {
  return {
    name: 'marver:css-fix',
    transform(code, id) {
      if (!/\.css$/.test(id.split('?')[0])) return
      const fixed = keepBackdropFilter(code)
      return fixed === code ? undefined : { code: fixed, map: null }
    },
  }
}

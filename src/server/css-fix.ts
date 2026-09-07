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
  const PREFIXED = /(^|[^-\w])-webkit-backdrop-filter\s*:\s*([^;{}]+)/gi
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
    const list = own.join('')
    if (/(^|[^-\w])backdrop-filter\s*:/i.test(list)) continue
    for (const x of list.matchAll(PREFIXED)) {
      const at = open + 1 + x.index! + x[0].length, value = css.slice(at - x[2].length, at).trim()
      if (value) edits.push({ at, text: `;backdrop-filter:${value}` })
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

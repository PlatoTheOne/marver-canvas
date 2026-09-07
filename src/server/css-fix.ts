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

/** For every `-webkit-backdrop-filter` declaration (the property itself, never a custom property
 *  that happens to end in it), the declaration list it belongs to - the enclosing block at that
 *  nesting level, nested rules blanked - gets the standard declaration after its LAST prefixed one
 *  (the cascade order the author had), unless it declares the standard property already. Strings
 *  and comments are masked first, so a brace or a declaration inside one is content, not syntax;
 *  values are copied from the original text. */
export function keepBackdropFilter(css: string): string {
  const masked = css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => ' '.repeat(m.length))
  const PREFIXED = /(^|[^-\w])-webkit-backdrop-filter\s*:\s*([^;{}]+)/gi
  const edits = new Map<number, string>()
  for (const m of masked.matchAll(PREFIXED)) {
    const p = m.index! + m[1].length
    // the enclosing block: back to the unmatched `{`, forward to its `}`
    let depth = 0, open = -1
    for (let i = p - 1; i >= 0; i--) { const c = masked[i]; if (c === '}') depth++; else if (c === '{') { if (depth === 0) { open = i; break } depth-- } }
    if (open < 0 || edits.has(open)) continue
    let close = masked.length; depth = 0
    for (let i = open + 1; i < masked.length; i++) { const c = masked[i]; if (c === '{') depth++; else if (c === '}') { if (depth === 0) { close = i; break } depth-- } }
    // its own declarations: the block with every nested rule blanked (same length)
    let own = ''; depth = 0
    for (let i = open + 1; i < close; i++) { const c = masked[i]; if (c === '{') depth++; own += depth ? ' ' : c; if (c === '}') depth-- }
    if (/(^|[^-\w])backdrop-filter\s*:/i.test(own)) continue
    let last: RegExpExecArray | undefined
    for (const x of own.matchAll(PREFIXED)) last = x
    if (!last) continue
    const at = open + 1 + last.index! + last[0].length, value = css.slice(at - last[2].length, at).trim()
    if (value) edits.set(open, `${at}:;backdrop-filter:${value}`)
  }
  let out = css
  for (const e of [...edits.values()].map((v) => ({ at: Number(v.slice(0, v.indexOf(':'))), text: v.slice(v.indexOf(':') + 1) })).sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at)
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

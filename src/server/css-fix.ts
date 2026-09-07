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

/** Every innermost block that has the prefixed declaration and not the standard one gets it. Strings
 *  and comments are masked first, so a brace or a declaration inside one is content, not syntax;
 *  the value is copied from the original text. */
export function keepBackdropFilter(css: string): string {
  const masked = css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => ' '.repeat(m.length))
  const edits: { at: number; text: string }[] = []
  for (const m of masked.matchAll(/\{[^{}]*\}/g)) {
    const block = m[0], start = m.index!
    if (/(^|[^-\w])backdrop-filter\s*:/i.test(block)) continue
    const d = /-webkit-backdrop-filter\s*:\s*([^;}]+)/i.exec(block)
    if (!d) continue
    const valueStart = start + d.index + d[0].length - d[1].length, at = start + d.index + d[0].length
    const value = css.slice(valueStart, at).trim()
    if (value) edits.push({ at, text: `;backdrop-filter:${value}` })
  }
  let out = css
  for (const e of edits.reverse()) out = out.slice(0, e.at) + e.text + out.slice(e.at)
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

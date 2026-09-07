/**
 * The published stylesheet keeps its glass.
 *
 * Vite 8 transforms CSS with lightningcss, and on a rule that declares both `backdrop-filter` and
 * `-webkit-backdrop-filter` it ships only the prefixed one, whatever the targets and even
 * unminified. Chromium no longer applies the prefixed alias when the standard property is absent,
 * so every glass surface of a published hi-fi frame went flat (the dev canvas inlines the host CSS
 * and keeps both). This puts the standard declaration back beside the prefixed one, on the final
 * assets, wherever a block lacks it.
 */
import type { Plugin } from 'vite'

export function keepBackdropFilter(css: string): string {
  return css.replace(/\{[^}]*\}/g, (block) => {
    const m = block.match(/-webkit-backdrop-filter\s*:\s*([^;}]+)/)
    if (!m || /(^|[^-\w])backdrop-filter\s*:/.test(block)) return block
    return block.replace(m[0], `${m[0]};backdrop-filter:${m[1].trim()}`)
  })
}

export function cssFixPlugin(): Plugin {
  return {
    name: 'marver:css-fix',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const a of Object.values(bundle)) if (a.type === 'asset' && a.fileName.endsWith('.css') && typeof a.source === 'string') a.source = keepBackdropFilter(a.source)
    },
  }
}

/**
 * The paint override a sleeping backdrop-filter element wears (spec 16) - ONE definition, used by
 * the compiler inside the frame it certifies (src/server/bake.ts embeds these functions' source in
 * a page script) and by the shell inside the frame it puts to sleep (src/client/shell/canvas/sleep.ts).
 * Plain ES2020 with no imports or closures, so `Function.prototype.toString` carries it whole.
 *
 * The composition, bottom to top: the certified texture (the element's filtered backdrop, clipped to
 * its border box the way the effect is), the element's own colour under the clip the author gave it,
 * the element's own images, then its content. `blur(0px)` keeps the element an effect layer whose
 * surface Chrome caches (measured better than `none` on identity and on frame drops).
 */
export interface OwnBackground { img: string; color: string; size: string; pos: string; rep: string; org: string; clip: string }

/** The element's own background, read once BEFORE any override touches it. */
export function readOwn(cs: CSSStyleDeclaration): OwnBackground {
  return { img: cs.backgroundImage, color: cs.backgroundColor, size: cs.backgroundSize, pos: cs.backgroundPosition, rep: cs.backgroundRepeat, org: cs.backgroundOrigin, clip: cs.backgroundClip }
}

export function sleepRule(selector: string, o: OwnBackground, texture: string): string {
  const img = o.img === 'none' ? '' : o.img + ','
  // the authored colour paints under the LAST layer's clip (CSS Backgrounds 3)
  const colorClip = o.clip.split(',').pop()!.trim() || 'border-box'
  return selector + '{backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important;' +
    'background-color:transparent!important;' +
    'background-image:' + img + 'linear-gradient(' + o.color + ',' + o.color + '),url("' + texture + '")!important;' +
    'background-size:' + (img ? o.size + ',' : '') + 'auto,100% 100%!important;' +
    'background-position:' + (img ? o.pos + ',' : '') + '0 0,0 0!important;' +
    'background-repeat:' + (img ? o.rep + ',' : '') + 'no-repeat,no-repeat!important;' +
    'background-origin:' + (img ? o.org + ',' : '') + 'border-box,border-box!important;' +
    'background-clip:' + (img ? o.clip + ',' : '') + colorClip + ',border-box!important}'
}

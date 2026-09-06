/**
 * Sleep - a frame at rest, in place (spec 16).
 *
 * A resting frame is its own LIVE document. Nothing is copied, pictured or swapped, so the moment
 * the human interacts, comments or lasers, they are already looking at the thing itself: no line
 * break, no spacing, no pixel can move. Sleep changes PAINT only:
 *
 *   - CSS animations pause (`animation-play-state: paused`);
 *   - every `backdrop-filter` element - the one effect that reads back what is behind it on every
 *     composited frame, and the reason a glass design checkerboards at scale - gets the compositor's
 *     own filtered backdrop as a static texture under its own background layers, computed and
 *     certified by the dev server in headless Chrome (src/server/bake.ts); the rule itself is
 *     src/shared/sleep-rule.ts, the same one the compiler certified.
 *
 * A frame with no such element - markdown, images, slides, lo-fi - never talks to the server:
 * its sleep is the animation pause. Frames are asked in one batch per tick; the server answers from
 * its disk cache (keyed by frame, theme, size and source generation) or compiles. Textures are
 * decoded BEFORE the override is installed, so sleep is one paint. Without textures - no compiler
 * (a published canvas), a compile that failed, a texture that does not decode - the frame sleeps
 * with the pause alone and its glass stays live: never an effect layer without its texture.
 *
 * Safety: the override is all or nothing - every target's selector must resolve to an element whose
 * border box is the one the server measured (0.02 px) and whose filter is still the one baked, or
 * the frame stays live. Wake restores the live effects under `transition: none` (an authored
 * transition on backdrop-filter or background must not animate out of the sleep), then removes the
 * <style> and the attributes on the next frame.
 */
import { ROUTE } from '../../const.ts'
import { readOwn, sleepRule } from '../../../shared/sleep-rule.ts'

export interface SleepKey { frame: string; theme: string; w: number; h: number }
interface Target { sel: string; rect: { x: number; y: number; w: number; h: number }; filter: string; level: number; texture: string; verified: boolean }
type Answer = { ok: true; targets: Target[] } | { ok: false; error: string }

const STYLE_ID = 'mv-sleep'
/** `?awake=1` keeps every frame live - the diagnostic switch the identity probes compare against. */
const AWAKE = new URLSearchParams(location.search).get('awake') === '1'
const PAUSE = `*,*::before,*::after{animation-play-state:paused!important}`
const csrf = () => document.cookie.match(/(?:^|; )mv_c=([^;]+)/)?.[1] ?? ''
const keyOf = (k: SleepKey) => `${k.frame}|${k.theme}|${Math.round(k.w)}|${Math.round(k.h)}`

/** What a node's DOCUMENT is asleep under, published only once its override is INSTALLED. */
const asleep = new Map<string, { key: string; doc: Document }>()
/** The node's current request, so a stale answer (a newer sleep, a wake in between) is dropped. */
const pending = new Map<string, number>()
let seq = 0

/** Does this document have anything to compile? Cheap: one computed style per element. */
export function hasEffects(doc: Document): boolean {
  for (const el of doc.querySelectorAll('*')) {
    const cs = doc.defaultView!.getComputedStyle(el)
    const bf = cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter
    if (bf && bf !== 'none') return true
  }
  return false
}

// ---- one batch per tick: every frame that decides to sleep in the same moment shares a browser
const queue: { key: SleepKey; resolve: (a: Answer) => void }[] = []
let flush: ReturnType<typeof setTimeout> | undefined
function ask(key: SleepKey): Promise<Answer> {
  return new Promise((resolve) => {
    queue.push({ key, resolve })
    clearTimeout(flush)
    flush = setTimeout(async () => {
      const batch = queue.splice(0)
      // one ask per key; every waiter for that key gets the same answer
      const byKey = new Map<string, { key: SleepKey; waiters: ((a: Answer) => void)[] }>()
      for (const q of batch) { const kk = keyOf(q.key); const e = byKey.get(kk); if (e) e.waiters.push(q.resolve); else byKey.set(kk, { key: q.key, waiters: [q.resolve] }) }
      const asks = [...byKey.values()].map((e) => ({ frame: e.key.frame, theme: e.key.theme, w: Math.round(e.key.w), h: Math.round(e.key.h) }))
      let data: { answers?: (Answer & SleepKey)[] } | null = null
      try {
        const r = await fetch(`${ROUTE}/api/bakes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mv-c': csrf() }, body: JSON.stringify({ asks }) })
        data = r.ok ? await r.json() : null
      } catch { data = null }
      for (const e of byKey.values()) {
        const a = data?.answers?.find((x) => keyOf(x) === keyOf(e.key))
        const answer: Answer = a ? (a.ok ? { ok: true, targets: a.targets } : { ok: false, error: a.error }) : { ok: false, error: 'no answer' }
        for (const w of e.waiters) w(answer)
      }
    }, 40)
  })
}

/** Put a node's live document to sleep under `key`. Resolves once the override is installed (or
 *  the document was found to have no effects, or the compile failed and the frame stays live).
 *  A wake or a newer sleep in the meantime supersedes it. */
export async function sleep(nodeKey: string, iframe: HTMLIFrameElement, key: SleepKey): Promise<'asleep' | 'live'> {
  if (AWAKE) return 'live'
  const k = keyOf(key)
  const doc = iframe.contentDocument
  if (!doc?.body) return 'live'
  const have = asleep.get(nodeKey)
  if (have && have.key === k && have.doc === doc && doc.getElementById(STYLE_ID)) return 'asleep'
  const mine = ++seq
  pending.set(nodeKey, mine)
  const current = () => pending.get(nodeKey) === mine && iframe.contentDocument === doc
  if (!hasEffects(doc)) {
    // nothing to compile: the pause alone is this frame's sleep
    if (!current()) return 'live'
    install(doc, [])
    asleep.set(nodeKey, { key: k, doc })
    return 'asleep'
  }
  const answer = await ask(key)
  if (!current()) return 'live'
  // no compiler (a published canvas, a compile that failed): the pause alone, the glass live -
  // never an effect layer without its texture
  let targets = answer.ok ? answer.targets.filter((t) => t.verified && t.texture) : []
  // decode every texture BEFORE the paint that installs them - one commit, no pop-in; one that
  // fails to decode (pruned, missing, corrupt) leaves the glass live
  const decoded = await Promise.all(targets.map((t) => { const im = new Image(); im.src = t.texture; return im.decode().then(() => true, () => false) }))
  if (!current()) return 'live'
  if (decoded.some((ok) => !ok)) targets = []
  if (!install(doc, targets)) return 'live'
  asleep.set(nodeKey, { key: k, doc })
  return 'asleep'
}

/** Wake: paint goes back to the live effects. The document is otherwise untouched. */
export function wake(nodeKey: string, iframe: HTMLIFrameElement | null): void {
  pending.delete(nodeKey)
  asleep.delete(nodeKey)
  const doc = iframe?.contentDocument
  const st = doc?.getElementById(STYLE_ID)
  if (!doc || !st) return
  // the effects return under `transition: none`, computed NOW (a forced style recalc is a style
  // change event); then the rule and the attributes go, with no property left to animate
  st.textContent = `[data-mv-sleep]{transition:none!important}`
  void doc.documentElement.offsetWidth
  st.remove()
  doc.querySelectorAll('[data-mv-sleep]').forEach((el) => el.removeAttribute('data-mv-sleep'))
}

/** Install the override for the targets. All or nothing: a target whose element is not exactly the
 *  one the server measured leaves the whole document live. Returns whether it was installed. */
function install(doc: Document, targets: Target[]): boolean {
  doc.querySelectorAll('[data-mv-sleep]').forEach((el) => el.removeAttribute('data-mv-sleep'))
  const rules: string[] = [PAUSE]
  const els: Element[] = []
  for (const [i, t] of targets.entries()) {
    let el: Element | null = null
    try { el = doc.querySelector(t.sel) } catch { /* a selector from another document shape */ }
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (Math.abs(r.x - t.rect.x) > 0.02 || Math.abs(r.y - t.rect.y) > 0.02 || Math.abs(r.width - t.rect.w) > 0.02 || Math.abs(r.height - t.rect.h) > 0.02) return false
    const cs = doc.defaultView!.getComputedStyle(el)
    if ((cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || 'none') !== t.filter) return false
    rules.push(sleepRule(`[data-mv-sleep="${i}"]`, readOwn(cs), t.texture))
    els.push(el)
  }
  els.forEach((el, i) => el.setAttribute('data-mv-sleep', String(i)))
  let st = doc.getElementById(STYLE_ID)
  if (!st) { st = doc.createElement('style'); st.id = STYLE_ID; (doc.head ?? doc.documentElement).appendChild(st) }
  st.textContent = rules.join('\n')
  return true
}

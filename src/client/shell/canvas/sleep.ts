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
 *     certified by the dev server in headless Chrome (src/server/bake.ts), and
 *     `backdrop-filter: blur(0px)` (the element stays an effect layer whose surface Chrome caches;
 *     measured better than `none` on identity and on frame drops).
 *
 * A frame with no such element - markdown, images, slides, lo-fi - never talks to the server:
 * its sleep is the animation pause. Frames are asked in one batch per tick; textures are files with
 * immutable URLs and are decoded BEFORE the override is installed, so sleep is one paint.
 *
 * Safety: a texture is applied only to an element whose selector resolves, whose border box is the
 * one the server measured (0.02 px) and whose filter is still the one baked; anything else stays
 * live. Wake removes one <style> and the attributes.
 */
import { ROUTE } from '../../const.ts'

export interface SleepKey { frame: string; theme: string; w: number; h: number }
interface Target { sel: string; rect: { x: number; y: number; w: number; h: number }; filter: string; level: number; texture: string; verified: boolean }
type Answer = { ok: true; targets: Target[] } | { ok: false; error: string }

const STYLE_ID = 'mv-sleep'
/** `?awake=1` keeps every frame live - the diagnostic switch the identity probes compare against. */
const AWAKE = new URLSearchParams(location.search).get('awake') === '1'
const PAUSE = `*,*::before,*::after{animation-play-state:paused!important}`
const csrf = () => document.cookie.match(/(?:^|; )mv_c=([^;]+)/)?.[1] ?? ''
const keyOf = (k: SleepKey) => `${k.frame}|${k.theme}|${Math.round(k.w)}|${Math.round(k.h)}`

/** What a node is asleep under, published only once its override is INSTALLED. */
const asleep = new Map<string, string>()
/** The node's current request, so a stale answer (a newer sleep, a wake in between) is dropped. */
const pending = new Map<string, number>()
let seq = 0

/** Answers by key, for the next sleep of the same frame at the same size and theme (a theme flipped
 *  back, a board revisited). Bounded; textures are URLs, so the entries are small. */
const answers = new Map<string, Answer>()
const ANSWERS_MAX = 400
const remember = (k: string, a: Answer) => { answers.delete(k); answers.set(k, a); if (answers.size > ANSWERS_MAX) answers.delete(answers.keys().next().value!) }

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
  const k = keyOf(key)
  const have = answers.get(k)
  if (have) return Promise.resolve(have)
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
        if (answer.ok) remember(keyOf(e.key), answer)
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
  if (asleep.get(nodeKey) === k) return 'asleep'
  const mine = ++seq
  pending.set(nodeKey, mine)
  const doc = iframe.contentDocument
  if (!doc?.body) return 'live'
  const current = () => pending.get(nodeKey) === mine && iframe.contentDocument === doc
  if (!hasEffects(doc)) {
    // nothing to compile: the pause alone is this frame's sleep
    if (!current()) return 'live'
    install(doc, [])
    asleep.set(nodeKey, k)
    return 'asleep'
  }
  const answer = await ask(key)
  if (!current()) return 'live'
  if (!answer.ok) return 'live'
  const targets = answer.targets.filter((t) => t.verified && t.texture)
  // decode every texture BEFORE the paint that installs them - one commit, no pop-in
  await Promise.all(targets.map((t) => { const im = new Image(); im.src = t.texture; return im.decode().catch(() => {}) }))
  if (!current()) return 'live'
  const applied = install(doc, targets)
  if (applied === null) return 'live'
  asleep.set(nodeKey, k)
  return 'asleep'
}

/** Wake: paint goes back to the live effects. The document is otherwise untouched. */
export function wake(nodeKey: string, iframe: HTMLIFrameElement | null): void {
  pending.delete(nodeKey)
  asleep.delete(nodeKey)
  const doc = iframe?.contentDocument
  if (!doc) return
  doc.getElementById(STYLE_ID)?.remove()
  doc.querySelectorAll('[data-mv-sleep]').forEach((el) => el.removeAttribute('data-mv-sleep'))
}

export function isAsleep(nodeKey: string): boolean { return asleep.has(nodeKey) }

/** Warm the compiler for keys the human is likely to need next (the other theme, the device widths):
 *  answers are cached on the server's disk; nothing is applied here. */
export function prefetch(keys: SleepKey[]): void { for (const key of keys) void ask(key).catch(() => {}) }

/** Install the override for the targets that match this document exactly. Returns how many did, or
 *  null when the document should stay live (targets were expected and none matched). */
function install(doc: Document, targets: Target[]): number | null {
  const rules: string[] = [PAUSE]
  let matched = 0
  for (const [i, t] of targets.entries()) {
    let el: Element | null = null
    try { el = doc.querySelector(t.sel) } catch { /* a selector from another document shape */ }
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (Math.abs(r.x - t.rect.x) > 0.02 || Math.abs(r.y - t.rect.y) > 0.02 || Math.abs(r.width - t.rect.w) > 0.02 || Math.abs(r.height - t.rect.h) > 0.02) continue
    const cs = doc.defaultView!.getComputedStyle(el)
    if ((cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || 'none') !== t.filter) continue
    el.setAttribute('data-mv-sleep', String(i))
    const img = cs.backgroundImage === 'none' ? '' : cs.backgroundImage + ','
    const color = cs.backgroundColor
    // the spec's composition: the filtered backdrop (the texture), then the element's own colour, then
    // its own images, then its content; the border box is the backdrop's clip
    rules.push(`[data-mv-sleep="${i}"]{backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important;` +
      `background-color:transparent!important;` +
      `background-image:${img}linear-gradient(${color},${color}),url("${t.texture}")!important;` +
      `background-size:${img ? cs.backgroundSize + ',' : ''}auto,100% 100%!important;` +
      `background-position:${img ? cs.backgroundPosition + ',' : ''}0 0,0 0!important;` +
      `background-repeat:${img ? cs.backgroundRepeat + ',' : ''}no-repeat,no-repeat!important;` +
      `background-origin:${img ? cs.backgroundOrigin + ',' : ''}border-box,border-box!important;` +
      `background-clip:${img ? cs.backgroundClip + ',' : ''}border-box,border-box!important}`)
    matched++
  }
  if (targets.length && !matched) return null
  let st = doc.getElementById(STYLE_ID)
  if (!st) { st = doc.createElement('style'); st.id = STYLE_ID; (doc.head ?? doc.documentElement).appendChild(st) }
  st.textContent = rules.join('\n')
  return matched
}

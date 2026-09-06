/**
 * Effect compilation - what lets a hi-fi frame SLEEP on the canvas (spec 16).
 *
 * A frame at rest is its own live document. What makes a glass design unrenderable at scale is not
 * layout or text but its effects: every `backdrop-filter` is a compositor render surface that reads
 * back what is behind it on every composited frame, and under a scaled canvas the tiles behind it
 * re-raster on every zoom step. At rest nothing behind a glass surface changes, so its filtered
 * backdrop is a constant - a texture. This module computes those textures with Chrome itself, so
 * the pixels are the compositor's own, and CERTIFIES each one before it ships:
 *
 *   1. render the frame headless at the node's width/height/theme (DPR 2) and settle it like the
 *      shot pipeline does, plus SVG images, running animations and a DOM-quiet window
 *   2. DETECT every element with a computed backdrop-filter; level overlapping elements (an element
 *      over an earlier one bakes one level later, so its backdrop contains the earlier one's result)
 *   3. a WARMED, STABLE reference: one hide-and-show cycle first (tiles under the targets then sit in
 *      the state every later capture is in), captured until two consecutive captures are identical
 *   4. per level: hide this level and above with opacity (a descendant can undo `visibility`), ONE
 *      screenshot, and one filter page that cuts every crop at integer device pixels, tiles it 3x3
 *      with mirrored copies (Chrome's backdrop blur reads only the element's own region and mirrors
 *      at its edges) and applies the element's own filter list by CSS; one screenshot of that page,
 *      sliced back into the textures at TEXTURE_DSF
 *   5. certification: apply everything, render, and diff the INSIDE of each element's rounded
 *      shape (eroded 3 device px - a composited edge and an inline edge differ by an AA halo) against
 *      the reference; then re-apply only what passed and certify THAT composition (a rejected
 *      neighbour changes a backdrop); then check that no element's box moved
 *
 * The override the shell will use is the one certified here: `backdrop-filter: blur(0px)` (the
 * element stays an effect layer whose surface Chrome caches and reads nothing back for - measured
 * better than `none` on identity and on frame drops) with the texture under the element's own
 * background layers. Nothing else on the element; layout is never touched.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Browser } from './cdp.ts'
import { pool, shotConcurrency, withBrowser } from './shot.ts'

export interface BakeTarget {
  sel: string
  rect: { x: number; y: number; w: number; h: number }
  filter: string
  level: number
  /** the texture: a data URL straight from the compiler, or the file's URL once cached */
  texture: string
  verified: boolean
  maxErr: number
  bad: number
}
export type BakeResult =
  | { ok: true; targets: BakeTarget[]; levels: number; rejected: number; ms: number }
  | { ok: false; error: string }

const DSF = 2
/** Texture device px per CSS px. Blur is scale-tolerant: 1x matches 2x on identity at 2x zoom
 *  (29 px > 8 of 5.18 M, none > 32) at a quarter of the memory; 0.5x fails on 30 px pills. */
const TEXTURE_DSF = 1
const DEADLINE_MS = 45_000

/** Runs INSIDE the frame document: the effect census and the paint-order levelling. Assigns
 *  data-mv-bake ids so later passes address elements without re-walking. */
const DETECT = `(() => {
  const sel = (el) => {
    const seg = []
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      if (cur.id) { seg.unshift('#' + CSS.escape(cur.id)); break }
      const tag = cur.tagName.toLowerCase()
      let n = 1
      for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === cur.tagName) n++
      seg.unshift(tag + ':nth-of-type(' + n + ')')
    }
    return seg.join('>')
  }
  const out = []
  let i = 0
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    const bf = cs.backdropFilter || cs.webkitBackdropFilter
    if (!bf || bf === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    el.setAttribute('data-mv-bake', String(i))
    out.push({ i: i++, sel: sel(el), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, filter: bf })
  }
  const level = new Array(out.length).fill(0)
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (let k = 0; k < out.length; k++) for (let j = 0; j < k; j++) if (hit(out[k].rect, out[j].rect)) level[k] = Math.max(level[k], level[j] + 1)
  return out.map((t, k) => ({ ...t, level: level[k] }))
})()`

/** Runs inside the frame document: hide the targets at or above \`level\` (opacity, the authored
 *  inline declaration remembered and restored exactly), show the rest, apply \`bakes\` as the
 *  override the shell will use. */
const APPLY = `((level, bakes) => {
  let st = document.getElementById('mv-bake-style')
  if (!st) { st = document.createElement('style'); st.id = 'mv-bake-style'; document.head.appendChild(st) }
  const rules = []
  for (const el of document.querySelectorAll('[data-mv-bake]')) {
    const i = el.getAttribute('data-mv-bake')
    const b = bakes.find((x) => String(x.i) === i)
    if (!b) continue
    const cs = getComputedStyle(el)
    const own = el.dataset.mvOwn ? JSON.parse(el.dataset.mvOwn) : null
    // the element's OWN background, read once before any override touches it
    const o = own || { img: cs.backgroundImage, color: cs.backgroundColor, size: cs.backgroundSize, pos: cs.backgroundPosition, rep: cs.backgroundRepeat, org: cs.backgroundOrigin, clip: cs.backgroundClip }
    if (!own) el.dataset.mvOwn = JSON.stringify(o)
    const img = o.img === 'none' ? '' : o.img + ','
    rules.push('[data-mv-bake="' + i + '"]{backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important;' +
      'background-color:transparent!important;' +
      'background-image:' + img + 'linear-gradient(' + o.color + ',' + o.color + '),url("' + b.texture + '")!important;' +
      'background-size:' + (img ? o.size + ',' : '') + 'auto,100% 100%!important;' +
      'background-position:' + (img ? o.pos + ',' : '') + '0 0,0 0!important;' +
      'background-repeat:' + (img ? o.rep + ',' : '') + 'no-repeat,no-repeat!important;' +
      'background-origin:' + (img ? o.org + ',' : '') + 'border-box,border-box!important;' +
      'background-clip:' + (img ? o.clip + ',' : '') + 'border-box,border-box!important}')
  }
  st.textContent = rules.join('\\n')
  for (const el of document.querySelectorAll('[data-mv-bake]')) {
    const i = Number(el.getAttribute('data-mv-bake'))
    const t = window.__mvBakeTargets.find((x) => x.i === i)
    if (t && t.level >= level) {
      if (!('mvOpacity' in el.dataset)) el.dataset.mvOpacity = JSON.stringify([el.style.getPropertyValue('opacity'), el.style.getPropertyPriority('opacity')])
      el.style.setProperty('opacity', '0', 'important')
    } else if ('mvOpacity' in el.dataset) {
      const [v, p] = JSON.parse(el.dataset.mvOpacity)
      if (v) el.style.setProperty('opacity', v, p); else el.style.removeProperty('opacity')
      delete el.dataset.mvOpacity
    }
  }
  return true
})`

/** Every element's box, for the geometry guard (a lost containing block would move a fixed child). */
const GEOMETRY = `Array.from(document.querySelectorAll('body *')).map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })`

const PAINTED = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`

/** The filter page: ONE screenshot of the level comes in; every element's crop is cut from it in-page
 *  at integer device pixels, tiled 3x3 with mirrored copies, filtered by CSS with the element's own
 *  filter list and clipped to its box - stacked so one screenshot yields every texture. */
function filterPage(full: string, items: { i: number; x: number; y: number; w: number; h: number; filter: string }[], dsf: number, tex: number): string {
  return `<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;background:transparent}.clip{overflow:hidden;position:absolute;left:0}canvas{position:absolute;display:block}</style></head><body>
<script>
const items = ${JSON.stringify(items)}, dsf = ${dsf}, tex = ${tex}
const img = new Image()
img.onload = () => {
  let top = 0
  for (const it of items) {
    const sx = Math.round(it.x * dsf), sy = Math.round(it.y * dsf), sw = Math.round(it.w * dsf), sh = Math.round(it.h * dsf)
    const cw = it.w, ch = it.h
    const tw = Math.max(1, Math.round(cw * tex)), th = Math.max(1, Math.round(ch * tex))
    const clip = document.createElement('div'); clip.className = 'clip'; clip.id = 'c' + it.i
    clip.style.top = top + 'px'; clip.style.width = cw + 'px'; clip.style.height = ch + 'px'
    clip.dataset.box = [Math.round(top * tex), tw, th].join(',')
    const c = document.createElement('canvas'); c.width = 3 * tw; c.height = 3 * th
    c.style.left = -cw + 'px'; c.style.top = -ch + 'px'; c.style.width = (3 * cw) + 'px'; c.style.height = (3 * ch) + 'px'; c.style.filter = it.filter
    const g = c.getContext('2d')
    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) {
      g.save(); g.translate(tx * tw, ty * th)
      const fx = tx === 1 ? 1 : -1, fy = ty === 1 ? 1 : -1
      g.translate(fx < 0 ? tw : 0, fy < 0 ? th : 0); g.scale(fx, fy)
      g.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th); g.restore()
    }
    clip.appendChild(c); document.body.appendChild(clip)
    top += Math.ceil(ch) + 8
  }
  document.body.style.height = top + 'px'
  window.__mvReady = true
}
img.src = ${JSON.stringify(full)}
</script></body></html>`
}

const SLICE = `((shot) => new Promise((res) => { const im = new Image(); im.onload = () => {
  const out = {}
  for (const clip of document.querySelectorAll('.clip')) {
    const [y, w, h] = clip.dataset.box.split(',').map(Number)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(im, 0, y, w, h, 0, 0, w, h)
    out[clip.id.slice(1)] = c.toDataURL('image/png')
  }
  res(out)
}; im.src = 'data:image/png;base64,' + shot }))`

/** Runs in the frame page: diff \`baked\` against \`reference\` inside each target's rounded shape. */
const CERTIFY = `((reference, baked, rects, width) => (async () => {
  const load = (d) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + d })
  const [ia, ib] = await Promise.all([load(reference), load(baked)])
  const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height } }
  const A = px(ia), B = px(ib), k = A.w / width, E = 3
  return rects.map((t) => {
    const x0 = Math.max(0, Math.floor(t.rect.x * k) + E), y0 = Math.max(0, Math.floor(t.rect.y * k) + E)
    const x1 = Math.min(A.w, Math.ceil((t.rect.x + t.rect.w) * k) - E), y1 = Math.min(A.h, Math.ceil((t.rect.y + t.rect.h) * k) - E)
    const el = document.querySelector(t.sel); const cs = el ? getComputedStyle(el) : null
    const rad = (v) => Math.max(0, Math.min(parseFloat(v) || 0, Math.min(t.rect.w, t.rect.h) / 2) * k - E)
    const R = cs ? [rad(cs.borderTopLeftRadius), rad(cs.borderTopRightRadius), rad(cs.borderBottomRightRadius), rad(cs.borderBottomLeftRadius)] : [0, 0, 0, 0]
    const inside = (x, y) => {
      const cx = [x0 + R[0], x1 - R[1], x1 - R[2], x0 + R[3]], cy = [y0 + R[0], y0 + R[1], y1 - R[2], y1 - R[3]]
      const c = x < x0 + R[0] && y < y0 + R[0] ? 0 : x >= x1 - R[1] && y < y0 + R[1] ? 1 : x >= x1 - R[2] && y >= y1 - R[2] ? 2 : x < x0 + R[3] && y >= y1 - R[3] ? 3 : -1
      if (c < 0) return true
      const dx = x + 0.5 - cx[c], dy = y + 0.5 - cy[c]
      return dx * dx + dy * dy <= R[c] * R[c]
    }
    let maxErr = 0, bad = 0, n = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!inside(x, y)) continue
      const i = (y * A.w + x) * 4
      const d = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i+1] - B.d[i+1]), Math.abs(A.d[i+2] - B.d[i+2]))
      if (d > maxErr) maxErr = d; if (d > 8) bad++; n++
    }
    return { maxErr, bad, n }
  })
})())`

const passes = (v: { maxErr: number; bad: number; n: number } | undefined): boolean =>
  !!v && v.n >= 64 && v.maxErr <= 32 && v.bad <= Math.max(v.n >= 2000 ? 4 : 0, v.n * 0.005)

/** Compile one frame inside a browser the caller owns. */
export async function bakeIn(b: Browser, opts: { url: string; width: number; height: number }): Promise<BakeResult> {
  const { url, width, height } = opts
  const t0 = Date.now()
  const me = {}
  let targetId: string | undefined
  const deadline = setTimeout(() => b.abort(me, 'the bake timed out'), DEADLINE_MS)
  try {
    targetId = (await b.send('Target.createTarget', { url: 'about:blank' }, undefined, me)).targetId
    const sessionId = (await b.send('Target.attachToTarget', { targetId, flatten: true }, undefined, me)).sessionId as string
    const send = (m: string, p: Record<string, unknown> = {}, sid: string | undefined = sessionId) => b.send(m, p, sid, me)
    const ev = async (expression: string, awaitPromise = false) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })).result?.value
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const capture = async () => (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } })).data as string

    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: DSF, mobile: false })
    await send('Page.enable'); await send('Runtime.enable')
    const nav = await send('Page.navigate', { url })
    if (nav?.errorText && nav.errorText !== 'net::ERR_ABORTED') return { ok: false, error: `could not load the frame (${nav.errorText})` }
    // settle: readiness, fonts, in-view images + the frame's own async signals, SVG images, animations, quiet
    const readyBy = Date.now() + 30_000
    while (Date.now() < readyBy) {
      if (await ev(`(() => { const el = document.getElementById('root') ?? document.body; return !!el && el.childElementCount > 0 && document.readyState !== 'loading' })()`)) break
      await wait(100)
    }
    await ev(`document.fonts.ready.then(() => true)`, true)
    await ev(`new Promise((r) => { const t = Date.now(); const tick = () => {
      const H = innerHeight, W = innerWidth
      let pending = 0
      if (typeof window.__mvLodBusy === 'function' && window.__mvLodBusy() > 0) pending++
      if (typeof window.__mvPosterBusy === 'function' && window.__mvPosterBusy() > 0) pending++
      for (const im of document.images) { if (im.complete) continue; const b = im.getBoundingClientRect(); if (b.bottom < 0 || b.top > H || b.right < 0 || b.left > W) continue; pending++ }
      for (const c of document.querySelectorAll('.mv-chart')) if (!c.querySelector('svg, canvas')) pending++
      for (const d of document.querySelectorAll('.mv-diagram')) if (!d.querySelector('.mv-diagram-svg svg, .mv-diagram-err')) pending++
      if (!pending || Date.now() - t > 6000) r(true); else setTimeout(tick, 60) }; tick() })`, true)
    await ev(`Promise.all(Array.from(document.querySelectorAll('image')).map((el) => { const href = el.getAttribute('href') || el.getAttribute('xlink:href'); if (!href) return 1; const im = new Image(); im.src = new URL(href, location.href).href; return im.decode().catch(() => 1) })).then(() => true)`, true)
    await ev(`Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => 1))), new Promise((r) => setTimeout(r, 5000))]).then(() => true)`, true)
    await ev(`new Promise((resolve) => { let timer = 0; const done = () => { mo.disconnect(); resolve(true) }; const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 250) }); mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); timer = setTimeout(done, 250); setTimeout(done, 3000) })`, true)
    await ev(PAINTED, true)
    const err = await ev(`window.__mvFrameError || ''`)
    if (err) return { ok: false, error: `the frame rendered an error - ${err}` }

    const targets = (await ev(`(window.__mvBakeTargets = ${DETECT})`)) as { i: number; sel: string; rect: BakeTarget['rect']; filter: string; level: number }[]
    if (!targets?.length) return { ok: true, targets: [], levels: 0, rejected: 0, ms: Date.now() - t0 }
    const levels = Math.max(...targets.map((t) => t.level)) + 1
    const geometryBefore = (await ev(GEOMETRY)) as number[][]

    // the reference: warmed (one hide-and-show cycle) and stable (two identical consecutive captures)
    await ev(`${APPLY}(0, [])`); await ev(PAINTED, true)
    await ev(`${APPLY}(${levels}, [])`); await ev(PAINTED, true)
    await wait(300)
    let reference = await capture(), stable = false
    for (let i = 0; i < 8; i++) { await wait(400); const again = await capture(); if (again === reference) { stable = true; break }; reference = again }
    if (!stable) return { ok: false, error: 'the frame never stopped changing - nothing to certify against' }

    const bakes: { i: number; texture: string }[] = []
    const done = new Map<number, BakeTarget>()
    for (let level = 0; level < levels; level++) {
      await ev(`${APPLY}(${level}, ${JSON.stringify(bakes)})`); await ev(PAINTED, true)
      const mine = targets.filter((t) => t.level === level)
      const full = await capture()
      const items = mine.map((t) => ({ i: t.i, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, filter: t.filter }))
      const { targetId: ft } = await b.send('Target.createTarget', { url: 'about:blank' }, undefined, me)
      const { sessionId: fs } = await b.send('Target.attachToTarget', { targetId: ft, flatten: true }, undefined, me)
      try {
        const totalH = items.reduce((a, c) => a + Math.ceil(c.h) + 9, 0)
        await b.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(Math.max(...items.map((c) => c.w))), height: Math.min(16_000, totalH), deviceScaleFactor: TEXTURE_DSF, mobile: false }, fs, me)
        await b.send('Page.enable', {}, fs, me)
        const { frameTree } = await b.send('Page.getFrameTree', {}, fs, me)
        await b.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: filterPage(`data:image/png;base64,${full}`, items, DSF, TEXTURE_DSF) }, fs, me)
        await b.send('Runtime.evaluate', { expression: `new Promise((r) => { const t = () => window.__mvReady ? requestAnimationFrame(() => requestAnimationFrame(() => r(true))) : setTimeout(t, 20); t() })`, awaitPromise: true, returnByValue: true }, fs, me)
        const fshot = (await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, fs, me)).data as string
        const textures = (await b.send('Runtime.evaluate', { expression: `${SLICE}(${JSON.stringify(fshot)})`, awaitPromise: true, returnByValue: true }, fs, me)).result.value as Record<string, string>
        for (const t of mine) {
          const texture = textures[String(t.i)]
          if (!texture) continue
          bakes.push({ i: t.i, texture })
          done.set(t.i, { sel: t.sel, rect: t.rect, filter: t.filter, level, texture, verified: false, maxErr: 255, bad: -1 })
        }
      } finally {
        await b.send('Target.closeTarget', { targetId: ft }).catch(() => {})
      }
    }

    // certification, twice: every candidate, then the composition that actually passed
    const certify = async (set: { i: number; texture: string }[]) => {
      await ev(`${APPLY}(${levels}, ${JSON.stringify(set)})`); await ev(PAINTED, true)
      const baked = await capture()
      const rects = set.map((s) => done.get(s.i)!).map((t) => ({ sel: t.sel, rect: t.rect }))
      return (await ev(`${CERTIFY}(${JSON.stringify(reference)}, ${JSON.stringify(baked)}, ${JSON.stringify(rects)}, ${width})`, true)) as { maxErr: number; bad: number; n: number }[]
    }
    let set = bakes
    let verdicts = await certify(set)
    set.forEach((s, k) => { const t = done.get(s.i)!; t.verified = passes(verdicts[k]); t.maxErr = verdicts[k]?.maxErr ?? 255; t.bad = verdicts[k]?.bad ?? -1 })
    if (set.some((s) => !done.get(s.i)!.verified)) {
      set = set.filter((s) => done.get(s.i)!.verified)
      if (set.length) {
        verdicts = await certify(set)
        set.forEach((s, k) => { const t = done.get(s.i)!; t.verified = passes(verdicts[k]); t.maxErr = verdicts[k]?.maxErr ?? 255; t.bad = verdicts[k]?.bad ?? -1 })
      }
    }
    // the geometry guard: the shipped override must not move any box (a lost containing block would)
    const geometryAfter = (await ev(GEOMETRY)) as number[][]
    const moved = geometryBefore.length !== geometryAfter.length || geometryBefore.some((r, k) => r.some((v, j) => Math.abs(v - geometryAfter[k][j]) > 0.01))
    if (moved) for (const t of done.values()) t.verified = false

    const out = [...done.values()]
    return { ok: true, targets: out, levels, rejected: out.filter((t) => !t.verified).length, ms: Date.now() - t0 }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    clearTimeout(deadline)
    if (targetId && !b.dead) {
      let t: ReturnType<typeof setTimeout> | undefined
      await Promise.race([b.send('Target.closeTarget', { targetId }, undefined, me).catch(() => {}), new Promise((r) => { t = setTimeout(r, 2000) })])
      clearTimeout(t)
    }
    b.abort(me, 'the bake finished')
  }
}

// ---- the cache and the batch --------------------------------------------------------------------

export interface BakeAsk { frame: string; theme: string; w: number; h: number }
export type BakeAnswer = { frame: string; theme: string; w: number; h: number } & BakeResult

/** Where a compiled frame lives on disk: design/.local/bakes/<generation>/<key>/. The generation
 *  is the dev server's source generation (bumped on any watched change), so a stale bake can never
 *  be served after an edit; older generations are removed as new ones appear. */
export function bakeKey(ask: BakeAsk): string {
  return createHash('sha1').update(`${ask.frame}|${ask.theme}|${Math.round(ask.w)}|${Math.round(ask.h)}`).digest('hex').slice(0, 16)
}

function cacheDir(root: string, gen: number, key: string): string { return join(root, 'design', '.local', 'bakes', String(gen), key) }

function readCached(root: string, gen: number, ask: BakeAsk, urlBase: string): BakeAnswer | null {
  const key = bakeKey(ask)
  const dir = cacheDir(root, gen, key)
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'bake.json'), 'utf8')) as { targets: BakeTarget[]; levels: number; rejected: number; ms: number }
    return { ...ask, ok: true, targets: meta.targets.map((t) => ({ ...t, texture: t.verified ? `${urlBase}/${gen}/${key}/${t.texture}` : '' })), levels: meta.levels, rejected: meta.rejected, ms: 0 }
  } catch { return null }
}

function writeCached(root: string, gen: number, ask: BakeAsk, r: Extract<BakeResult, { ok: true }>, urlBase: string): BakeAnswer {
  const key = bakeKey(ask)
  const dir = cacheDir(root, gen, key)
  const tmp = `${dir}.tmp-${process.pid}`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const targets = r.targets.map((t, i) => {
    if (!t.verified) return { ...t, texture: '' }
    const name = `${i}.png`
    writeFileSync(join(tmp, name), Buffer.from(t.texture.slice(t.texture.indexOf(',') + 1), 'base64'))
    return { ...t, texture: name }
  })
  writeFileSync(join(tmp, 'bake.json'), JSON.stringify({ targets, levels: r.levels, rejected: r.rejected, ms: r.ms }))
  rmSync(dir, { recursive: true, force: true })
  try { renameSync(tmp, dir) } catch { rmSync(tmp, { recursive: true, force: true }) }
  return { ...ask, ok: true, targets: targets.map((t) => ({ ...t, texture: t.verified ? `${urlBase}/${gen}/${key}/${t.texture}` : '' })), levels: r.levels, rejected: r.rejected, ms: r.ms }
}

/** Drop every generation but the current one (called when the generation bumps). */
export function pruneBakes(root: string, keep: number): void {
  const base = join(root, 'design', '.local', 'bakes')
  if (!existsSync(base)) return
  try {
    for (const name of readdirSync(base)) {
      if (name !== String(keep)) rmSync(join(base, name), { recursive: true, force: true })
    }
  } catch { /* best-effort */ }
}

/** Compile many frames as ONE operation (one browser, `shotConcurrency()` at a time), the cache
 *  first. `urlFor(ask)` gives the frame's own URL; `urlBase` is where textures are served from. */
export async function bakeBatch(opts: { root: string; gen: number; asks: BakeAsk[]; urlFor: (ask: BakeAsk) => string; urlBase: string }): Promise<BakeAnswer[]> {
  const { root, gen, asks, urlFor, urlBase } = opts
  const answers: (BakeAnswer | null)[] = asks.map((ask) => readCached(root, gen, ask, urlBase))
  const misses = asks.map((ask, i) => ({ ask, i })).filter(({ i }) => !answers[i])
  if (misses.length) {
    const fresh = await withBrowser('shot', (b) => pool(shotConcurrency(), misses, async ({ ask }) => {
      const r = await bakeIn(b, { url: urlFor(ask), width: Math.round(ask.w), height: Math.round(ask.h) }).catch((e) => ({ ok: false as const, error: (e as Error).message }))
      return r.ok ? writeCached(root, gen, ask, r, urlBase) : { ...ask, ...r }
    }))
    misses.forEach(({ i }, k) => { answers[i] = fresh[k] })
  }
  return answers as BakeAnswer[]
}

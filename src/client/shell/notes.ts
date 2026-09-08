/**
 * Sticky notes (spec 18): the pure half. Widths the layout reserves, which node hosts a
 * scene's note, the per-viewer hide state, and the comment anchor a note builds and resolves
 * in the shell (a note is shell DOM - inspect.js never sees it, so the shell plays its part).
 * No React, no store import: unit tests read this straight.
 */
import { create } from 'zustand'

/** World px. A frame note is a column beside one frame; a scene note is wider, an intro. */
export const NOTE_W = 260
export const SCENE_NOTE_W = 380
/** The gutter between a note and its frame (the variant badge lives in the same gutter). */
export const NOTE_GAP = 24
/** Pin and card tint for anchors on a note - the paper's own hue. */
export const NOTE_HUE = 48

export type NoteKind = 'frame' | 'scene'
export const noteId = (kind: NoteKind, name: string): string => `${kind}:${name}`

/** The width tidy reserves in front of a node: its own note, and the scene note when this node
 *  hosts it - one column, so the wider of the two, never the sum. */
export function noteReserve(frameNote: boolean, sceneNote: boolean): number {
  const w = Math.max(frameNote ? NOTE_W : 0, sceneNote ? SCENE_NOTE_W : 0)
  return w ? w + NOTE_GAP : 0
}

/** The node that shows a scene's note: the scene's first node on the board in reading order -
 *  smallest y, then x, then original index (the deck rule), missing nodes skipped. Null when the
 *  scene has no node here. */
export function sceneNoteHost(
  nodes: readonly { key: string; frame: string; x: number; y: number; missing?: boolean }[],
  sceneOf: (frame: string) => string | undefined,
  scene: string,
): string | null {
  let best: { key: string; x: number; y: number; i: number } | null = null
  nodes.forEach((n, i) => {
    if (n.missing || sceneOf(n.frame) !== scene) return
    if (!best || n.y < best.y || (n.y === best.y && (n.x < best.x || (n.x === best.x && i < best.i)))) best = { key: n.key, x: n.x, y: n.y, i }
  })
  return best ? (best as { key: string }).key : null
}

/** The node header the canvas draws above a frame body (FrameNode's HEADER) - a node's card is
 *  `h + NODE_HEADER` tall, and that is the height a note beside it has to clear. */
export const NODE_HEADER = 28

/** True when a note has no room: another node's card stands inside the reserve in front of a
 *  noted node (its own note, or the scene's note it hosts). Room is the layout's job, never the
 *  author's - a board the shell composes re-applies its layout when this is true, so a note file
 *  can land on a saved board and the frames make way. Missing nodes (a deleted frame's card, still
 *  drawn full size) block room but never host a note. */
export function notesCramped(
  nodes: readonly { key: string; frame: string; x: number; y: number; w: number; h: number; missing?: boolean }[],
  manifest: { frames: { id: string; scene: string; note?: string }[]; scenes: { name: string; note?: string }[] } | null,
): boolean {
  if (!manifest) return false
  const entry = (id: string) => manifest.frames.find((f) => f.id === id)
  const live = nodes.filter((n) => !n.missing)
  const hosts = new Set<string>()
  for (const s of manifest.scenes) {
    if (!s.note) continue
    const h = sceneNoteHost(live, (id) => entry(id)?.scene, s.name)
    if (h) hosts.add(h)
  }
  return live.some((n) => {
    const r = noteReserve(!!entry(n.frame)?.note, hosts.has(n.key))
    if (!r) return false
    const x0 = n.x - r, y1 = n.y + n.h + NODE_HEADER
    return nodes.some((o) => o !== n && o.x < n.x && o.x + o.w > x0 && o.y < y1 && o.y + o.h + NODE_HEADER > n.y)
  })
}

// ---- per-viewer visibility -------------------------------------------------------------

const STORAGE = 'mv-notes'
interface NotesState {
  /** the N toggle: false hides every note on the canvas */
  all: boolean
  /** note ids folded by their own corner */
  hidden: string[]
  /** fold or unfold one column (its ids together) */
  toggle(ids: string[]): void
  /** N: any note visible -> hide all; none -> show all (and unfold every column) */
  toggleAll(anyVisible: boolean): void
}
const load = (): { all: boolean; hidden: string[] } => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null')
    if (raw && typeof raw === 'object') return { all: raw.all !== false, hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((x: unknown) => typeof x === 'string') : [] }
  } catch { /* storage unavailable or junk: shown by default */ }
  return { all: true, hidden: [] }
}
const save = (s: { all: boolean; hidden: string[] }) => { try { localStorage.setItem(STORAGE, JSON.stringify(s)) } catch { /* private mode */ } }

export const useNotes = create<NotesState>((set, get) => ({
  ...load(),
  toggle(ids) {
    const { all, hidden } = get()
    const off = !all || ids.some((id) => hidden.includes(id))
    // unfolding a column while N hid everything shows that column alone: N flips back on and
    // every OTHER column is folded, so the one asked for is the one that appears
    const next = off
      ? { all: true, hidden: all ? hidden.filter((id) => !ids.includes(id)) : [...new Set([...allIds(), ...hidden].filter((id) => !ids.includes(id)))] }
      : { all, hidden: [...new Set([...hidden, ...ids])] }
    set(next); save(next)
  },
  toggleAll(anyVisible) {
    const next = anyVisible ? { all: false, hidden: get().hidden } : { all: true, hidden: [] }
    set(next); save(next)
  },
}))
/** Every note id currently on the canvas - read from the DOM, the one place that knows. */
const allIds = (): string[] => (typeof document === 'undefined' ? [] : [...document.querySelectorAll('[data-note]')].map((el) => el.getAttribute('data-note')!))

export const noteVisible = (s: { all: boolean; hidden: string[] }, ids: string[]): boolean => s.all && !ids.some((id) => s.hidden.includes(id))

// ---- comment anchors on a note ------------------------------------------------------------

/** The same bundle inspect.js posts for a frame element, plus `note` so the shell resolves it
 *  itself. `rect` and `pos` are in node-body coordinates (the CommentLayer's), so a pin on a note
 *  sits at a negative x - left of the frame. */
export interface NoteAnchor {
  el: { semantics: { tag: string; quote?: string }; cssPath: string; note: NoteKind; hue: number }
  pos: { fx: number; fy: number }
  rect: { x: number; y: number; w: number; h: number }
}

/** An nth-of-type chain from the sticky body to the element - stable across re-renders of the
 *  same markdown, honest when it changes (the quote fallback then decides). */
export function cssPathWithin(el: Element, root: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== root) {
    const tag = cur.tagName.toLowerCase()
    const parent: Element | null = cur.parentElement
    if (!parent) break
    const same = [...parent.children].filter((c) => c.tagName === cur!.tagName)
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag)
    cur = parent
  }
  return parts.join(' > ')
}

const quoteOf = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ')

/** Build the anchor for a click at (clientX, clientY) on `el` inside a sticky whose body is
 *  `root`; `toBody` maps a screen rect to node-body coordinates. */
export function noteAnchor(el: Element, root: Element, kind: NoteKind, at: { clientX: number; clientY: number }, toBody: (r: DOMRect) => { x: number; y: number; w: number; h: number }): NoteAnchor {
  const r = el.getBoundingClientRect()
  const quote = quoteOf(el).slice(0, 200)
  return {
    el: { semantics: { tag: el.tagName.toLowerCase(), ...(quote ? { quote } : {}) }, cssPath: cssPathWithin(el, root), note: kind, hue: NOTE_HUE },
    pos: {
      fx: r.width ? Math.min(1, Math.max(0, (at.clientX - r.left) / r.width)) : .5,
      fy: r.height ? Math.min(1, Math.max(0, (at.clientY - r.top) / r.height)) : .5,
    },
    rect: toBody(r),
  }
}

/** inspect.js's resolve, for a note: the path when it still matches, else tag + quote. */
export function resolveNoteAnchor(anchor: unknown, root: Element): Element | null {
  const a = anchor as Partial<NoteAnchor> | null
  const want = a?.el?.semantics ?? { tag: '' }
  const match = (el: Element) => {
    if (want.tag && el.tagName.toLowerCase() !== want.tag) return false
    if (want.quote) { const t = quoteOf(el); if (!(t.startsWith(want.quote.slice(0, 60)) || t.includes(want.quote.slice(0, 40)))) return false }
    return true
  }
  try {
    const byPath = a?.el?.cssPath ? root.querySelector(a.el.cssPath) : null
    if (byPath && match(byPath)) return byPath
  } catch { /* stale selector */ }
  if (want.quote && /^[a-z][a-z0-9-]*$/.test(want.tag)) for (const el of root.querySelectorAll(want.tag)) if (match(el)) return el
  return null
}

export const isNoteAnchor = (anchor: unknown): anchor is NoteAnchor => {
  const n = (anchor as any)?.el?.note
  return n === 'frame' || n === 'scene'
}

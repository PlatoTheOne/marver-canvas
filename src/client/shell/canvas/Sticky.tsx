/**
 * Sticky notes (spec 18): the yellow column left of a frame - the scene's note (when this node
 * hosts it) above the frame's own. Shell DOM, never inside the iframe: sleep, bakes and the frame
 * document are untouched. Markdown through the content package's renderer (the Md block's link
 * and image policy, raw HTML inert); a ```mermaid fence renders hand-drawn on demand.
 *
 * Fold: the dog-ear at the column's top-right corner folds the whole column down to that corner
 * (scale + fade toward it); the corner stays as the tab that unfolds it. Per viewer, in
 * localStorage - never in the board file.
 *
 * Comments: in comment mode a click on a note element stages a draft on the node, anchored like
 * a frame element (notes.ts builds the bundle; the CommentLayer resolves it here in the shell).
 * Links: `goto:` navigates through the one goto path; in comment mode a click picks, never
 * navigates (the bridge rule).
 */
import { memo, useEffect, useMemo, useRef } from 'react'
import { renderMarkdown, sanitizeMarkdownHtml } from '../../content/md.ts'
import { cleanSource, guardDiagramSource, sanitizeSvg } from '../../content/diagram.tsx'
import { useComments } from '../comments-store.ts'
import { goTo } from '../goto.ts'
import { NOTE_W, SCENE_NOTE_W, noteAnchor, noteVisible, useNotes, type NoteKind } from '../notes.ts'

export interface NoteSpec { kind: NoteKind; id: string; text: string }

/** Diagram text only: the sketched look is the diagram's, prose stays in the shell font. */
const HAND_FONT = `"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", "Comic Neue", cursive`
/** Yellow paper for the hand-drawn look - the same values the sheet paints the sticky with. */
const PAPER = { bg: '#fff3a3', ink: '#2b2500', line: '#6b5a00', soft: '#ffe680', pale: '#fffbdc' }
const THEME_VARS = {
  background: PAPER.bg, fontFamily: HAND_FONT, fontSize: '17px',
  primaryColor: PAPER.soft, primaryTextColor: PAPER.ink, primaryBorderColor: PAPER.line,
  secondaryColor: PAPER.pale, secondaryTextColor: PAPER.ink, secondaryBorderColor: PAPER.line,
  tertiaryColor: PAPER.pale, tertiaryTextColor: PAPER.ink, tertiaryBorderColor: PAPER.line,
  lineColor: PAPER.line, textColor: PAPER.ink, mainBkg: PAPER.soft, nodeBorder: PAPER.line,
  clusterBkg: PAPER.pale, clusterBorder: PAPER.line, titleColor: PAPER.ink,
  edgeLabelBackground: PAPER.bg, noteBkgColor: PAPER.soft, noteTextColor: PAPER.ink, noteBorderColor: PAPER.line,
  actorBkg: PAPER.soft, actorBorder: PAPER.line, actorTextColor: PAPER.ink, signalColor: PAPER.line, signalTextColor: PAPER.ink,
  labelBoxBkgColor: PAPER.pale, labelBoxBorderColor: PAPER.line, labelTextColor: PAPER.ink, loopTextColor: PAPER.ink,
  activationBkgColor: PAPER.pale, activationBorderColor: PAPER.line, sequenceNumberColor: PAPER.ink,
  pie1: PAPER.soft, pie2: PAPER.pale, pie3: '#f3d96a', pie4: '#e9c94f', pieTitleTextColor: PAPER.ink, pieSectionTextColor: PAPER.ink, pieLegendTextColor: PAPER.ink, pieStrokeColor: PAPER.line,
}
let diagramSeq = 0

/** Render every ```mermaid fence in a sticky body: hand-drawn, strict, sanitized. The pre stays
 *  mounted through an error (the message replaces the code), so a healed edit heals in place. */
async function renderDiagrams(body: HTMLElement, alive: () => boolean) {
  const fences = [...body.querySelectorAll('pre > code.language-mermaid')] as HTMLElement[]
  if (!fences.length) return
  const mermaid = (await import('mermaid')).default
  if (!alive()) return
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'handDrawn', themeVariables: THEME_VARS, fontFamily: HAND_FONT,
    // legible at sticky size. Flowcharts get rough.js boxes and HTML labels; every other type
    // draws plain SVG text in a handwriting face that has no bold - so SVG text is inked with a
    // thin stroke (paint-order keeps the fill on top), lines and boxes are darker and thicker.
    themeCSS: [
      `.nodeLabel, .edgeLabel, .label { font-weight: 700 !important; letter-spacing: .01em }`,
      `text, tspan { font-weight: 700 !important; fill: ${PAPER.ink}; stroke: ${PAPER.ink}; stroke-width: .45px; paint-order: stroke fill; letter-spacing: .01em }`,
      `.edgePath path, .flowchart-link { stroke-width: 2px } .node path, .node rect { stroke-width: 1.6px }`,
      // sequence: actor boxes, lifelines, messages and arrowheads in the paper's ink
      `.actor { stroke: ${PAPER.line}; stroke-width: 1.6px; fill: ${PAPER.soft} } .actor-line { stroke: ${PAPER.line} !important; stroke-width: 1.4px !important }`,
      `.messageLine0, .messageLine1 { stroke: ${PAPER.ink} !important; stroke-width: 1.8px !important } #arrowhead path, .arrowheadPath { fill: ${PAPER.ink} !important; stroke: ${PAPER.ink} !important }`,
      `.messageText, .actor > tspan, text.actor { fill: ${PAPER.ink} !important }`,
      `.loopLine { stroke: ${PAPER.line} !important } .labelBox, .loopText, .note { stroke: ${PAPER.line} }`,
      // state / class / er: the same ink
      `.statediagram-state rect, .classGroup rect, .er.entityBox { stroke: ${PAPER.line}; stroke-width: 1.6px; fill: ${PAPER.soft} } .transition, .relation, .er.relationshipLine { stroke: ${PAPER.ink} !important; stroke-width: 1.8px !important }`,
    ].join(' '),
    flowchart: { padding: 10, nodeSpacing: 32, rankSpacing: 36 },
    // one actor row (the mirrored bottom row is noise at note size), roomier boxes, bigger text
    sequence: { mirrorActors: false, actorFontSize: 18, actorFontWeight: 700, messageFontSize: 17, messageFontWeight: 700, noteFontSize: 16, width: 96, height: 50, actorMargin: 26, boxMargin: 8, messageMargin: 30, diagramMarginX: 6, diagramMarginY: 6, wrap: true, bottomMarginAdj: 4 },
  })
  for (const code of fences) {
    const pre = code.parentElement!
    const src = cleanSource(code.textContent ?? '')   // front matter and %%{init}%% directives never reach mermaid (the Diagram rule)
    const host = document.createElement('div')
    host.className = 'sh-sticky-diagram'
    try {
      guardDiagramSource(src)   // the zero-external-request boundary (the Diagram block's)
      const { svg } = await mermaid.render(`sh-note-d${++diagramSeq}`, src)
      if (!alive()) return
      host.innerHTML = sanitizeSvg(svg)
      pre.replaceWith(host)
    } catch (e) {
      if (!alive()) return
      pre.classList.add('err')
      code.textContent = `diagram: ${String((e as Error)?.message ?? e).split('\n')[0]}`
    }
  }
}

function StickyBody({ text, kind, nodeKey, frameId }: { text: string; kind: NoteKind; nodeKey: string; frameId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => sanitizeMarkdownHtml(renderMarkdown(text)), [text])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    el.innerHTML = html
    void renderDiagrams(el, () => live && ref.current === el)
    return () => { live = false }
  }, [html])

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const root = ref.current
    const target = e.target instanceof Element ? e.target : null
    if (!root || !target) return
    const c = useComments.getState()
    if (c.commentMode) {
      // comment mode owns every click: pick the element, exactly like a frame pick
      e.preventDefault(); e.stopPropagation()
      // the picked element is the innermost element under the pointer; a click in the body's
      // own padding picks the first block instead of the whole note
      const pick = target === root ? root.firstElementChild : target
      if (!pick) return
      const nodeEl = root.closest('.sh-node') as HTMLElement | null
      const bodyEl = nodeEl?.querySelector('.cm-layer') as HTMLElement | null
      if (!nodeEl || !bodyEl) return
      const origin = bodyEl.getBoundingClientRect()
      const s = origin.width ? origin.width / nodeEl.offsetWidth : 1     // on-screen px per world px
      const toBody = (r: DOMRect) => ({ x: (r.left - origin.left) / s, y: (r.top - origin.top) / s, w: r.width / s, h: r.height / s })
      if (c.active) c.setActive(null)
      c.setDraft({ nodeKey, frame: frameId, anchor: noteAnchor(pick, root, kind, e, toBody) })
      return
    }
    const link = target.closest('a[data-goto]')
    if (link) { e.preventDefault(); e.stopPropagation(); goTo(link.getAttribute('data-goto') ?? '') }
  }
  return <div ref={ref} className="sh-sticky-body" onClick={onClick} />
}

/** The column for one node. `underBadge`: a variant badge owns the top of the gutter. */
export const Stickies = memo(function Stickies({ nodeKey, frameId, notes, underBadge }: { nodeKey: string; frameId: string; notes: NoteSpec[]; underBadge: boolean }) {
  const ids = notes.map((n) => n.id)
  const on = useNotes((s) => noteVisible(s, ids))
  if (!notes.length) return null
  const width = Math.max(...notes.map((n) => (n.kind === 'scene' ? SCENE_NOTE_W : NOTE_W)))
  return (
    <div className={`sh-notes${on ? '' : ' off'}${underBadge ? ' below-vbadge' : ''}`} data-node-notes={nodeKey} style={{ width }}>
      <button className="sh-notes-fold sh-no-pan" type="button" aria-label={on ? 'hide notes' : 'show notes'} title={on ? 'hide notes (N: all)' : 'show notes (N: all)'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); useNotes.getState().toggle(ids) }} />
      {notes.map((n) => (
        <div key={n.id} className="sh-sticky sh-no-pan" data-sticky={n.kind} data-note={n.id} style={{ width: n.kind === 'scene' ? SCENE_NOTE_W : NOTE_W }}
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <StickyBody text={n.text} kind={n.kind} nodeKey={nodeKey} frameId={frameId} />
        </div>
      ))}
    </div>
  )
})

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
const PAPER = { bg: '#fff3a3', ink: '#2b2500', line: '#6b5a00', soft: '#ffe680', pale: '#fffbdc', hatch: '#f0cc4e' }
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
  pie1: PAPER.soft, pie2: PAPER.pale, pie3: '#f3d96a', pie4: '#e9c94f', pie5: '#fff0b8', pie6: '#e0c04a', pieTitleTextColor: PAPER.ink, pieSectionTextColor: PAPER.ink, pieLegendTextColor: PAPER.ink, pieStrokeColor: PAPER.line, pieOuterStrokeColor: PAPER.line,
  // every family that would otherwise bring its own rainbow: gantt sections, journey fills,
  // git branches, the cScale mindmap and timeline use - all the paper's yellows, ink for text
  sectionBkgColor: PAPER.pale, altSectionBkgColor: PAPER.bg, sectionBkgColor2: PAPER.soft,
  taskBkgColor: PAPER.soft, taskBorderColor: PAPER.line, taskTextColor: PAPER.ink, taskTextLightColor: PAPER.ink, taskTextOutsideColor: PAPER.ink, taskTextDarkColor: PAPER.ink,
  activeTaskBkgColor: '#f3d96a', activeTaskBorderColor: PAPER.line, doneTaskBkgColor: PAPER.pale, doneTaskBorderColor: PAPER.line,
  critBkgColor: '#e9c94f', critBorderColor: PAPER.ink, gridColor: PAPER.line, todayLineColor: PAPER.ink,
  fillType0: PAPER.soft, fillType1: PAPER.pale, fillType2: '#f3d96a', fillType3: PAPER.soft, fillType4: PAPER.pale, fillType5: '#f3d96a', fillType6: PAPER.soft, fillType7: PAPER.pale,
  git0: '#e9c94f', git1: '#f3d96a', git2: PAPER.soft, git3: '#e0c04a', git4: PAPER.pale, git5: '#e9c94f', git6: '#f3d96a', git7: PAPER.soft,
  gitBranchLabel0: PAPER.ink, gitBranchLabel1: PAPER.ink, gitBranchLabel2: PAPER.ink, gitBranchLabel3: PAPER.ink, gitBranchLabel4: PAPER.ink, gitBranchLabel5: PAPER.ink, gitBranchLabel6: PAPER.ink, gitBranchLabel7: PAPER.ink,
  gitInv0: PAPER.ink, gitInv1: PAPER.ink, gitInv2: PAPER.ink, gitInv3: PAPER.ink, gitInv4: PAPER.ink, gitInv5: PAPER.ink, gitInv6: PAPER.ink, gitInv7: PAPER.ink,
  commitLabelColor: PAPER.ink, commitLabelBackground: PAPER.bg, tagLabelColor: PAPER.ink, tagLabelBackground: PAPER.soft, tagLabelBorder: PAPER.line,
  ...Object.fromEntries([...Array(12)].flatMap((_, i) => [[`cScale${i}`, [PAPER.soft, '#f3d96a', PAPER.pale, '#e9c94f'][i % 4]], [`cScaleLabel${i}`, PAPER.ink], [`cScalePeer${i}`, PAPER.line]])),
  quadrant1Fill: PAPER.soft, quadrant2Fill: PAPER.pale, quadrant3Fill: PAPER.pale, quadrant4Fill: PAPER.soft,
  quadrant1TextFill: PAPER.ink, quadrant2TextFill: PAPER.ink, quadrant3TextFill: PAPER.ink, quadrant4TextFill: PAPER.ink,
  quadrantPointFill: PAPER.ink, quadrantPointTextFill: PAPER.ink, quadrantXAxisTextFill: PAPER.ink, quadrantYAxisTextFill: PAPER.ink,
  quadrantInternalBorderStrokeFill: PAPER.line, quadrantExternalBorderStrokeFill: PAPER.line, quadrantTitleFill: PAPER.ink,
  attributeBackgroundColorOdd: PAPER.pale, attributeBackgroundColorEven: PAPER.bg,
}
let diagramSeq = 0

/** A sticky is one colour of paper. Whatever a diagram family brings that the theme variables
 *  did not reach (journey actor dots, ER marker circles, a white attribute row, block fills) is
 *  mapped onto the palette AFTER render, by computed colour: white and light fills become paper,
 *  dark fills become ink, strokes likewise. Text is never touched (its fill is set above). */
const PALETTE = new Set([PAPER.bg, PAPER.ink, PAPER.line, PAPER.soft, PAPER.pale, PAPER.hatch, '#f3d96a', '#e9c94f', '#e0c04a', '#fff0b8', '#a88f2a'].map((c) => c.toLowerCase()))
const hex = (rgb: string): string | null => {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(rgb)
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}
const luminance = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 }
function inkPalette(svg: SVGSVGElement) {
  for (const el of svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line') as NodeListOf<SVGElement>) {
    const cs = getComputedStyle(el)
    const fill = hex(cs.fill), stroke = hex(cs.stroke)
    if (fill && !PALETTE.has(fill)) el.style.setProperty('fill', luminance(fill) > 0.55 ? (fill === '#ffffff' ? PAPER.pale : PAPER.soft) : PAPER.line, 'important')
    // a LIGHT stroke is a hachure line or a faint grid (rough draws a white fill as white
    // hatching): it becomes the hatch yellow; a mid stroke the line brown; a dark one the ink
    if (stroke && !PALETTE.has(stroke)) el.style.setProperty('stroke', luminance(stroke) > 0.7 ? PAPER.hatch : luminance(stroke) > 0.35 ? PAPER.line : PAPER.ink, 'important')
  }
}

/** One look for every diagram type. mermaid's hand-drawn look (rough.js) reaches flowcharts only;
 *  sequence actors, notes, state and class boxes come out as plain <rect>s. This redraws those
 *  boxes with the same rough.js recipe the flowchart nodes got - hachured fill, sketched border -
 *  in the paper's colours, and hides the plain rect underneath. Seeded per box, so a re-render of
 *  the same note draws the same lines. */
const SKETCH_BOXES = 'rect.actor, .actor-top rect, .actor-bottom rect, .note rect, rect.note, .noteGroup rect, .labelBox, .statediagram-state rect, .statediagram-state > rect, g.classGroup > rect, .classGroup rect, .er.entityBox, .er.relationshipLabelBox, .journey-section rect, .task rect, .timeline-node rect, .timeline-event rect, .eventWrapper rect, .mindmap-node rect'
function sketchBoxes(svg: SVGSVGElement, rough: any) {
  const rc = rough.svg(svg)
  let seed = 7
  for (const rect of [...svg.querySelectorAll(SKETCH_BOXES)] as SVGGraphicsElement[]) {
    if (rect.tagName.toLowerCase() !== 'rect' || (rect as any).__sketched) continue
    if (/attributeBox/.test(rect.getAttribute('class') ?? '')) continue   // an ER attribute cell is a flat row, not a box
    if (rect.nextElementSibling?.tagName === 'g' && rect.nextElementSibling.querySelector('path')) continue   // already hand-drawn by mermaid
    const x = Number(rect.getAttribute('x') ?? 0), y = Number(rect.getAttribute('y') ?? 0)
    const w = Number(rect.getAttribute('width') ?? 0), h = Number(rect.getAttribute('height') ?? 0)
    if (!(w > 4 && h > 4)) continue
    // mermaid's own hand-drawn node recipe (handDrawnShapeStyles: angle 120, gap 4, weight 2,
    // roughness 0.7) in the paper's colours - the flowchart boxes and these are one family
    const g = rc.rectangle(x, y, w, h, {
      seed: seed++, roughness: 0.7, bowing: 0.6,
      stroke: PAPER.line, strokeWidth: 1.6,
      fill: PAPER.hatch, fillStyle: 'hachure', hachureAngle: 120, hachureGap: 4, fillWeight: 1.2,
    }) as SVGGElement
    // the plain box stays as a flat backing (the flowchart's boxes have one too) and loses its edge
    rect.setAttribute('style', `fill: ${PAPER.soft}; stroke: none;`)
    rect.setAttribute('rx', '2')
    ;(rect as any).__sketched = true
    rect.after(g)
    // the text is a later sibling: keep it above the sketch
    const text = rect.parentElement?.querySelector('text')
    if (text && text.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) text.parentElement?.appendChild(text)
  }
}

/** Render every ```mermaid fence in a sticky body: hand-drawn, strict, sanitized. The pre stays
 *  mounted through an error (the message replaces the code), so a healed edit heals in place. */
async function renderDiagrams(body: HTMLElement, alive: () => boolean) {
  const fences = [...body.querySelectorAll('pre > code.language-mermaid')] as HTMLElement[]
  if (!fences.length) return
  const [{ default: mermaid }, { default: rough }] = await Promise.all([import('mermaid'), import('roughjs')])
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
      `.actor-line { stroke: ${PAPER.line} !important; stroke-width: 1.4px !important }`,
      `.messageLine0, .messageLine1 { stroke: ${PAPER.ink} !important; stroke-width: 1.8px !important } #arrowhead path, .arrowheadPath { fill: ${PAPER.ink} !important; stroke: ${PAPER.ink} !important }`,
      `.messageText, .actor > tspan, text.actor { fill: ${PAPER.ink} !important }`,
      `.loopLine { stroke: ${PAPER.line} !important } .labelBox, .loopText, .note { stroke: ${PAPER.line} }`,
      `.er.attributeBoxOdd { fill: ${PAPER.pale} !important; stroke: ${PAPER.line} } .er.attributeBoxEven { fill: ${PAPER.bg} !important; stroke: ${PAPER.line} } .er.relationshipLine { stroke: ${PAPER.ink} !important }`,
      `.section0, .section2, .section4 { fill: ${PAPER.pale} } .section1, .section3 { fill: ${PAPER.bg} } .grid .tick line { stroke: ${PAPER.line} } .today { stroke: ${PAPER.ink} }`,
      `.commit-label, .branchLabel text { fill: ${PAPER.ink} !important } .commit-label-bkg { fill: ${PAPER.bg} !important } .commit-arrow, .arrow { stroke: ${PAPER.ink} !important }`,
      `.mindmap-node > path, .mindmap-node rect { stroke: ${PAPER.line}; stroke-width: 1.4px } .edge { stroke: ${PAPER.line}; stroke-width: 2px }`,
      // state / class / er: the same ink
      `.statediagram-state rect, .classGroup rect, .er.entityBox { stroke: ${PAPER.line}; stroke-width: 1.6px; fill: ${PAPER.soft} } .transition, .relation, .er.relationshipLine { stroke: ${PAPER.ink} !important; stroke-width: 1.8px !important }`,
    ].join(' '),
    flowchart: { padding: 10, nodeSpacing: 32, rankSpacing: 36 },
    // one actor row (the mirrored bottom row is noise at note size), roomier boxes, bigger text
    sequence: { mirrorActors: false, actorFontSize: 18, actorFontWeight: 700, messageFontSize: 17, messageFontWeight: 700, noteFontSize: 16, width: 96, height: 50, actorMargin: 26, boxMargin: 8, messageMargin: 30, diagramMarginX: 6, diagramMarginY: 6, wrap: true, bottomMarginAdj: 4 },
    // the wide-by-nature types drawn AT the note's width instead of shrunk into it
    gantt: { useWidth: 380, fontSize: 13, sectionFontSize: 13, barHeight: 22, barGap: 6, topPadding: 44, leftPadding: 64, rightPadding: 12, gridLineStartPadding: 20, numberSectionStyles: 2 },
    journey: { width: 84, height: 36, leftMargin: 56, taskMargin: 10, taskFontSize: 13, diagramMarginX: 8, diagramMarginY: 8, boxMargin: 6, actorColours: [PAPER.line, PAPER.ink, '#a88f2a', '#e9c94f'] },
    timeline: { disableMulticolor: true, padding: 10, width: 84, height: 40, leftMargin: 40, taskMargin: 8, diagramMarginX: 8, diagramMarginY: 8 },
    quadrantChart: { chartWidth: 360, chartHeight: 360, titleFontSize: 16, quadrantLabelFontSize: 14, pointLabelFontSize: 13, xAxisLabelFontSize: 13, yAxisLabelFontSize: 13, pointRadius: 5 },
    mindmap: { padding: 10, maxNodeWidth: 150 },
    er: { minEntityWidth: 90, minEntityHeight: 50, entityPadding: 12, fontSize: 14, diagramPadding: 10 },
    gitGraph: { showBranches: true, rotateCommitLabel: false, nodeLabel: { width: 60 } } as any,
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
      const el = host.querySelector('svg')
      if (el) sketchBoxes(el, rough)
      pre.replaceWith(host)
      if (el) inkPalette(el)   // computed colours need the svg in the document
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

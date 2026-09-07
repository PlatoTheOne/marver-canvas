/**
 * Textures at publish time (spec 16, published canvases).
 *
 * A published canvas is a static site with no compiler, so its glass stayed live and a shared hi-fi
 * board flashed on pan and zoom as before 0.18.0. Everything the compiler needs is known when the
 * site is built: the published boards, every node's frame and size on them, and the themes a
 * visitor can flip to. So the build serves design/.dist to itself on a loopback port, compiles every
 * (frame, theme, size) against the PUBLISHED document - the one visitors get, not the dev one - with
 * the same certification as the dev server (bake.ts), ships the certified textures under
 * design/.dist/__mv/bakes/<build>/ and writes one static index the shell reads instead of asking a
 * server. Anything the compiler refuses is simply absent from the index: that frame sleeps with the
 * pause alone, glass live, as today. No Chrome on the build machine: the note is printed and the
 * site ships without textures.
 */
import { copyFileSync, existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { ASK_MAX, bakeBatch, type BakeAnswer, type BakeAsk } from './bake.ts'
import { findChrome } from './cdp.ts'
import { MIME } from './serve.ts'

export interface PublishedIndex { gen: number; answers: Record<string, { ok: true; targets: NonNullable<Extract<BakeAnswer, { ok: true }>['targets']> }> }

/** The shell's plain key for an ask (sleep.ts keyOf): frame|theme|w|h. */
export const indexKey = (a: BakeAsk) => `${a.frame}|${a.theme}|${Math.round(a.w)}|${Math.round(a.h)}`

/** Every (frame, theme, size) a visitor can rest on: each published board's nodes, each theme, within
 *  the compiler's limits (an oversize node is skipped, never clamped to a document of another size). */
export function publishedAsks(boards: Record<string, { nodes?: { frame?: string; w?: number; h?: number }[] }>, themes: string[]): BakeAsk[] {
  const seen = new Map<string, BakeAsk>()
  for (const b of Object.values(boards)) for (const n of b?.nodes ?? []) {
    if (typeof n?.frame !== 'string' || !(n.w! >= 120) || !(n.h! >= 80) || n.w! > ASK_MAX.side || n.h! > ASK_MAX.side || n.w! * n.h! > ASK_MAX.area) continue
    for (const theme of themes.length ? themes : ['light']) {
      const ask = { frame: n.frame, theme, w: Math.round(n.w!), h: Math.round(n.h!) }
      seen.set(indexKey(ask), ask)
    }
  }
  return [...seen.values()]
}

/** The index: only answers that certified at least one texture, and only their certified targets
 *  (a refused target's selector ships nothing); everything else is absent. */
export function publishedIndex(gen: number, answers: BakeAnswer[]): PublishedIndex {
  const out: PublishedIndex = { gen, answers: {} }
  for (const a of answers) {
    if (!a.ok) continue
    const targets = a.targets.filter((t) => t.verified && t.texture)
    if (targets.length) out.answers[indexKey(a)] = { ok: true, targets }
  }
  return out
}

/** Serve `dir` on a loopback port the way `marver serve` does (extensionless = index.html). */
function serveDir(dir: string): Promise<{ origin: string; close: () => void }> {
  const real = realpathSync(dir)
  const server = createServer((req, res) => {
    let path = ''
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname) } catch { res.statusCode = 400; return res.end() }
    if (path.endsWith('/')) path += 'index.html'
    let file = resolve(dir, path.slice(1))
    try { const r = realpathSync(file); if (relative(real, r).startsWith('..') || isAbsolute(relative(real, r))) throw 0; file = r } catch { file = join(dir, 'index.html') }
    if (!extname(file)) file = join(dir, 'index.html')
    try { const c = readFileSync(file); res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream'); res.end(c) } catch { res.statusCode = 404; res.end() }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => { const a = server.address() as { port: number }; ok({ origin: `http://127.0.0.1:${a.port}`, close: () => server.close() }) }))
}

export interface PublishedBakes { asked: number; asleep: number; live: number; plain: number; bytes: number; ms: number }

/** Compile the published boards' frames against the built site and ship the textures with it.
 *  Returns null when there is no Chrome to compile with. */
export async function bakePublished(opts: { root: string; outDir: string; gen: number; boards: Record<string, { nodes?: { frame?: string; w?: number; h?: number }[] }>; themes: string[]; urlFor: (frame: string, theme: string) => string | null; log?: (line: string) => void }): Promise<PublishedBakes | null> {
  const { root, outDir, gen, boards, themes, urlFor, log } = opts
  if (!findChrome()) return null
  const t0 = Date.now()
  const asks = publishedAsks(boards, themes).filter((a) => urlFor(a.frame, a.theme))   // only frames the bundle carries
  const stats: PublishedBakes = { asked: asks.length, asleep: 0, live: 0, plain: 0, bytes: 0, ms: 0 }
  if (!asks.length) return stats
  const site = await serveDir(outDir)
  let answers: BakeAnswer[]
  try {
    answers = await bakeBatch({
      root, gen, asks, urlBase: '/__mv/bakes',
      urlFor: (a) => site.origin + urlFor(a.frame, a.theme)!,
      log: (a) => {
        if (!a.ok) { stats.live++; log?.(`  bake: ${a.frame} ${a.theme} ${a.w}x${a.h} - stays live: ${a.error}`); return }
        if (!a.targets.length) { stats.plain++; return }
        const shipped = a.targets.filter((t) => t.verified).length
        if (shipped) stats.asleep++; else stats.live++
        log?.(`  bake: ${a.frame} ${a.theme} ${a.w}x${a.h} - ${a.targets.length} effects, ${a.rejected} stay live, ${a.ms} ms`)
      },
    })
  } finally { site.close() }
  // ship the certified PNGs and one index, nothing else (no bake.json, no owner, no refused target);
  // the index is written last, so a reader never sees it before its textures
  const index = publishedIndex(gen, answers)
  const to = join(outDir, '__mv', 'bakes')
  rmSync(to, { recursive: true, force: true })
  for (const a of Object.values(index.answers)) for (const t of a.targets) {
    const from = join(root, 'design', '.local', 'bakes', t.texture.replace(/^\/__mv\/bakes\//, ''))
    const dest = join(outDir, t.texture.slice(1))
    if (!existsSync(from)) continue
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(from, dest)
    stats.bytes += statSync(dest).size
  }
  mkdirSync(join(to, String(gen)), { recursive: true })
  writeFileSync(join(to, String(gen), 'index.json'), JSON.stringify(index))
  stats.ms = Date.now() - t0
  return stats
}

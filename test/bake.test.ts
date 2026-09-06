import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Browser as Cdp, findChrome } from '../src/server/cdp.ts'
import { bakeIn, bakeKey } from '../src/server/bake.ts'
import { PAGES } from './fixtures/glass-pages.ts'

/**
 * The compiler behind sleep (spec 16), on synthetic glass pages served from memory: what it
 * certifies, what it refuses, and the shape of what it returns. Every case is a property of the
 * result, not of the constants that produced it - a texture is accepted only when the compiler
 * itself found the page pixel-identical inside the glass.
 */

let http: Server | null = null
let origin = ''
let b: Cdp | null = null

beforeAll(async () => {
  http = createServer((req, res) => {
    const name = (req.url ?? '/').slice(1).split('?')[0]
    const html = PAGES[name]
    if (!html) { res.statusCode = 404; return res.end() }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html)
  })
  await new Promise<void>((r) => http!.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  if (findChrome()) b = await Cdp.launch('mv-bake-test-')
}, 60_000)

afterAll(() => { void b?.close(); http?.close() })

const skippable = (name: string, fn: () => Promise<void>, ms = 90_000) =>
  it(name, async (ctx) => { if (!b) return ctx.skip(); await fn() }, ms)

const bake = (name: string) => bakeIn(b!, { url: `${origin}/${name}`, width: 600, height: 400 })
const pngSize = (dataUrl: string) => { const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'); return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } }

describe('the compiler (bake.ts)', () => {
  skippable('a page without backdrop-filter has nothing to compile', async () => {
    const r = await bake('plain')
    expect(r).toMatchObject({ ok: true, targets: [], levels: 0, rejected: 0 })
  })

  skippable('one glass pill: certified, with a texture of exactly its border box', async () => {
    const r = await bake('glass')
    if (!r.ok) throw new Error(r.error)
    expect(r.levels).toBe(1)
    expect(r.rejected).toBe(0)
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]
    expect(t.sel).toBe('#pill')
    expect(t.rect).toEqual({ x: 100, y: 100, w: 242, h: 62 })   // the border box (1px border)
    expect(t.filter).toBe('blur(12px)')
    expect(t.verified).toBe(true)
    expect(t.maxErr).toBeLessThanOrEqual(32)
    expect(t.texture.startsWith('data:image/png;base64,')).toBe(true)
    expect(pngSize(t.texture)).toEqual({ w: 242, h: 62 })   // TEXTURE_DSF 1: one texel per CSS px
  })

  skippable('glass inside glass stays live, both of them (the inner one reads an unfiltered backdrop)', async () => {
    const r = await bake('nested')
    if (!r.ok) throw new Error(r.error)
    expect(r.targets).toEqual([])
    expect(r.levels).toBe(0)
  })

  skippable('two overlapping siblings: the one painted later reads the earlier one, and both certify', async () => {
    const r = await bake('later')
    if (!r.ok) throw new Error(r.error)
    const byId = Object.fromEntries(r.targets.map((t) => [t.sel, t]))
    expect(byId['#a'].level).toBe(0)
    expect(byId['#b'].level).toBe(1)
    expect(r.rejected).toBe(0)
  })

  skippable('an authored !important opacity survives the hide-and-show and still certifies', async () => {
    const r = await bake('opacity')
    if (!r.ok) throw new Error(r.error)
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0].verified).toBe(true)
  })

  skippable('a mix-blend-mode glass is refused by certification (it stays live)', async () => {
    const r = await bake('blend')
    if (!r.ok) throw new Error(r.error)
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0].verified).toBe(false)
  })

  skippable('a backdrop that never stops changing is refused, not certified', async () => {
    const r = await bake('restless')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/never stopped changing/)
  })

  skippable('the geometry guard: an override that moves any box - even one outside every glass - rejects every texture', async () => {
    const r = await bake('moving')
    if (!r.ok) throw new Error(r.error)
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0].maxErr).toBeLessThanOrEqual(32)   // the pixels inside the glass were fine
    expect(r.targets[0].verified).toBe(false)              // the box that moved was not
    expect(r.rejected).toBe(1)
  })

  skippable('an authored background-clip keeps the tint off a transparent border, and the perimeter certifies', async () => {
    const r = await bake('clip')
    if (!r.ok) throw new Error(r.error)
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0].verified).toBe(true)
  })

  it('a bake key names the frame, theme and rounded size - nothing else', () => {
    const k = bakeKey({ frame: 'app/home', theme: 'light', w: 390.4, h: 844 })
    expect(k).toMatch(/^[0-9a-f]{16}$/)
    expect(bakeKey({ frame: 'app/home', theme: 'light', w: 390, h: 844.2 })).toBe(k)
    expect(bakeKey({ frame: 'app/home', theme: 'dark', w: 390, h: 844 })).not.toBe(k)
    expect(bakeKey({ frame: 'app/home', theme: 'light', w: 391, h: 844 })).not.toBe(k)
  })
})

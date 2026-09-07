import { Browser } from '../../test/browser.ts'
const [origin = 'http://localhost:5260', board = 'shipper-high-fi'] = process.argv.slice(2)
const b = (await Browser.launch())!
const s = await b.tab()
await b.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1200, deviceScaleFactor: 2, mobile: false }, s)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
await b.go(s, `${origin}/#/b/${board}`)
await b.until(s, `(() => { const st = window.__mvStore?.getState(); return !!st && st.nodes.length > 0 && st.nodes.every((n) => n.status === 'ready') })()`, 90_000)
await wait(6000)
console.log(await b.eval(s, `(async () => {
  const st = window.__mvStore.getState()
  const csrf = document.cookie.match(/(?:^|; )mv_c=([^;]+)/)?.[1] ?? ''
  const asks = st.nodes.map((n) => ({ frame: n.frame, theme: n.theme, w: n.w, h: n.h }))
  const r = await fetch('/__mv/api/bakes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mv-c': csrf }, body: JSON.stringify({ asks }) })
  const data = await r.json()
  const out = { status: r.status, gen: data.gen, srcs: [...document.querySelectorAll('iframe')].map((i) => i.getAttribute('src')), frames: [] }
  const iframes = [...document.querySelectorAll('iframe')]
  for (const a of data.answers) {
    const f = iframes.find((i) => decodeURIComponent(i.getAttribute('src') || '').includes(a.frame))
    const doc = f?.contentDocument
    const rep = { frame: a.frame, ok: a.ok, error: a.error, targets: a.targets?.length, verified: a.targets?.filter((t) => t.verified).length, iframe: !!f, doc: !!doc?.body, sleep: !!doc?.getElementById('mv-sleep'), bad: [] }
    if (doc && a.ok) for (const t of a.targets) {
      if (!t.verified) continue
      let el = null; try { el = doc.querySelector(t.sel) } catch (e) { rep.bad.push({ sel: t.sel, err: 'selector' }); continue }
      if (!el) { rep.bad.push({ sel: t.sel, err: 'no element' }); continue }
      const rc = el.getBoundingClientRect(), cs = getComputedStyle(el)
      const d = [rc.x - t.rect.x, rc.y - t.rect.y, rc.width - t.rect.w, rc.height - t.rect.h].map((v) => +v.toFixed(3))
      if (d.some((v) => Math.abs(v) > 0.02)) rep.bad.push({ sel: t.sel, err: 'rect', d, have: [rc.x, rc.y, rc.width, rc.height].map((v) => +v.toFixed(2)), want: t.rect })
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none'
      if (bf !== t.filter) rep.bad.push({ sel: t.sel, err: 'filter', have: bf, want: t.filter })
    }
    rep.badCount = rep.bad.length; rep.bad = rep.bad.slice(0, 4)
    out.frames.push(rep)
  }
  return JSON.stringify(out, null, 1)
})()`))
b.close()

// A note with a diagram on a FRESH INSTALL of the tarball (the published artefact, not the repo):
// mermaid + roughjs resolve from the app's own node_modules and the sticky renders sketched.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser } from '../../test/browser.ts'
const repo = join(import.meta.dirname, '..', '..')
const app = mkdtempSync(join(tmpdir(), 'mv-fresh-'))
const port = 5263 + Math.floor(Math.random() * 100)
try {
  const tgz = execFileSync('npm', ['pack', '--pack-destination', app], { cwd: repo, encoding: 'utf8' }).trim().split('\n').pop()!
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'fresh', private: true, type: 'module' }))
  execFileSync('npm', ['install', '--no-audit', '--no-fund', join(app, tgz)], { cwd: app, stdio: 'pipe' })
  const nm = readdirSync(join(app, 'node_modules'))
  console.log('installed', { roughjs: nm.includes('roughjs'), mermaid: nm.includes('mermaid'), marked: nm.includes('marked') })
  execFileSync('npx', ['marver', 'init'], { cwd: app, stdio: 'pipe' })
  const scene = join(app, 'design', 'scenes', 'demo')
  mkdirSync(scene, { recursive: true })
  writeFileSync(join(scene, 'home.tsx'), `export const meta = { title: 'Home', viewport: 'mobile' }\nexport default () => <main style={{ minHeight: '100vh', background: '#0b5' }}><h1 style={{ padding: 24, color: '#fff' }}>Home</h1></main>\n`)
  writeFileSync(join(scene, 'home.note.md'), `## From the tarball\n\nA note on a fresh install.\n\n\`\`\`mermaid\nsequenceDiagram\n  A->>B: hello\n  B-->>A: sketched?\n\`\`\`\n`)
  writeFileSync(join(scene, '_note.md'), `# Demo\n\n\`\`\`mermaid\nflowchart LR\n  Install --> Note --> Diagram\n\`\`\`\n`)
  const server = spawn('npx', ['marver', 'dev', '--port', String(port)], { cwd: app, stdio: 'pipe', env: { ...process.env, BROWSER: 'none', CI: '1' } })
  let log = ''; server.stdout?.on('data', (d) => { log += d }); server.stderr?.on('data', (d) => { log += d })
  const t0 = Date.now()
  while (Date.now() - t0 < 60_000) { if (await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 200)) }
  const b = (await Browser.launch())!
  const s = await b.tab({ width: 1400, height: 900 })
  await b.go(s, `http://localhost:${port}/#/b/all-scenes`)
  await b.until(s, `document.querySelectorAll('.sh-sticky').length === 2`, 40_000)
  await b.until(s, `document.querySelectorAll('.sh-sticky-diagram svg').length === 2`, 40_000)
  await new Promise((r) => setTimeout(r, 1500))
  console.log('fresh install', await b.eval(s, `JSON.stringify({ stickies: document.querySelectorAll('.sh-sticky').length, diagrams: document.querySelectorAll('.sh-sticky-diagram svg').length, errs: [...document.querySelectorAll('.sh-sticky pre.err')].map((e) => e.textContent), actorSketched: !!document.querySelector('rect.actor + g path'), flowchartPaths: document.querySelectorAll('[data-sticky="scene"] svg path').length })`))
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, s)
  writeFileSync('/Users/nictouron/.claude/jobs/4d030bfd/tmp/70-fresh-install.png', Buffer.from(data, 'base64'))
  console.log('server log errors', log.split('\n').filter((l) => /error/i.test(l)).slice(0, 3))
  b.close(); server.kill('SIGTERM')
} finally { rmSync(app, { recursive: true, force: true }) }

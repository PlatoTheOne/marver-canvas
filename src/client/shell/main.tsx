import { createRoot } from 'react-dom/client'
import { App, ShellBoundary } from './App.tsx'
import { CONFIG, useStore } from './store.ts'
import { htmlLang, setLocale } from '../../shared/i18n.ts'
import './styles.css'

// 在首次渲染前固定 locale，保证 aria-label、提示与正文使用同一种语言。
setLocale(CONFIG.locale)
document.documentElement.lang = htmlLang(CONFIG.locale)

// dev aid: inspectable store (harmless in builds; the canvas is a dev surface)
;(window as any).__sh = useStore

createRoot(document.getElementById('root')!).render(<ShellBoundary><App /></ShellBoundary>)

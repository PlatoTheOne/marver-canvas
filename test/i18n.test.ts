import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, htmlLang, resolveLocale, translate } from '../src/shared/i18n.ts'

describe('界面语言', () => {
  it('默认使用简体中文，并识别支持的语言标签', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
    expect(resolveLocale(undefined)).toBe('zh-CN')
    expect(resolveLocale('zh_Hant')).toBe('zh-TW')
    expect(resolveLocale('zh-HK')).toBe('zh-HK')
    expect(resolveLocale('en-US')).toBe('en')
    expect(htmlLang('zh-TW')).toBe('zh-TW')
  })

  it('翻译界面文案并替换命名变量', () => {
    expect(translate('zh-CN', 'Boards')).toBe('看板')
    expect(translate('zh-TW', 'Copy {{count}} paths', { count: 3 })).toBe('複製 3 條路徑')
  })

  it('英文和缺失词条保持可读回退', () => {
    expect(translate('en', 'Boards')).toBe('Boards')
    expect(translate('zh-CN', 'A future upstream label')).toBe('A future upstream label')
  })
})

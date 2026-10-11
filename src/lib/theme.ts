/**
 * 主题偏好。
 *
 * 设计取舍：偏好有三态（light / dark / system），但**永远把「解析后的最终主题」
 * 写到 `<html data-theme>`**，于是：
 *   · CSS 只需要一条 `:root[data-theme='dark']` 规则
 *   · 不用在 CSS 里写 @media 分支，也不会出现「暗色变量在两处各写一遍」的漂移
 * 代价是首屏可能闪一下 —— 所以在 index.html 里放了一段内联脚本，在 React 挂载前
 * 就把 data-theme 设好。
 */
export type ThemePref = 'light' | 'dark' | 'system'

const LS_THEME = 'zeronote.theme'
const MEDIA = '(prefers-color-scheme: dark)'

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(LS_THEME)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(LS_THEME, pref)
  } catch {
    /* localStorage 不可用（隐私模式等）时静默降级为「本次会话有效」 */
  }
}

/** 把偏好解析成最终主题（system → 问系统） */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia(MEDIA).matches ? 'dark' : 'light'
  }
  return pref
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref)
}

/** 订阅系统主题变化。调用方只在 pref === 'system' 时才需要重算。返回取消订阅函数 */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia(MEDIA)
  const handler = () => onChange()
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
